// Dtv player: the full-screen vertical player at "#/watch/<episodeId>" (and the
// readable alias "#/watch/<series-slug>/<number>"). app.js opens and closes it
// from its router: window.DtvPlayer.open(ref, ctx) / close().
//
// Built for low-end phones:
// - a fixed pool of three slides (previous, current, next), so there are never
//   more than three <video> elements and never more than two loading streams;
// - every listener is added with an AbortController signal (one per slide
//   mount, one for the whole player) and every timer lives in P.timers, so a
//   swipe or close tears all of it down in one place, hls.destroy() included;
// - the overlay is built once and only has its text, hidden flags and one
//   transform updated while an episode plays.
// Always the dark look, like onboarding: the layer carries the "dark" class.

(function () {
  var HLS_SRC = '/vendor/hls.light.min.js';
  var hlsPromise = null;

  // Current episode: adaptive bitrate, capped to the player's size.
  var CURRENT_CONFIG = {
    enableWorker: true, capLevelToPlayerSize: true, startLevel: -1, abrEwmaDefaultEstimate: 500000,
    maxBufferLength: 20, maxMaxBufferLength: 30, backBufferLength: 10, maxBufferSize: 20e6,
  };
  // Next episode, preloading: a few seconds at the lowest level, so it starts at once.
  var PRELOAD_CONFIG = {
    enableWorker: true, capLevelToPlayerSize: true, startLevel: 0, abrEwmaDefaultEstimate: 500000,
    maxBufferLength: 6, maxMaxBufferLength: 6, backBufferLength: 10, maxBufferSize: 20e6,
  };

  var SEEK_STEP = 10;
  var COUNTDOWN = 5;

  /** Load hls.js once. Resolves with Hls, or null when it cannot load (native HLS may still work). */
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsPromise) {
      hlsPromise = new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = HLS_SRC;
        s.async = true;
        s.onload = function () { resolve(window.Hls || null); };
        s.onerror = function () { hlsPromise = null; resolve(null); };
        document.head.appendChild(s);
      });
    }
    return hlsPromise;
  }

  function readPref(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }
  function writePref(key, value) { try { sessionStorage.setItem(key, value); } catch (_) {} }

  // The open player, or null.
  var P = null;
  var ctx = null;
  var openSeq = 0;

  function h() { return ctx.h.apply(null, arguments); }

  function icon(paths, filled) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'h-6 w-6');
    svg.setAttribute('fill', filled ? 'currentColor' : 'none');
    svg.setAttribute('stroke', filled ? 'none' : 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    paths.forEach(function (d) {
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }
  var ICON_BACK = ['M15 18l-6-6 6-6'];
  var ICON_SOUND = ['M11 5L6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'];
  var ICON_MUTED = ['M11 5L6 9H2v6h4l5 4V5z', 'M22 9l-6 6', 'M16 9l6 6'];
  var ICON_PLAY = ['M7 4l13 8-13 8z'];

  function button(cls, children, onClick) {
    var b = h('button', cls, children);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function spinner() {
    var s = h('div', 'pointer-events-none absolute left-1/2 top-1/2 -ml-5 -mt-5 h-10 w-10 animate-spin rounded-full border-4 border-fg/30 border-t-fg');
    s.setAttribute('role', 'status');
    s.setAttribute('aria-label', 'Loading');
    return s;
  }

  function seriesHash() { return '#/series/' + encodeURIComponent(P.series.slug); }
  function backToSeries() { if (P) location.hash = seriesHash(); }

  function episodeAt(i) { return P.playlist[i]; }
  function playable(ep) { return !!ep && ep.state !== 'locked' && !!ep.videoUrl; }

  function duration(slot) {
    var d = slot.video.duration;
    return isFinite(d) && d > 0 ? d : episodeAt(slot.idx).durationSeconds;
  }

  function clock(t) { return ctx.minutes(Math.max(0, Math.floor(t || 0))); }

  // ── Timers ────────────────────────────────────────────────────────────
  // Every playback timer of the player, by name. clearTimers() runs on every
  // swipe and on close; they are started again for the new current episode.
  function clearTimer(name) {
    var t = P.timers[name];
    if (t) { clearTimeout(t); clearInterval(t); }
    delete P.timers[name];
  }
  function clearTimers() {
    Object.keys(P.timers).forEach(clearTimer);
  }
  function later(name, ms, fn) {
    clearTimer(name);
    P.timers[name] = setTimeout(function () { delete P.timers[name]; fn(); }, ms);
  }

  // ── Slides ────────────────────────────────────────────────────────────
  function makeSlot() {
    var el = h('div', 'absolute inset-0 overflow-hidden bg-ground');
    el.dataset.testid = 'player-slide';
    el.hidden = true;

    var coverWrap = h('div', 'absolute inset-0 flex items-center justify-center', [
      ctx.cover(P.series, 'h-48 w-36 rounded-xl border border-line', 'text-title text-fg'),
    ]);
    var video = document.createElement('video');
    video.className = 'absolute inset-0 h-full w-full object-contain opacity-0';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('crossorigin', 'anonymous');
    video.preload = 'none';
    video.disableRemotePlayback = true;
    var load = spinner();
    load.hidden = true;

    var lockTitle = h('h2', 'text-heading');
    var lockMeta = h('p', 'text-small text-muted');
    var unlockLabel = h('span', '');
    var unlockBtn = button('btn-primary', [ctx.lockIcon(), unlockLabel]);
    unlockBtn.dataset.testid = 'unlock-button';
    var lockMessage = h('p', 'text-small text-danger');
    lockMessage.setAttribute('role', 'alert');
    var lockHint = h('p', 'text-small text-muted');
    var lockCard = h('div', 'absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center', [
      ctx.cover(P.series, 'h-40 w-28 rounded-xl border border-line', 'text-title text-fg'),
      lockTitle, lockMeta, unlockBtn, lockMessage, lockHint,
    ]);
    lockCard.hidden = true;

    var errTitle = h('h2', 'text-heading');
    var errText = h('p', 'text-body text-muted');
    var retryBtn = button('btn-primary', 'Retry');
    var errBack = button('btn-secondary', 'Back to series', backToSeries);
    var errorBox = h('div', 'state-error absolute inset-0 justify-center bg-ground/80', [
      errTitle, errText, h('div', 'flex flex-wrap justify-center gap-3 pt-2', [retryBtn, errBack]),
    ]);
    errorBox.hidden = true;

    el.appendChild(coverWrap);
    el.appendChild(video);
    el.appendChild(load);
    el.appendChild(lockCard);
    el.appendChild(errorBox);

    var slot = {
      el: el, coverWrap: coverWrap, video: video, load: load,
      lockCard: lockCard, lockTitle: lockTitle, lockMeta: lockMeta, unlockBtn: unlockBtn,
      unlockLabel: unlockLabel, lockMessage: lockMessage, lockHint: lockHint,
      errorBox: errorBox, errTitle: errTitle, errText: errText,
      idx: -1, hls: null, ac: null, track: null, retryTimer: 0,
      attached: false, ready: false, failed: false, everPlayed: false, wantPlay: false,
      manifestLoaded: false, netRetries: 0, mediaRecoveries: 0, completed: false,
      lastSaved: -1, lastCompleted: false,
    };
    unlockBtn.addEventListener('click', function () {
      openUnlockSheet(episodeAt(slot.idx), { button: unlockBtn, message: lockMessage, onUnlocked: onUnlocked });
    });
    retryBtn.addEventListener('click', function () { retry(slot); });
    return slot;
  }

  function slotFor(i) {
    for (var k = 0; k < P.slots.length; k++) if (P.slots[k].idx === i) return P.slots[k];
    return null;
  }

  function position(slot) {
    if (slot.idx < 0) return;
    slot.el.style.transform = 'translate3d(0,' + ((slot.idx - P.index) * 100) + '%,0)';
  }

  /** Put episode i into a free slide. Locked episodes get the lock card and no stream. */
  function mount(slot, i) {
    var ep = episodeAt(i);
    var locked = ep.state === 'locked';
    slot.idx = i;
    slot.el.dataset.state = ep.state;
    slot.el.hidden = false;
    slot.coverWrap.hidden = locked;
    slot.video.hidden = locked;
    slot.lockCard.hidden = !locked;
    slot.errorBox.hidden = true;
    slot.load.hidden = true;
    if (locked) {
      slot.lockTitle.textContent = 'Episode ' + ep.number + ' is locked';
      slot.lockMeta.textContent = ep.title + ' · ' + ctx.minutes(ep.durationSeconds);
      slot.unlockLabel.textContent = 'Unlock for ' + ctx.plural(ep.coinPrice, 'coin', 'coins');
      slot.unlockBtn.disabled = false;
      slot.lockMessage.textContent = '';
      slot.lockHint.textContent = i > 0
        ? 'Swipe down for episode ' + episodeAt(i - 1).number
        : (i + 1 < P.playlist.length ? 'Swipe up for episode ' + episodeAt(i + 1).number : '');
    }
    position(slot);
  }

  /**
   * Tear down a slide's stream completely: listeners, timers, hls.destroy(),
   * the source and the subtitle track, then load() so the decoder is freed.
   */
  function releaseMedia(slot) {
    if (slot.ac) { slot.ac.abort(); slot.ac = null; }
    if (slot.retryTimer) { clearTimeout(slot.retryTimer); slot.retryTimer = 0; }
    if (slot.hls) { slot.hls.destroy(); slot.hls = null; }
    removeTrack(slot);
    var v = slot.video;
    v.pause();
    v.playbackRate = 1;
    if (v.hasAttribute('src')) {
      v.removeAttribute('src');
      v.load();
    }
    v.classList.add('opacity-0');
    slot.attached = slot.ready = slot.failed = slot.everPlayed = slot.wantPlay = false;
    slot.manifestLoaded = slot.completed = false;
    slot.netRetries = slot.mediaRecoveries = 0;
    slot.lastSaved = -1;
    slot.lastCompleted = false;
    slot.load.hidden = true;
    slot.errorBox.hidden = true;
  }

  function release(slot) {
    releaseMedia(slot);
    slot.idx = -1;
    slot.el.hidden = true;
    delete slot.el.dataset.state;
  }

  /** Keep exactly the previous, current and next episodes mounted. */
  function syncWindow() {
    var want = [P.index - 1, P.index, P.index + 1].filter(function (i) { return i >= 0 && i < P.playlist.length; });
    P.slots.forEach(function (s) { if (s.idx >= 0 && want.indexOf(s.idx) < 0) release(s); });
    want.forEach(function (i) {
      if (slotFor(i)) return;
      var free = P.slots.filter(function (s) { return s.idx < 0; })[0];
      mount(free, i);
    });
    P.slots.forEach(position);
  }

  // ── Streams ───────────────────────────────────────────────────────────
  /** Start loading a slide's episode: "play" for the current one, "preload" for the next. */
  function attach(slot, mode) {
    var ep = episodeAt(slot.idx);
    var v = slot.video;
    var ac = new AbortController();
    var on = function (type, fn) { v.addEventListener(type, fn, { signal: ac.signal }); };
    slot.ac = ac;
    slot.attached = true;
    slot.load.hidden = false;

    on('loadeddata', function () {
      slot.ready = true;
      slot.load.hidden = true;
      v.classList.remove('opacity-0');
    });
    on('loadedmetadata', function () { if (slot === P.current) applyResume(slot); });
    on('canplay', function () {
      if (slot === P.current) hideBuffering();
      if (slot === P.current && slot.wantPlay && v.paused) tryPlay(slot);
    });
    on('playing', function () {
      if (slot !== P.current) return;
      hideBuffering();
      P.ui.paused.hidden = true;
      if (!slot.everPlayed) {
        slot.everPlayed = true;
        if (P.resumedAt > 0 && slot.idx === P.openIndex) showResumeHint();
        preloadNext();
      }
      showControls();
    });
    on('play', function () { if (slot === P.current) P.ui.paused.hidden = true; });
    on('pause', function () {
      if (slot !== P.current) return;
      save(slot);
      if (!v.ended) P.ui.paused.hidden = false;
      showControls();
    });
    on('waiting', function () { if (slot === P.current) showBufferingSoon(); });
    on('stalled', function () { if (slot === P.current && v.readyState < 3) showBufferingSoon(); });
    on('seeked', function () { if (slot === P.current) { hideBuffering(); requestPaint(); } });
    on('timeupdate', function () { if (slot === P.current) requestPaint(); });
    on('durationchange', function () { if (slot === P.current) requestPaint(true); });
    on('ended', function () { if (slot === P.current) onEnded(slot); });

    var Hls = P.Hls;
    if (Hls && Hls.isSupported()) {
      var hls = new Hls(Object.assign({}, mode === 'play' ? CURRENT_CONFIG : PRELOAD_CONFIG));
      slot.hls = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, function () { slot.manifestLoaded = true; });
      hls.on(Hls.Events.FRAG_LOADED, function () { slot.netRetries = 0; });
      hls.on(Hls.Events.ERROR, function (_e, data) {
        if (!data.fatal || slot.hls !== hls) return;
        console.warn('player: stream error', data.type, data.details);
        // No codec in the stream that this browser can decode: retrying cannot help.
        if (data.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR) return fail(slot, true);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (!navigator.onLine) return; // "online" restarts it
          if (slot.netRetries >= 3) return fail(slot);
          var wait = 1000 * Math.pow(2, slot.netRetries++);
          slot.retryTimer = setTimeout(function () {
            slot.retryTimer = 0;
            if (slot.hls !== hls) return;
            if (slot.manifestLoaded) hls.startLoad(); else hls.loadSource(ep.videoUrl);
          }, wait);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && slot.mediaRecoveries < 2) {
          if (slot.mediaRecoveries++ === 1) hls.swapAudioCodec();
          hls.recoverMediaError();
        } else {
          fail(slot);
        }
      });
      hls.loadSource(ep.videoUrl);
      hls.attachMedia(v);
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      on('error', function () {
        console.warn('player: native playback error', v.error && v.error.code);
        fail(slot);
      });
      v.preload = 'auto';
      v.src = ep.videoUrl;
    } else {
      fail(slot, true);
    }
  }

  /** The preloaded next episode becomes the current one: give it the full buffer. */
  function promote(slot) {
    if (!slot.hls) return;
    slot.hls.config.maxBufferLength = CURRENT_CONFIG.maxBufferLength;
    slot.hls.config.maxMaxBufferLength = CURRENT_CONFIG.maxMaxBufferLength;
    slot.hls.startLoad(slot.video.currentTime || -1);
  }

  function preloadNext() {
    var next = slotFor(P.index + 1);
    if (next && !next.attached && playable(episodeAt(next.idx))) {
      next.video.muted = true;
      attach(next, 'preload');
    }
  }

  function fail(slot, unsupported) {
    if (slot.failed) return;
    slot.failed = true;
    if (slot === P.current) { save(slot); hideBuffering(); P.ui.unmute.hidden = true; }
    if (slot.hls) slot.hls.stopLoad();
    slot.load.hidden = true;
    slot.errTitle.textContent = unsupported ? 'This browser cannot play this episode' : 'Could not play this episode';
    slot.errText.textContent = 'Your place is saved. Try again, or go back to the series.';
    slot.errorBox.hidden = false;
  }

  function retry(slot) {
    if (slot.idx < 0) return;
    var wasCurrent = slot === P.current;
    var at = slot.video.currentTime || 0;
    releaseMedia(slot);
    if (!wasCurrent) return;
    if (at > 0) P.pendingSeek = at;
    attach(slot, 'play');
    applyMute(slot);
    addTrack(slot, episodeAt(slot.idx));
    slot.wantPlay = true;
    tryPlay(slot);
  }

  /** play(), falling back to muted when the browser refuses sound without a tap. */
  function tryPlay(slot) {
    var v = slot.video;
    slot.wantPlay = true;
    var p = v.play();
    if (!p || !p.then) return;
    p.then(function () { slot.wantPlay = false; }, function (err) {
      if (!P || slot !== P.current || !err) return;
      if (err.name === 'NotAllowedError') {
        if (!v.muted) {
          v.muted = true;
          P.ui.unmute.hidden = false;
          paintMute();
          tryPlay(slot);
        } else {
          slot.wantPlay = false;
          P.ui.paused.hidden = false;
        }
      }
      // Anything else (no data yet, interrupted by a swipe): "canplay" tries again.
    });
  }

  function togglePlay() {
    var s = P.current;
    if (!s || !s.attached || s.failed) return;
    if (s.video.paused) {
      if (s.video.ended) s.video.currentTime = 0;
      hideEndCard();
      tryPlay(s);
    } else {
      s.wantPlay = false;
      s.video.pause();
    }
  }

  function seekBy(delta) {
    var s = P.current;
    if (!s || !s.ready) return;
    var d = duration(s);
    s.video.currentTime = Math.max(0, Math.min(d - 0.5, s.video.currentTime + delta));
    flashBadge(delta > 0 ? '+' + SEEK_STEP + 's' : '−' + SEEK_STEP + 's');
    requestPaint(true);
  }

  // ── Mute and subtitles ────────────────────────────────────────────────
  function applyMute(slot) {
    slot.video.muted = P.muted;
    P.ui.unmute.hidden = true;
    paintMute();
  }

  function paintMute() {
    var muted = P.current ? P.current.video.muted : P.muted;
    // SVG elements have no .hidden property; toggle the attribute.
    P.ui.soundIcon.toggleAttribute('hidden', muted);
    P.ui.mutedIcon.toggleAttribute('hidden', !muted);
    P.ui.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  function toggleMute() {
    var s = P.current;
    if (!s || !s.attached) return;
    P.muted = !s.video.muted;
    writePref('dtv.muted', P.muted ? '1' : '0');
    s.video.muted = P.muted;
    P.ui.unmute.hidden = true;
    paintMute();
  }

  function addTrack(slot, ep) {
    removeTrack(slot);
    P.ui.ccBtn.hidden = !ep.subtitlesUrl;
    if (!ep.subtitlesUrl) return;
    var t = document.createElement('track');
    t.kind = 'subtitles';
    t.srclang = 'en';
    t.label = 'English';
    t.src = ep.subtitlesUrl;
    slot.video.appendChild(t);
    slot.track = t;
    t.track.mode = P.subs ? 'showing' : 'hidden';
    // Lift cues above the progress bar where the browser lets us place them.
    t.track.addEventListener('cuechange', function () {
      var cues = t.track.activeCues || [];
      for (var i = 0; i < cues.length; i++) if ('line' in cues[i] && cues[i].line !== -4) cues[i].line = -4;
    }, slot.ac ? { signal: slot.ac.signal } : undefined);
    paintSubs();
  }

  function removeTrack(slot) {
    if (slot.track) { slot.track.remove(); slot.track = null; }
  }

  function paintSubs() {
    P.ui.ccBtn.setAttribute('aria-pressed', P.subs ? 'true' : 'false');
    P.ui.ccBtn.setAttribute('aria-label', P.subs ? 'Subtitles on' : 'Subtitles off');
  }

  function toggleSubs() {
    var s = P.current;
    if (!s || !s.track) return;
    P.subs = !P.subs;
    writePref('dtv.subtitles', P.subs ? '1' : '0');
    s.track.track.mode = P.subs ? 'showing' : 'hidden';
    paintSubs();
  }

  // ── Watch history ─────────────────────────────────────────────────────
  /** Save where the viewer is in a slide's episode. Signed-in viewers only; failures retry on the next tick. */
  function save(slot, keepalive) {
    if (!P || !P.canSave || !slot || slot.idx < 0 || !slot.attached || !slot.ready) return;
    var ep = episodeAt(slot.idx);
    if (!playable(ep)) return;
    var t = slot.video.currentTime || 0;
    var completed = slot.completed || t >= duration(slot) - 2;
    var pos = Math.floor(t);
    if (pos === slot.lastSaved && completed === slot.lastCompleted) return;
    slot.lastSaved = pos;
    slot.lastCompleted = completed;
    ctx.api('/api/me/watch-history/' + ep.id, 'PUT', { positionSeconds: pos, completed: completed },
      keepalive ? { keepalive: true } : undefined).catch(function () { slot.lastSaved = -1; });
  }

  function applyResume(slot) {
    if (P.pendingSeek) {
      slot.video.currentTime = P.pendingSeek;
      P.pendingSeek = 0;
      return;
    }
    if (P.resumeUsed || slot.idx !== P.openIndex) return;
    P.resumeUsed = true;
    var r = P.resume;
    if (!r || r.completed || r.positionSeconds <= 5 || r.positionSeconds >= duration(slot) - 10) return;
    slot.video.currentTime = r.positionSeconds;
    P.resumedAt = r.positionSeconds;
  }

  function showResumeHint() {
    P.ui.resumeText.textContent = 'Resumed at ' + clock(P.resumedAt);
    P.ui.resume.hidden = false;
    later('resume', 4000, function () { P.ui.resume.hidden = true; });
  }

  // ── Overlay ───────────────────────────────────────────────────────────
  // Before the first frame the slide's own spinner shows; this one is for stalls after it.
  function showBufferingSoon() {
    if (!P.current || !P.current.ready || P.timers.buffer || !P.ui.buffering.hidden) return;
    later('buffer', 500, function () { P.ui.buffering.hidden = false; });
  }
  function hideBuffering() {
    clearTimer('buffer');
    P.ui.buffering.hidden = true;
  }

  function flashBadge(text) {
    P.ui.badge.textContent = text;
    P.ui.badge.hidden = false;
    later('badge', 600, function () { P.ui.badge.hidden = true; });
  }

  /** Show the controls; while an episode plays they fade again after 3 s. */
  function showControls() {
    P.ui.chrome.removeAttribute('data-idle');
    clearTimer('controls');
    var s = P.current;
    if (s && s.attached && !s.video.paused && !P.scrubbing) {
      later('controls', 3000, function () { P.ui.chrome.setAttribute('data-idle', ''); });
    }
  }

  /** Paint the progress bar and time, at most once a frame and only when they change. */
  function requestPaint(force) {
    if (force) P.lastSecond = -1;
    if (P.raf || document.hidden) return;
    P.raf = requestAnimationFrame(paint);
  }
  function paint() {
    if (!P) return;
    P.raf = 0;
    var s = P.current;
    if (!s || !s.attached || P.scrubbing) return;
    var d = duration(s);
    var t = s.video.currentTime || 0;
    setProgress(d > 0 ? t / d : 0);
    var sec = Math.floor(t);
    var total = Math.floor(d);
    if (sec !== P.lastSecond || total !== P.lastTotal) {
      P.lastSecond = sec;
      P.lastTotal = total;
      P.ui.time.textContent = clock(t) + ' / ' + clock(d);
      P.ui.bar.setAttribute('aria-valuenow', String(sec));
      P.ui.bar.setAttribute('aria-valuemax', String(total));
      P.ui.bar.setAttribute('aria-valuetext', clock(t) + ' of ' + clock(d));
    }
  }
  function setProgress(frac) {
    frac = Math.max(0, Math.min(1, frac));
    if (Math.abs(frac - P.lastFrac) < 0.0005) return;
    P.lastFrac = frac;
    P.ui.fill.style.transform = 'scaleX(' + frac + ')';
    P.ui.thumb.style.transform = 'translateX(' + (frac * 100) + '%)';
  }

  /** Point the overlay at the current episode. */
  function bindOverlay(ep) {
    var i = P.index;
    var locked = ep.state === 'locked';
    var next = episodeAt(i + 1);
    P.ui.count.textContent = 'Episode ' + ep.number + ' of ' + P.playlist.length;
    P.ui.title.textContent = ep.title;
    P.ui.meta.textContent = [P.series.genre, next ? 'Swipe up for episode ' + next.number : '']
      .filter(Boolean).join(' · ');
    P.ui.media.hidden = locked;
    P.ui.muteBtn.hidden = locked;
    P.ui.ccBtn.hidden = locked || !ep.subtitlesUrl;
    P.ui.paused.hidden = true;
    P.ui.unmute.hidden = true;
    P.ui.resume.hidden = true;
    P.ui.badge.hidden = true;
    hideBuffering();
    hideEndCard();
    P.lastFrac = -1;
    P.lastSecond = -1;
    setProgress(0);
    P.ui.time.textContent = '';
    paintMute();
  }

  function paintFollow() {
    var f = P.series.following;
    P.ui.followBtn.className = f ? 'btn-secondary' : 'btn-primary';
    P.ui.followBtn.textContent = f ? 'Following' : 'Follow';
    P.ui.followBtn.setAttribute('aria-pressed', f ? 'true' : 'false');
  }

  function toggleFollow() {
    if (ctx.isGuest()) return ctx.askForAccount('follow this series');
    var btn = P.ui.followBtn;
    var seq = P.seq;
    btn.disabled = true;
    ctx.api('/api/series/' + encodeURIComponent(P.series.slug) + '/follow', P.series.following ? 'DELETE' : 'PUT')
      .then(function (r) { if (P && P.seq === seq) P.series.following = r.following; })
      .catch(function () {})
      .then(function () { if (P && P.seq === seq) { btn.disabled = false; paintFollow(); } });
  }

  // ── End of an episode ─────────────────────────────────────────────────
  function hideEndCard() {
    clearTimer('countdown');
    if (P.ui) P.ui.end.hidden = true;
  }

  function onEnded(slot) {
    slot.completed = true;
    save(slot);
    P.ui.paused.hidden = true;
    showControls();
    var next = episodeAt(P.index + 1);
    var ui = P.ui;
    ui.end.hidden = false;
    ui.endAlt.hidden = true;
    if (!next) {
      ui.endLabel.textContent = 'That was the last episode';
      ui.endTitle.textContent = P.series.title;
      ui.endPrimary.textContent = 'Back to series';
      ui.endAction = backToSeries;
      ui.endAlt.hidden = false;
      ui.endAlt.textContent = 'Replay';
      ui.endAltAction = replay;
      return;
    }
    ui.endTitle.textContent = 'Episode ' + next.number + ' · ' + next.title;
    if (next.state === 'locked') {
      ui.endLabel.textContent = 'Episode ' + next.number + ' is locked';
      ui.endPrimary.textContent = 'Next episode';
      ui.endAction = function () { go(P.index + 1, 0); };
      return;
    }
    var left = COUNTDOWN;
    ui.endLabel.textContent = 'Next episode in ' + left;
    ui.endPrimary.textContent = 'Play now';
    ui.endAction = function () { go(P.index + 1, 0); };
    ui.endAlt.hidden = false;
    ui.endAlt.textContent = 'Cancel';
    ui.endAltAction = cancelCountdown;
    clearTimer('countdown');
    P.timers.countdown = setInterval(function () {
      left -= 1;
      if (left <= 0) { clearTimer('countdown'); go(P.index + 1, 0); return; }
      ui.endLabel.textContent = 'Next episode in ' + left;
    }, 1000);
  }

  /** Stop the countdown but keep the card, offering Replay instead of Cancel. */
  function cancelCountdown() {
    if (!P.timers.countdown) return false;
    clearTimer('countdown');
    var next = episodeAt(P.index + 1);
    P.ui.endLabel.textContent = 'Up next';
    P.ui.endTitle.textContent = 'Episode ' + next.number + ' · ' + next.title;
    P.ui.endAlt.textContent = 'Replay';
    P.ui.endAltAction = replay;
    return true;
  }

  function replay() {
    var s = P.current;
    hideEndCard();
    if (!s || !s.attached) return;
    s.video.currentTime = 0;
    tryPlay(s);
  }

  // ── Unlock (Phase 6 replaces the body of openUnlockSheet with the unlock sheet) ──
  function openUnlockSheet(ep, opts) {
    if (ctx.isGuest()) return ctx.askForAccount('unlock this episode');
    var seq = P.seq;
    opts.button.disabled = true;
    opts.message.textContent = '';
    ctx.api('/api/episodes/' + ep.id + '/unlock', 'POST')
      .then(function (r) { if (P && P.seq === seq) opts.onUnlocked(r.episode); })
      .catch(function (err) {
        if (!P || P.seq !== seq) return;
        opts.button.disabled = false;
        if (err.status === 402) opts.message.textContent = 'Not enough coins to unlock episode ' + ep.number + '.';
        else if (err.status !== 401) opts.message.textContent = 'Could not unlock. Try again.';
      });
  }

  function onUnlocked(episode) {
    var i = -1;
    P.playlist.forEach(function (e, k) { if (e.id === episode.id) i = k; });
    if (i < 0) return;
    P.playlist[i] = episode;
    var slot = slotFor(i);
    if (!slot) return;
    releaseMedia(slot);
    mount(slot, i);
    if (i === P.index) enterCurrent();
    else if (i === P.index + 1 && P.current && P.current.everPlayed) preloadNext();
  }

  // ── Moving between episodes ───────────────────────────────────────────
  function leaveCurrent() {
    var s = P.current;
    clearTimers();
    endHold();
    if (!s) return;
    save(s);
    s.wantPlay = false;
    s.video.pause();
    s.video.playbackRate = 1;
    removeTrack(s);
    if (s.hls) s.hls.stopLoad();
    P.current = null;
  }

  function enterCurrent() {
    var s = slotFor(P.index);
    var ep = episodeAt(P.index);
    P.current = s;
    bindOverlay(ep);
    paintFollow();
    showControls();
    if (!playable(ep)) return;
    if (!s.attached) attach(s, 'play');
    else if (s.failed) { retry(s); return startSaving(); }
    else promote(s);
    applyMute(s);
    addTrack(s, ep);
    if (s.ready) s.video.classList.remove('opacity-0');
    tryPlay(s);
    if (s.everPlayed) preloadNext();
    requestPaint(true);
    startSaving();
  }

  function startSaving() {
    if (!P.canSave) return;
    clearTimer('save');
    P.timers.save = setInterval(function () {
      if (P.current && !P.current.video.paused) save(P.current);
    }, 5000);
  }

  function hasEpisode(i) { return i >= 0 && i < P.playlist.length; }

  /** Move to episode i. dy is how far a drag already moved the track, so the slide continues from there. */
  function go(i, dy) {
    if (!hasEpisode(i) || i === P.index) return snapBack();
    var dir = i > P.index ? 1 : -1;
    var height = P.layer.clientHeight;
    leaveCurrent();
    P.index = i;
    syncWindow();
    var track = P.ui.track;
    track.style.transition = 'none';
    track.style.transform = 'translate3d(0,' + (dy + dir * height) + 'px,0)';
    void track.offsetHeight;
    track.style.willChange = 'transform';
    track.style.transition = 'transform 200ms ease-out';
    track.style.transform = 'translate3d(0,0,0)';
    later('anim', 220, function () { track.style.transition = ''; track.style.willChange = ''; });
    enterCurrent();
    history.replaceState(null, '', location.pathname + location.search + '#/watch/' + episodeAt(i).id);
  }

  function snapBack() {
    var track = P.ui.track;
    track.style.transition = 'transform 200ms ease-out';
    track.style.transform = 'translate3d(0,0,0)';
    later('anim', 220, function () { track.style.transition = ''; track.style.willChange = ''; });
  }

  // ── Gestures ──────────────────────────────────────────────────────────
  // One pointer handler on the layer. Buttons, links and the progress bar
  // ([data-nogesture]) are left to their own handlers.
  function startHold() {
    var s = P.current;
    if (!s || !s.attached || s.video.paused) { P.g.mode = 'none'; return; }
    P.holding = true;
    s.video.playbackRate = 2;
    clearTimer('badge');
    P.ui.badge.textContent = '2×';
    P.ui.badge.hidden = false;
  }
  function endHold() {
    if (!P.holding) return;
    P.holding = false;
    if (P.current) P.current.video.playbackRate = 1;
    P.ui.badge.hidden = true;
  }

  function onTap(x) {
    if (cancelCountdown()) return;
    var third = P.g.width / 3;
    var last = P.lastTap;
    if (last && Date.now() - last.t < 250 && Math.abs(x - last.x) < 40) {
      clearTimer('tap');
      P.lastTap = null;
      if (x < third) seekBy(-SEEK_STEP);
      else if (x > third * 2) seekBy(SEEK_STEP);
      return;
    }
    P.lastTap = { t: Date.now(), x: x };
    later('tap', 250, function () {
      P.lastTap = null;
      togglePlay();
      showControls();
    });
  }

  function bindGestures(layer) {
    var signal = P.ac.signal;
    P.g = { mode: 'none' };

    layer.addEventListener('pointerdown', function (e) {
      if (P.g.mode !== 'none' || e.button > 0) return;
      if (e.target.closest('button, a, [data-nogesture]')) return;
      var rect = layer.getBoundingClientRect();
      P.g = {
        mode: 'pending', id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp,
        left: rect.left, width: rect.width, height: rect.height, dy: 0,
      };
      try { layer.setPointerCapture(e.pointerId); } catch (_) {}
      later('longPress', 450, function () { if (P.g.mode === 'pending') { P.g.mode = 'hold'; startHold(); } });
    }, { signal: signal });

    layer.addEventListener('pointermove', function (e) {
      var g = P.g;
      if (g.id !== e.pointerId || g.mode === 'none' || g.mode === 'hold') return;
      var dx = e.clientX - g.x0;
      var dy = e.clientY - g.y0;
      if (g.mode === 'pending') {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        clearTimer('longPress');
        if (Math.abs(dy) >= Math.abs(dx)) {
          g.mode = 'drag';
          cancelCountdown();
          P.ui.track.style.transition = 'none';
          P.ui.track.style.willChange = 'transform';
        } else {
          g.mode = 'ignored';
          return;
        }
      }
      if (g.mode !== 'drag') return;
      // Rubber-band past the first and last episode.
      var target = dy < 0 ? P.index + 1 : P.index - 1;
      g.dy = hasEpisode(target) ? dy : dy * 0.3;
      P.ui.track.style.transform = 'translate3d(0,' + g.dy + 'px,0)';
    }, { passive: true, signal: signal });

    function finish(e, cancelled) {
      var g = P.g;
      if (g.id !== e.pointerId) return;
      clearTimer('longPress');
      P.g = { mode: 'none' };
      if (g.mode === 'hold') return endHold();
      if (g.mode === 'drag') {
        var dt = Math.max(1, e.timeStamp - g.t0);
        var dy = e.clientY - g.y0;
        var fast = Math.abs(dy) / dt > 0.5;
        var target = dy < 0 ? P.index + 1 : P.index - 1;
        if (!cancelled && hasEpisode(target) && (Math.abs(dy) > g.height * 0.2 || fast)) go(target, g.dy);
        else snapBack();
        return;
      }
      if (g.mode === 'pending' && !cancelled) onTap(e.clientX - g.left);
    }
    layer.addEventListener('pointerup', function (e) { finish(e, false); }, { signal: signal });
    layer.addEventListener('pointercancel', function (e) { finish(e, true); }, { signal: signal });

    layer.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaY) < 4 || P.timers.wheel) return;
      cancelCountdown();
      go(P.index + (e.deltaY > 0 ? 1 : -1), 0);
      later('wheel', 400, function () {});
    }, { passive: true, signal: signal });

    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      var onButton = e.target && e.target.closest && e.target.closest('button, a, input, textarea');
      var k = e.key;
      if (k === 'Escape') return backToSeries();
      if (k === 'ArrowDown') { e.preventDefault(); cancelCountdown(); return go(P.index + 1, 0); }
      if (k === 'ArrowUp') { e.preventDefault(); cancelCountdown(); return go(P.index - 1, 0); }
      if (onButton) return;
      if (k === ' ') { e.preventDefault(); cancelCountdown(); togglePlay(); showControls(); }
      else if (k === 'ArrowLeft') { e.preventDefault(); seekBy(-SEEK_STEP); showControls(); }
      else if (k === 'ArrowRight') { e.preventDefault(); seekBy(SEEK_STEP); showControls(); }
      else if (k === 'm' || k === 'M') toggleMute();
      else if (k === 'c' || k === 'C') toggleSubs();
    }, { signal: signal });
  }

  /** Drag along the progress bar to seek. */
  function bindScrub(bar) {
    var signal = P.ac.signal;
    var rect = null;
    function fracAt(e) { return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); }
    bar.addEventListener('pointerdown', function (e) {
      var s = P.current;
      if (!s || !s.ready) return;
      rect = bar.getBoundingClientRect();
      P.scrubbing = true;
      clearTimer('controls');
      cancelCountdown();
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
      setProgress(fracAt(e));
    }, { signal: signal });
    bar.addEventListener('pointermove', function (e) {
      if (P.scrubbing) setProgress(fracAt(e));
    }, { passive: true, signal: signal });
    function end(e, commit) {
      if (!P.scrubbing) return;
      P.scrubbing = false;
      var s = P.current;
      if (commit && s && s.ready) s.video.currentTime = fracAt(e) * duration(s);
      requestPaint(true);
      showControls();
    }
    bar.addEventListener('pointerup', function (e) { end(e, true); }, { signal: signal });
    bar.addEventListener('pointercancel', function (e) { end(e, false); }, { signal: signal });
  }

  // ── Page lifecycle and connection ─────────────────────────────────────
  function bindLifecycle() {
    var signal = P.ac.signal;
    document.addEventListener('visibilitychange', function () {
      var s = P.current;
      if (document.hidden) {
        save(s, true);
        cancelCountdown();
        P.resumeOnShow = !!(s && s.attached && !s.video.paused);
        if (s) { s.wantPlay = false; s.video.pause(); }
        P.slots.forEach(function (x) { if (x.hls) x.hls.stopLoad(); });
      } else {
        if (s && s.hls && !s.failed) s.hls.startLoad(s.video.currentTime || -1);
        if (s && P.resumeOnShow) tryPlay(s);
        P.resumeOnShow = false;
        requestPaint(true);
      }
    }, { signal: signal });
    window.addEventListener('pagehide', function () { if (P) save(P.current, true); }, { signal: signal });
    window.addEventListener('offline', function () { P.ui.offline.hidden = false; }, { signal: signal });
    window.addEventListener('online', function () {
      P.ui.offline.hidden = true;
      var s = P.current;
      if (!s || !s.attached) return;
      if (s.failed) return retry(s);
      if (s.hls) {
        if (s.manifestLoaded) s.hls.startLoad(s.video.currentTime || -1);
        else s.hls.loadSource(episodeAt(s.idx).videoUrl);
      }
      var next = slotFor(P.index + 1);
      if (next && next.hls && !next.failed) next.hls.startLoad();
    }, { signal: signal });
  }

  // ── Building the screen ───────────────────────────────────────────────
  function buildStage() {
    var ui = {};
    ui.track = h('div', 'absolute inset-0');
    P.slots = [makeSlot(), makeSlot(), makeSlot()];
    P.slots.forEach(function (s) { ui.track.appendChild(s.el); });

    var fade = 'transition-opacity duration-200 group-data-[idle]:pointer-events-none group-data-[idle]:opacity-0';

    // Top: back, series, "Episode N of M"; the offline strip under it.
    ui.count = h('p', 'truncate text-body font-medium');
    var back = button('btn-icon pointer-events-auto shrink-0', [icon(ICON_BACK)], backToSeries);
    back.setAttribute('aria-label', 'Back to series');
    var top = h('div', 'player-top absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-ground/70 to-transparent px-2 pb-8 ' + fade, [
      back,
      h('div', 'min-w-0', [h('p', 'truncate text-small text-muted', P.series.title), ui.count]),
    ]);
    ui.offline = h('p', 'player-top-strip absolute inset-x-4 rounded-lg bg-surface px-4 py-2 text-center text-small text-fg',
      'You’re offline. Playback continues when you reconnect.');
    ui.offline.setAttribute('role', 'status');
    ui.offline.hidden = navigator.onLine !== false;

    // Centre: buffering, paused, seek / 2x badge, "Tap to unmute".
    ui.buffering = spinner();
    ui.buffering.hidden = true;
    ui.paused = h('div', 'pointer-events-none absolute left-1/2 top-1/2 -ml-8 -mt-8 flex h-16 w-16 items-center justify-center rounded-full bg-ground/60 text-fg', [icon(ICON_PLAY, true)]);
    ui.paused.hidden = true;
    ui.badge = h('p', 'pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 rounded-full bg-ground/70 px-4 py-2 text-body font-semibold');
    ui.badge.setAttribute('aria-live', 'polite');
    ui.badge.hidden = true;
    ui.unmute = button('btn-secondary pointer-events-auto absolute left-1/2 top-24 -translate-x-1/2 rounded-full', 'Tap to unmute', function () {
      P.muted = false;
      writePref('dtv.muted', '0');
      if (P.current) P.current.video.muted = false;
      ui.unmute.hidden = true;
      paintMute();
    });
    ui.unmute.hidden = true;

    // Right rail: Follow, Mute, CC.
    ui.followBtn = button('btn-primary', 'Follow', toggleFollow);
    ui.soundIcon = icon(ICON_SOUND);
    ui.mutedIcon = icon(ICON_MUTED);
    ui.muteBtn = button('btn-icon', [ui.soundIcon, ui.mutedIcon], toggleMute);
    ui.ccBtn = button('btn-icon text-small font-semibold aria-pressed:bg-accent aria-pressed:text-on-accent', 'CC', toggleSubs);
    ui.ccBtn.hidden = true;
    var rail = h('div', 'pointer-events-auto flex shrink-0 flex-col items-center gap-3 ' + fade, [ui.followBtn, ui.muteBtn, ui.ccBtn]);

    // Bottom: title and genre, resume hint, time and the progress bar.
    ui.title = h('h1', 'text-heading');
    ui.meta = h('p', 'text-small text-muted');
    ui.resumeText = h('span', '');
    var startOver = button('min-h-11 px-2 font-medium text-accent', 'Start over', function () {
      if (P.current) P.current.video.currentTime = 0;
      ui.resume.hidden = true;
      clearTimer('resume');
    });
    ui.resume = h('p', 'pointer-events-auto inline-flex items-center gap-1 self-start rounded-full bg-surface pl-4 pr-2 text-small', [ui.resumeText, ' ·', startOver]);
    ui.resume.hidden = true;
    ui.time = h('p', 'text-right text-small text-muted ' + fade);
    ui.fill = h('div', 'h-1 w-full origin-left rounded-full bg-accent');
    ui.fill.style.transform = 'scaleX(0)';
    ui.thumb = h('div', 'absolute inset-0', [h('div', 'absolute left-0 top-1/2 -ml-2 -mt-2 h-4 w-4 rounded-full bg-accent ' + fade)]);
    ui.bar = h('div', 'pointer-events-auto relative flex h-11 cursor-pointer touch-none items-center', [
      h('div', 'relative h-1 w-full rounded-full bg-line', [ui.fill, ui.thumb]),
    ]);
    ui.bar.dataset.nogesture = '';
    ui.bar.dataset.testid = 'player-progress';
    ui.bar.setAttribute('role', 'slider');
    ui.bar.setAttribute('aria-label', 'Seek');
    ui.bar.setAttribute('aria-valuemin', '0');
    ui.media = h('div', '', [ui.time, ui.bar]);

    // End card: countdown, locked next episode, or the last episode.
    ui.endLabel = h('p', 'text-small text-muted');
    ui.endTitle = h('p', 'text-heading');
    ui.endPrimary = button('btn-primary flex-1', '', function () { var a = ui.endAction; hideEndCard(); a && a(); });
    ui.endAlt = button('btn-secondary flex-1', '', function () { ui.endAltAction && ui.endAltAction(); });
    ui.end = h('div', 'card pointer-events-auto flex flex-col gap-3', [
      ui.endLabel, ui.endTitle, h('div', 'flex gap-3', [ui.endPrimary, ui.endAlt]),
    ]);
    ui.end.dataset.nogesture = '';
    ui.end.dataset.testid = 'player-end-card';
    ui.end.setAttribute('aria-live', 'polite');
    ui.end.hidden = true;

    var bottom = h('div', 'player-bottom absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-ground/80 to-transparent px-4 pt-16', [
      ui.end,
      ui.resume,
      h('div', 'flex items-end gap-3', [h('div', 'min-w-0 flex-1 ' + fade, [ui.title, ui.meta]), rail]),
      ui.media,
    ]);

    ui.chrome = h('div', 'group pointer-events-none absolute inset-0 z-10', [
      ui.buffering, ui.paused, ui.badge, top, ui.offline, ui.unmute, bottom,
    ]);
    P.ui = ui;
    return [ui.track, ui.chrome];
  }

  function loadingView() {
    return h('div', 'player-top relative flex h-full flex-col gap-3 px-4', [
      h('div', 'skeleton h-5 w-40'),
      h('div', 'skeleton h-6 w-28'),
      spinner(),
    ]);
  }

  function messageView(kind, title, text, retry) {
    var all = h('a', 'btn-secondary', 'All series');
    all.href = '#/';
    var actions = [all];
    if (retry) actions.unshift(button('btn-primary', 'Retry', retry));
    return h('div', 'flex h-full items-center justify-center', [h('div', kind, [
      h('h2', 'text-heading', title),
      h('p', 'text-body text-muted', text),
      h('div', 'flex flex-wrap justify-center gap-3 pt-2', actions),
    ])]);
  }

  /** Resolve "#/watch/<slug>/<number>" to an episode id. */
  function resolveRef(ref) {
    if (ref.id) return Promise.resolve(ref.id);
    return ctx.api('/api/series/' + encodeURIComponent(ref.slug)).then(function (data) {
      var ep = data.series.episodes.filter(function (e) { return e.number === ref.number; })[0];
      if (!ep) { var err = new Error('not_found'); err.status = 404; throw err; }
      return ep.id;
    });
  }

  function load(ref) {
    var seq = P.seq;
    P.layer.replaceChildren(loadingView());
    Promise.all([
      resolveRef(ref).then(function (id) { return ctx.api('/api/watch/' + id); }),
      loadHls(),
    ]).then(function (res) {
      if (!P || P.seq !== seq) return;
      var data = res[0];
      P.Hls = res[1];
      P.series = data.series;
      P.playlist = data.playlist;
      P.resume = data.resume;
      P.index = P.openIndex = Math.max(0, data.playlist.map(function (e) { return e.id; }).indexOf(data.episode.id));
      if (!ref.id) history.replaceState(null, '', location.pathname + location.search + '#/watch/' + data.episode.id);
      P.layer.replaceChildren.apply(P.layer, buildStage());
      bindGestures(P.layer);
      bindScrub(P.ui.bar);
      bindLifecycle();
      syncWindow();
      enterCurrent();
    }).catch(function (err) {
      if (!P || P.seq !== seq) return;
      if (err && err.status === 404) {
        P.layer.replaceChildren(messageView('state-empty', 'Episode not found', 'It may have been removed.'));
      } else {
        P.layer.replaceChildren(messageView('state-error', 'Could not load this episode',
          'Check your connection and try again.', function () { load(ref); }));
      }
    });
  }

  // ── Open and close ────────────────────────────────────────────────────
  /**
   * Open the player on an episode: ref is { id } or { slug, number }. Opening
   * the episode already on screen (a hash the player wrote itself) does nothing.
   */
  function open(ref, context) {
    ctx = context;
    if (P && ref.id && (P.refId === ref.id || (P.playlist && episodeAt(P.index).id === ref.id))) return;
    close();
    var layer = h('div', 'dark fixed inset-0 z-40 touch-none select-none overflow-hidden bg-ground text-fg');
    layer.dataset.testid = 'player';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'Episode player');
    layer.tabIndex = -1;
    P = {
      seq: ++openSeq, refId: ref.id || 0, layer: layer, ac: new AbortController(), timers: {}, slots: [], ui: null,
      Hls: null, series: null, playlist: null, resume: null, index: 0, openIndex: 0, current: null,
      canSave: ctx.canSave(), muted: readPref('dtv.muted') === '1', subs: readPref('dtv.subtitles') === '1',
      resumeUsed: false, resumedAt: 0, pendingSeek: 0, raf: 0, lastFrac: -1, lastSecond: -1, lastTotal: -1,
      scrubbing: false, holding: false, lastTap: null, resumeOnShow: false, g: { mode: 'none' },
    };
    document.body.appendChild(layer);
    document.body.classList.add('overflow-hidden');
    layer.focus({ preventScroll: true });
    load(ref);
  }

  function close() {
    if (!P) return;
    var p = P;
    if (p.current) save(p.current, true);
    clearTimers();
    p.ac.abort();
    if (p.raf) cancelAnimationFrame(p.raf);
    p.slots.forEach(release);
    p.layer.remove();
    P = null;
    // Onboarding keeps the page from scrolling too; leave that to it.
    if (!document.querySelector('[aria-labelledby="onboarding-title"]')) document.body.classList.remove('overflow-hidden');
  }

  window.DtvPlayer = { open: open, close: close };
})();
