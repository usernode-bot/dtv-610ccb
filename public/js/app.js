// Dtv front end: a series browse screen, a series detail screen, the watch
// screen, the Coins page, the transaction history and the genre onboarding.
// Path routes: "/" (browse), "/series/<slug>" (detail), "/watch/<episodeId>"
// (watch), "/store" (Coins) and "/history" (transactions). Locked episodes open
// the unlock sheet. Coins only ever change on the server: the page asks for an
// action and shows the balance the server answers with. Older "#/series/<slug>" links are
// moved to the path form. Links marked data-nav navigate in place. Onboarding
// is a full-screen layer over the page, shown on "#/onboarding" and, for a
// signed-in person who has not picked genres yet, on every route until they
// do. Everything is
// built with DOM calls and textContent, so catalogue text is never parsed as
// HTML. Class names are whole literals so the Tailwind build can see them.
//
// @typedef {{id:number, slug:string, title:string, genre:string, coverUrl:string|null,
//   coverTone:number, episodeCount:number, freeEpisodeCount:number, following:boolean}} SeriesSummary
// @typedef {{id:number, number:number, title:string, durationSeconds:number,
//   coinPrice:number, state:'free'|'unlocked'|'locked',
//   positionSeconds?:number|null, watched?:boolean}} EpisodeItem

(function () {
  var root = document.getElementById('app');

  // Neutral placeholder cover tints (colour tokens only), indexed by coverTone.
  var TONES = ['bg-accent/15', 'bg-raised', 'bg-accent/30', 'bg-line', 'bg-accent/20'];

  // The iframe is opened with ?token=...; forward it on every API call.
  var token = new URLSearchParams(location.search).get('token');

  // Who is looking: { profile, onboarding } once /api/me answers, 'guest' when
  // it says account_required, null when it could not be asked.
  var me = null;

  function isGuest() { return me === 'guest'; }

  /** Ask a guest to make an account (the platform's own sheet). */
  function askForAccount(action) {
    try {
      var p = window.usernode && window.usernode.askForAccount && window.usernode.askForAccount({ action: action });
      if (p && p.catch) p.catch(function () {});
    } catch (_) {}
  }

  /** @returns {Promise<any>} parsed JSON; rejects with an Error carrying .status */
  function api(path, method, body) {
    var headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers['x-usernode-token'] = token;
    if (window.usernode && window.usernode.previewNow && window.usernode.now) {
      headers['x-usernode-now'] = window.usernode.now().toISOString();
    }
    var init = { method: method || 'GET', headers: headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body.error || 'Request failed');
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  /** Tiny element builder: h('p', 'text-body', ['child', node]) */
  function h(tag, cls, children) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    [].concat(children || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function count(n) {
    try { return n.toLocaleString(); } catch (_) { return String(n); }
  }

  function coins(n) { return count(n) + ' ' + (n === 1 ? 'coin' : 'coins'); }

  function signedIn() { return !!(me && me !== 'guest' && me.profile); }

  /** The balance the server last told us. */
  function setBalance(n) { if (signedIn()) me.profile.coinBalance = n; }

  function refreshMe() {
    return api('/api/me').then(function (data) { me = data; return data; });
  }

  function minutes(seconds) {
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Small stroked icons in currentColor, 24-unit grid. Each shape is
  // [tag, {attr: value}].
  var ICONS = {
    lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]],
    unlock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 7.5-2' }]],
    coin: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 5 }]],
    play: [['path', { d: 'M7 5l12 7-12 7z' }]],
    check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
    share: [['path', { d: 'M12 3v12' }], ['path', { d: 'M7 8l5-5 5 5' }], ['path', { d: 'M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6' }]],
  };

  function icon(name, cls) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls || 'h-4 w-4');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    ICONS[name].forEach(function (shape) {
      var el = document.createElementNS(NS, shape[0]);
      Object.keys(shape[1]).forEach(function (k) { el.setAttribute(k, String(shape[1][k])); });
      svg.appendChild(el);
    });
    return svg;
  }

  /** An in-app link: navigates without reloading (see the click handler under Routing). */
  function navLink(path, cls, children) {
    var a = h('a', cls, children);
    a.href = path;
    a.dataset.nav = '';
    return a;
  }

  function compact(n) {
    try { return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n); }
    catch (_) { return String(n); }
  }

  /** Cover art: the image when there is one, else a tinted tile with the title's initial. */
  function cover(s, sizeCls, letterCls) {
    var box = h('div', 'flex items-center justify-center overflow-hidden ' + sizeCls + ' ' + (TONES[s.coverTone % TONES.length] || TONES[0]));
    if (s.coverUrl) {
      var img = h('img', 'h-full w-full object-cover');
      img.src = s.coverUrl;
      img.alt = '';
      box.appendChild(img);
    } else {
      box.appendChild(h('span', letterCls, s.title.charAt(0)));
    }
    return box;
  }

  function show(node) {
    root.replaceChildren(node);
    window.scrollTo(0, 0);
  }

  // ── States ────────────────────────────────────────────────────────────
  function loadingBrowse() {
    var grid = h('div', 'grid grid-cols-2 gap-4 sm:grid-cols-3');
    for (var i = 0; i < 6; i++) {
      grid.appendChild(h('div', 'flex flex-col gap-2', [
        h('div', 'skeleton aspect-[3/4] w-full'),
        h('div', 'skeleton h-5 w-3/4'),
        h('div', 'skeleton h-4 w-1/2'),
      ]));
    }
    return h('div', 'flex flex-col gap-4', [h('div', 'skeleton h-7 w-32'), grid]);
  }

  function loadingDetail() {
    return h('div', 'flex flex-col gap-4', [
      h('div', 'skeleton h-5 w-24'),
      h('div', 'skeleton h-40 w-full sm:h-56'),
      h('div', 'skeleton h-8 w-2/3'),
      h('div', 'skeleton h-16 w-full'),
      h('div', 'skeleton h-11 w-full'),
      h('div', 'skeleton h-48 w-full'),
    ]);
  }

  function errorState(message, retry, backLink) {
    var retryBtn = h('button', 'btn-primary', 'Retry');
    retryBtn.type = 'button';
    retryBtn.addEventListener('click', retry);
    return h('div', 'state-error', [
      h('h2', 'text-heading', message),
      h('p', 'text-body text-muted', 'Check your connection and try again.'),
      retryBtn,
      backLink || null,
    ]);
  }

  // ── Browse ────────────────────────────────────────────────────────────
  function tile(/** @type {SeriesSummary} */ s) {
    var a = navLink('/series/' + encodeURIComponent(s.slug), 'flex flex-col gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
      cover(s, 'aspect-[3/4] w-full rounded-xl border border-line', 'text-title text-fg'),
      h('div', 'flex flex-col', [
        h('h2', 'text-body font-semibold', s.title),
        h('p', 'text-small text-muted', plural(s.episodeCount, 'episode', 'episodes') + (s.genre ? ' · ' + s.genre : '')),
        s.following ? h('p', 'text-small font-medium text-accent', 'Following') : null,
      ]),
    ]);
    a.dataset.testid = 'series-tile';
    return a;
  }

  function renderBrowse() {
    show(loadingBrowse());
    api('/api/series').then(function (data) {
      var page = h('div', 'flex flex-col gap-4');
      page.appendChild(h('div', 'flex items-center justify-between gap-4', [h('h1', 'text-title', 'Series'), coinChip()]));
      if (data.demo) {
        page.appendChild(h('p', 'text-small text-muted', 'Staging demo catalogue: these series are made up for testing.'));
      }
      if (!data.series.length) {
        page.appendChild(h('div', 'state-empty', [
          h('h2', 'text-heading', 'No series yet'),
          h('p', 'text-body text-muted', 'New series will appear here as soon as they are added.'),
        ]));
      } else {
        var grid = h('div', 'grid grid-cols-2 gap-4 sm:grid-cols-3');
        grid.dataset.testid = 'series-grid';
        data.series.forEach(function (s) { grid.appendChild(tile(s)); });
        page.appendChild(grid);
      }
      show(page);
    }).catch(function () {
      show(errorState('Could not load series', renderBrowse));
    });
  }

  /** The balance button on the Series screen; it opens the Coins page. */
  function coinChip() {
    var a = navLink('/store', 'inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-body font-medium text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
      icon('coin', 'h-4 w-4 text-accent'),
      signedIn() ? coins(me.profile.coinBalance) : 'Coins',
    ]);
    a.dataset.testid = 'coin-balance';
    return a;
  }

  // ── Unlock ────────────────────────────────────────────────────────────
  // A locked episode opens the unlock sheet: coins, a rewarded ad, the rest
  // of the series at a discount, or the Coins page. Another sheet can still
  // plug in by setting
  //   window.dtv.openUnlockSheet = function (ctx) { ... }
  // where ctx is { episode, series, notice(text), onUnlocked() }: call
  // onUnlocked() once the episode is unlocked so the screen reloads.
  window.dtv = window.dtv || {};

  // Rewarded ads play through window.dtv.adProvider, so a real ad SDK can
  // replace this stand-in: show({ sessionId, minSeconds, label, onComplete(payload),
  // onCancel(), onError(err) }). The payload goes to the server, which grants
  // the unlock (app/routes/ads.ts); the page never unlocks anything itself.
  // Always the dark look, like onboarding.
  var mockAdProvider = {
    name: 'mock',
    show: function (o) {
      var left = o.minSeconds;
      var prevFocus = document.activeElement;
      var skip = h('button', 'btn-secondary', 'Skip ad');
      skip.type = 'button';
      var number = h('span', 'text-title', String(left));
      var foot = h('p', 'text-center text-body');
      foot.setAttribute('role', 'status');
      var ad = h('div', 'dark fixed inset-0 z-[60] flex flex-col gap-4 bg-ground p-4 text-fg', [
        h('div', 'mx-auto flex w-full max-w-2xl items-center justify-between', [
          h('span', 'text-small text-muted', 'Sample ad'), skip,
        ]),
        h('div', 'mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-line bg-raised p-6 text-center', [
          h('h2', 'text-heading', 'Your ad would play here'),
          h('p', 'text-body text-muted', 'This is a stand-in until a real ad partner is connected.'),
        ]),
        h('div', 'mx-auto flex h-20 w-20 items-center justify-center rounded-full border-4 border-accent motion-safe:animate-pulse', [number]),
        foot,
      ]);
      ad.setAttribute('role', 'dialog');
      ad.setAttribute('aria-modal', 'true');
      ad.setAttribute('aria-label', 'Sample ad');
      ad.dataset.testid = 'ad-player';
      function paint() {
        number.textContent = String(left);
        foot.textContent = o.label + ' unlocks in ' + plural(left, 'second', 'seconds');
      }
      function close() {
        clearInterval(timer);
        document.removeEventListener('keydown', onKey);
        ad.remove();
        if (prevFocus && prevFocus.focus) prevFocus.focus();
      }
      function onKey(ev) { if (ev.key === 'Escape') { close(); o.onCancel(); } }
      var timer = setInterval(function () {
        left -= 1;
        if (left > 0) return paint();
        close();
        o.onComplete({});
      }, 1000);
      skip.addEventListener('click', function () { close(); o.onCancel(); });
      document.addEventListener('keydown', onKey);
      paint();
      document.body.appendChild(ad);
      skip.focus();
    },
  };
  if (!window.dtv.adProvider) window.dtv.adProvider = mockAdProvider;

  var sheet = null; // { el, close }

  function closeSheet() { if (sheet) sheet.close(); }

  function openUnlockSheet(ctx) {
    if (typeof window.dtv.openUnlockSheet === 'function') return window.dtv.openUnlockSheet(ctx);
    ctx.notice('');
    closeSheet();
    var e = ctx.episode, s = ctx.series;
    var state = { balance: signedIn() ? me.profile.coinBalance : null, adsLeft: null, busy: false, message: '', error: false };
    var prevFocus = document.activeElement;

    // The scrim takes the dark ground in both looks, so it always dims.
    var scrim = h('div', 'dark fixed inset-0 z-40 bg-ground/70');
    var panel = h('div', 'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 pb-6 text-fg');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'unlock-title');
    panel.dataset.testid = 'unlock-sheet';

    function close() {
      if (!sheet || sheet.el !== panel) return;
      sheet = null;
      scrim.remove();
      panel.remove();
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('overflow-hidden');
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
    }
    function onKey(ev) { if (ev.key === 'Escape' && !state.busy) close(); }
    scrim.addEventListener('click', function () { if (!state.busy) close(); });

    function fail(text) { state.busy = false; state.message = text; state.error = true; paint(); }

    function option(cls, title, sub, testid, onClick, disabled) {
      var btn = h('button', cls + ' w-full' + (sub ? ' flex-col gap-0 py-2' : ''), [
        h('span', '', title),
        sub ? h('span', 'text-small font-normal ' + (cls === 'btn-primary' ? 'text-on-accent' : 'text-muted'), sub) : null,
      ]);
      btn.type = 'button';
      if (testid) btn.dataset.testid = testid;
      btn.disabled = !!disabled || state.busy;
      btn.addEventListener('click', onClick);
      return btn;
    }

    function unlocked() {
      close();
      ctx.onUnlocked();
    }

    function payCoins() {
      if (isGuest()) return askForAccount('unlock this episode');
      state.busy = true; state.message = ''; paint();
      api('/api/episodes/' + e.id + '/unlock', 'POST').then(function (r) {
        setBalance(r.coinBalance);
        unlocked();
      }).catch(function (err) {
        if (err.status === 402) {
          refreshMe().then(function () { state.balance = me.profile.coinBalance; paint(); }, function () {});
          fail('Not enough coins to unlock episode ' + e.number + '.');
        } else if (err.status === 401) { state.busy = false; paint(); }
        else fail('Could not unlock. Try again.');
      });
    }

    function payBundle() {
      if (isGuest()) return askForAccount('unlock these episodes');
      state.busy = true; state.message = ''; paint();
      api('/api/series/' + encodeURIComponent(s.slug) + '/unlock-all', 'POST', { expectedPrice: s.bundle.price }).then(function (r) {
        setBalance(r.coinBalance);
        unlocked();
      }).catch(function (err) {
        if (err.status === 409 && err.body && err.body.error === 'price_changed') {
          s.bundle = err.body.bundle;
          fail('The price changed. Check it and try again.');
        } else if (err.status === 409) {
          s.bundle = null;
          fail('Every episode of this series is already unlocked.');
        } else if (err.status === 402) fail('Not enough coins to unlock these episodes.');
        else if (err.status === 401) { state.busy = false; paint(); }
        else fail('Could not unlock. Try again.');
      });
    }

    function watchAd() {
      if (isGuest()) return askForAccount('unlock this episode');
      state.busy = true; state.message = ''; paint();
      api('/api/ads/sessions', 'POST', { episodeId: e.id }).then(function (r) {
        state.adsLeft = r.remainingToday;
        window.dtv.adProvider.show({
          sessionId: r.sessionId,
          minSeconds: r.minSeconds,
          label: 'Episode ' + e.number,
          onComplete: function (payload) {
            api('/api/ads/sessions/' + r.sessionId + '/complete', 'POST', payload || {}).then(function () {
              close();
              if (s) navigate('/watch/' + e.id, { seriesSlug: s.slug });
              else ctx.onUnlocked();
            }).catch(function (err) {
              if (err.status === 429) { state.adsLeft = 0; fail('No ad unlocks left today. Come back tomorrow.'); }
              else if (err.status === 425) fail('The ad did not finish. Try again.');
              else fail('Could not unlock. Try again.');
            });
          },
          onCancel: function () {
            state.busy = false;
            state.message = 'Ad skipped. The episode is still locked.';
            state.error = false;
            paint();
          },
          onError: function () { fail('The ad could not play. Try again.'); },
        });
      }).catch(function (err) {
        if (err.status === 429) { state.adsLeft = 0; fail('No ad unlocks left today. Come back tomorrow.'); }
        else if (err.status === 409) unlocked();
        else if (err.status === 401) { state.busy = false; paint(); }
        else fail('Could not start the ad. Try again.');
      });
    }

    function buyCoins() {
      close();
      navigate('/store');
    }

    var title = h('h2', 'text-heading', 'Unlock episode ' + e.number);
    title.id = 'unlock-title';
    title.tabIndex = -1;

    var body = h('div', 'flex flex-col gap-3');
    panel.append(
      h('div', 'mx-auto h-1 w-10 rounded-full bg-line'),
      title,
      h('p', 'text-small text-muted', e.title + (s ? ' · ' + s.title : '')),
      body);

    function paint() {
      var known = state.balance !== null;
      var need = known ? e.coinPrice - state.balance : 0;
      var short = need > 0;
      var hadFocus = body.contains(document.activeElement);
      var children = [];
      if (known) {
        children.push(h('div', 'flex items-center justify-between rounded-lg bg-raised px-3 py-2', [
          h('span', 'text-small text-muted', 'Your balance'),
          h('strong', 'text-small', coins(state.balance)),
        ]));
      }
      children.push(option(short ? 'btn-secondary' : 'btn-primary', 'Unlock for ' + coins(e.coinPrice),
        short ? 'You need ' + count(need) + ' more ' + (need === 1 ? 'coin' : 'coins') : null,
        'unlock-coins', payCoins, short));
      if (s && s.bundle && s.bundle.episodeCount >= 2) {
        var b = s.bundle;
        children.push(option('btn-secondary', 'Unlock all ' + b.episodeCount + ' remaining episodes',
          coins(b.price) + ' · save ' + count(b.savings), 'unlock-all', payBundle, known && state.balance < b.price));
      }
      var noAds = state.adsLeft === 0;
      children.push(option('btn-secondary', 'Watch an ad to unlock',
        noAds ? 'No ads left today. Come back tomorrow.' : state.adsLeft === null ? null : state.adsLeft + ' left today',
        'unlock-ad', watchAd, noAds));
      children.push(option(short ? 'btn-primary' : 'btn-secondary', 'Buy coins', null, 'unlock-buy', buyCoins));
      var later = option('btn-secondary', 'Not now', null, null, close);
      later.disabled = state.busy;
      children.push(later);
      var msg = h('p', 'text-small ' + (state.error ? 'text-danger' : 'text-muted'), state.message);
      msg.setAttribute('role', 'status');
      children.push(msg);
      body.replaceChildren.apply(body, children);
      if (hadFocus) title.focus();
    }

    paint();
    document.body.appendChild(scrim);
    document.body.appendChild(panel);
    document.body.classList.add('overflow-hidden');
    document.addEventListener('keydown', onKey);
    sheet = { el: panel, close: close };
    title.focus();

    if (signedIn()) {
      refreshMe().then(function () { state.balance = me.profile.coinBalance; paint(); }, function () {});
      api('/api/ads/quota').then(function (q) { state.adsLeft = q.remainingToday; paint(); }, function () {});
    }
  }

  // ── Detail ────────────────────────────────────────────────────────────
  /** What an episode shows in the grid: its access, or the viewer's progress on it. */
  function displayState(/** @type {EpisodeItem} */ e, watchingId) {
    if (e.state === 'locked') return 'locked';
    if (e.id === watchingId) return 'watching';
    if (e.watched) return 'watched';
    return e.state;
  }

  var STATE_LABEL = { free: 'free', unlocked: 'unlocked', locked: 'locked', watching: 'currently watching', watched: 'watched' };

  function episodeTile(/** @type {EpisodeItem} */ e, state, onOpen) {
    var cls = {
      free: 'border border-line bg-surface text-fg hover:bg-raised',
      unlocked: 'border border-line bg-surface text-fg hover:bg-raised',
      locked: 'border border-line bg-raised text-muted',
      watching: 'border border-accent bg-accent text-on-accent',
      watched: 'border border-line bg-raised text-muted',
    }[state];
    var marker = {
      free: h('span', 'text-small font-medium text-accent', 'Free'),
      unlocked: icon('unlock'),
      locked: h('span', 'inline-flex items-center gap-1 text-small', [icon('coin', 'h-3 w-3'), String(e.coinPrice)]),
      watching: icon('play'),
      watched: icon('check'),
    }[state];
    var btn = h('button', 'flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ' + cls, [
      h('span', 'text-body font-semibold', String(e.number)),
      h('span', 'flex h-5 items-center', [marker]),
    ]);
    btn.type = 'button';
    btn.title = e.title;
    btn.setAttribute('aria-label', 'Episode ' + e.number + ', ' + e.title + ', ' + STATE_LABEL[state] +
      (state === 'locked' ? ', ' + plural(e.coinPrice, 'coin', 'coins') : ''));
    btn.addEventListener('click', function () { onOpen(e); });
    if (state === 'locked') btn.dataset.testid = 'unlock-button';
    var li = h('li', '', [btn]);
    li.dataset.state = state;
    return li;
  }

  function legend() {
    function item(marker, label) {
      return h('li', 'inline-flex items-center gap-1', [marker, label]);
    }
    return h('ul', 'mt-3 flex flex-wrap gap-x-4 gap-y-1 px-1 text-small text-muted', [
      item(icon('coin', 'h-3 w-3'), 'Locked (coins)'),
      item(icon('unlock', 'h-3 w-3'), 'Unlocked'),
      item(icon('play', 'h-3 w-3'), 'Watching'),
      item(icon('check', 'h-3 w-3'), 'Watched'),
    ]);
  }

  function relatedSection(slug) {
    var section = h('section', '');
    section.appendChild(h('h2', 'section-label', 'Related series'));
    var body = h('div', 'grid grid-cols-3 gap-4', [0, 1, 2].map(function () {
      return h('div', 'flex flex-col gap-2', [h('div', 'skeleton aspect-[3/4] w-full'), h('div', 'skeleton h-5 w-3/4')]);
    }));
    section.appendChild(body);
    function load() {
      api('/api/series/' + encodeURIComponent(slug) + '/related').then(function (data) {
        if (!data.series.length) {
          body.replaceWith(body = h('p', 'px-1 text-body text-muted', 'No other series yet.'));
          return;
        }
        var grid = h('div', 'grid grid-cols-3 gap-4');
        grid.dataset.testid = 'related-series';
        data.series.forEach(function (r) { grid.appendChild(tile(r)); });
        body.replaceWith(body = grid);
      }).catch(function () {
        var retry = h('button', 'btn-secondary', 'Retry');
        retry.type = 'button';
        retry.addEventListener('click', load);
        body.replaceWith(body = h('div', 'flex flex-col items-start gap-2 px-1', [
          h('p', 'text-body text-muted', 'Could not load related series. The rest of this page still works.'),
          retry,
        ]));
      });
    }
    load();
    return section;
  }

  function renderDetail(slug) {
    show(loadingDetail());
    var back = navLink('/', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'All series');
    api('/api/series/' + encodeURIComponent(slug)).then(function (data) {
      /** @type {SeriesSummary & {synopsis:string, viewCount:number, episodes:EpisodeItem[],
       *   continueEpisode:{id:number, number:number, resume:boolean}|null}} */
      var s = data.series;
      var message = h('p', 'text-small text-muted');
      message.setAttribute('role', 'status');
      function notice(text, isError) {
        message.className = 'text-small ' + (isError ? 'text-danger' : 'text-muted');
        message.textContent = text;
      }

      function openEpisode(/** @type {EpisodeItem} */ e) {
        if (e.state === 'locked') {
          openUnlockSheet({ episode: e, series: s, notice: notice, onUnlocked: function () { renderDetail(slug); } });
        } else {
          navigate('/watch/' + e.id, { seriesSlug: slug });
        }
      }

      // Watch now / Continue episode X.
      var target = s.continueEpisode
        ? s.episodes.filter(function (e) { return e.id === s.continueEpisode.id; })[0]
        : s.episodes[0];
      var watchBtn = h('button', 'btn-primary flex-1', [
        icon('play'),
        s.continueEpisode ? 'Continue episode ' + s.continueEpisode.number : 'Watch now',
      ]);
      watchBtn.type = 'button';
      watchBtn.dataset.testid = 'primary-watch';
      if (target) watchBtn.addEventListener('click', function () { openEpisode(target); });
      else watchBtn.disabled = true;
      var watchingId = s.continueEpisode && s.continueEpisode.resume ? s.continueEpisode.id : null;

      // Follow, optimistic: flip at once, put it back if the server says no.
      var following = s.following;
      var pending = 0;
      var followBtn = h('button', 'btn-secondary');
      followBtn.type = 'button';
      function paintFollow() {
        followBtn.textContent = following ? 'Following' : 'Follow';
        followBtn.setAttribute('aria-pressed', following ? 'true' : 'false');
      }
      paintFollow();
      followBtn.dataset.testid = 'follow-button';
      followBtn.addEventListener('click', function () {
        if (isGuest()) return askForAccount('follow this series');
        var want = !following;
        var call = ++pending;
        following = want;
        paintFollow();
        notice('');
        api('/api/series/' + encodeURIComponent(slug) + '/follow', want ? 'PUT' : 'DELETE')
          .catch(function (err) {
            if (call !== pending) return; // a later tap decides the state
            following = !want;
            paintFollow();
            // A guest gets "account_required"; the platform bridge shows its own sign-up sheet.
            if (err.status !== 401) notice('Could not update follow. Try again.', true);
          });
      });

      // Share: the system share sheet where there is one, else copy the link.
      var shareBtn = h('button', 'btn-secondary', [icon('share')]);
      shareBtn.type = 'button';
      shareBtn.setAttribute('aria-label', 'Share');
      shareBtn.title = 'Share';
      shareBtn.addEventListener('click', function () {
        var url = location.origin + '/series/' + encodeURIComponent(slug);
        function copy() {
          if (!navigator.clipboard) return Promise.reject(new Error('no clipboard'));
          return navigator.clipboard.writeText(url).then(function () { notice('Link copied.'); });
        }
        var shared = navigator.share
          ? navigator.share({ title: s.title, url: url }).catch(function (err) {
              if (err && err.name === 'AbortError') return; // closed the share sheet
              return copy();
            })
          : copy();
        shared.catch(function () { notice('Could not copy. The link is ' + url, true); });
      });

      // Description, clamped to three lines with More / Less when it is longer.
      var synopsis = h('p', 'text-body line-clamp-3', s.synopsis);
      synopsis.id = 'series-synopsis';
      var moreBtn = h('button', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'More');
      moreBtn.type = 'button';
      moreBtn.hidden = true;
      moreBtn.setAttribute('aria-controls', synopsis.id);
      moreBtn.setAttribute('aria-expanded', 'false');
      moreBtn.addEventListener('click', function () {
        var open = synopsis.classList.toggle('line-clamp-3') === false;
        moreBtn.textContent = open ? 'Less' : 'More';
        moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      var episodes;
      if (s.episodes.length) {
        var grid = h('ol', 'grid grid-cols-5 gap-2');
        grid.dataset.testid = 'episode-list';
        s.episodes.forEach(function (e) { grid.appendChild(episodeTile(e, displayState(e, watchingId), openEpisode)); });
        episodes = h('div', '', [grid, legend()]);
      } else {
        episodes = h('div', 'state-empty', [
          h('h3', 'text-heading', 'No episodes yet'),
          h('p', 'text-body text-muted', 'Episodes will show up here once they are added.'),
        ]);
      }

      var page = h('div', 'flex flex-col gap-6', [
        back,
        cover(s, 'h-40 w-full rounded-xl border border-line sm:h-56', 'text-title text-fg'),
        h('div', 'flex flex-col gap-2', [
          h('h1', 'text-title', s.title),
          h('div', 'flex flex-wrap items-center gap-2', [
            s.genre ? h('span', 'rounded-full bg-raised px-3 py-1 text-small text-fg', s.genre) : null,
            h('span', 'text-small text-muted', plural(s.episodes.length, 'episode', 'episodes') + ' · ' +
              compact(s.viewCount) + (s.viewCount === 1 ? ' view' : ' views')),
          ]),
          h('div', 'flex flex-col items-start', [synopsis, moreBtn]),
        ]),
        h('div', 'flex flex-col gap-2', [
          h('div', 'flex gap-2', [watchBtn, followBtn, shareBtn]),
          message,
        ]),
        h('section', '', [h('h2', 'section-label', 'Episodes'), episodes]),
        relatedSection(slug),
      ]);
      show(page);
      moreBtn.hidden = synopsis.scrollHeight <= synopsis.clientHeight + 1;
    }).catch(function (err) {
      if (err.status === 404) {
        show(h('div', 'state-empty', [
          h('h2', 'text-heading', 'Series not found'),
          h('p', 'text-body text-muted', 'It may have been removed.'),
          back,
        ]));
      } else {
        show(errorState('Could not load this series', function () { renderDetail(slug); }, back));
      }
    });
  }

  // ── Watch ─────────────────────────────────────────────────────────────
  // The player arrives in a later phase; this screen names the episode and
  // links back so a tap on an episode lands somewhere real.
  function renderWatch(id) {
    show(loadingDetail());
    var fromSlug = history.state && history.state.seriesSlug;
    var back = fromSlug
      ? navLink('/series/' + encodeURIComponent(fromSlug), 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'Back to series')
      : navLink('/', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'All series');
    api('/api/episodes/' + encodeURIComponent(id)).then(function (data) {
      /** @type {EpisodeItem} */
      var e = data.episode;
      var message = h('p', 'text-small text-muted');
      message.setAttribute('role', 'status');
      var body;
      if (e.state === 'locked') {
        var unlockBtn = h('button', 'btn-primary', [icon('coin'), 'Unlock for ' + plural(e.coinPrice, 'coin', 'coins')]);
        unlockBtn.type = 'button';
        unlockBtn.addEventListener('click', function () {
          openUnlockSheet({
            episode: e, series: null,
            notice: function (text) { message.textContent = text; },
            onUnlocked: function () { renderWatch(id); },
          });
        });
        body = h('div', 'state-empty', [
          h('h2', 'text-heading', 'This episode is locked'),
          h('p', 'text-body text-muted', 'Unlock it with coins or by watching an ad.'),
          unlockBtn,
          message,
        ]);
      } else {
        body = h('div', 'state-empty', [
          h('h2', 'text-heading', 'The player is coming soon'),
          h('p', 'text-body text-muted', 'Watching episodes arrives in a later update.'),
        ]);
      }
      show(h('div', 'flex flex-col gap-6', [
        back,
        h('div', 'flex flex-col gap-1', [
          h('h1', 'text-title', 'Episode ' + e.number + ': ' + e.title),
          h('p', 'text-small text-muted', minutes(e.durationSeconds)),
        ]),
        body,
      ]));
    }).catch(function (err) {
      if (err.status === 404) {
        show(h('div', 'state-empty', [
          h('h2', 'text-heading', 'Episode not found'),
          h('p', 'text-body text-muted', 'It may have been removed.'),
          back,
        ]));
      } else {
        show(errorState('Could not load this episode', function () { renderWatch(id); }, back));
      }
    });
  }

  // ── Coins ───────────────────────────────────────────────────────────
  // The balance, the daily check-in and the coin store. Buying opens Stripe
  // Checkout in a new tab (it cannot run inside the app frame); Stripe sends
  // the person back to /store?checkout=<session>, and the page asks the
  // server until the coins are credited.
  var CHECKOUT_KEY = 'dtv.checkout';
  var polling = null;

  function backLink(path, label) {
    return navLink(path, 'inline-flex min-h-11 items-center self-start text-body font-medium text-accent', label);
  }

  function price(pkg) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: pkg.currency.toUpperCase() }).format(pkg.amountCents / 100); }
    catch (_) { return (pkg.amountCents / 100).toFixed(2) + ' ' + pkg.currency.toUpperCase(); }
  }

  function loadingStore() {
    return h('div', 'flex flex-col gap-6', [
      h('div', 'skeleton h-5 w-24'),
      h('div', 'skeleton h-8 w-32'),
      h('div', 'skeleton h-5 w-40'),
      h('div', 'skeleton h-40 w-full'),
      h('div', 'skeleton h-56 w-full'),
    ]);
  }

  /** Ask the server where a purchase stands, every 2 s for up to 30 s. */
  function pollPurchase(sessionId, say) {
    if (polling === sessionId) return;
    polling = sessionId;
    var tries = 0;
    say('Checking your payment…', false);
    (function tick() {
      if (polling !== sessionId || location.pathname !== '/store') { if (polling === sessionId) polling = null; return; }
      api('/api/store/purchases/' + encodeURIComponent(sessionId)).then(function (r) {
        if (polling !== sessionId) return;
        if (r.status === 'credited') {
          polling = null;
          try { sessionStorage.removeItem(CHECKOUT_KEY); } catch (_) {}
          setBalance(r.coinBalance);
          renderStore(coins(r.coins) + ' added.');
          return;
        }
        if (++tries >= 15) {
          polling = null;
          say('Still waiting on Stripe. Your coins will appear here once payment is confirmed.', false);
          return;
        }
        setTimeout(tick, 2000);
      }).catch(function (err) {
        polling = null;
        if (err.status === 404) { try { sessionStorage.removeItem(CHECKOUT_KEY); } catch (_) {} return say('', false); }
        say('Could not check your payment. Reload this page to check again.', true);
      });
    })();
  }

  // Back from the Stripe tab: check on the payment that was started here.
  window.addEventListener('focus', function () {
    if (location.pathname !== '/store' || polling) return;
    var pending = null;
    try { pending = sessionStorage.getItem(CHECKOUT_KEY); } catch (_) {}
    if (pending && storeNotice) pollPurchase(pending, storeNotice);
  });
  var storeNotice = null;

  function checkInPanel(c, onClaim) {
    var days = h('ol', 'grid grid-cols-7 gap-1.5');
    c.rewards.forEach(function (reward, i) {
      var day = i + 1;
      var done = day <= c.streakDay;
      var next = !c.claimedToday && day === c.nextDay;
      var cls = done ? 'border border-accent bg-accent text-on-accent'
        : next ? 'border-2 border-accent bg-surface text-fg'
        : 'border border-line bg-raised text-muted';
      var li = h('li', 'flex flex-col items-center rounded-lg py-1.5 ' + cls, [
        h('span', 'text-small font-semibold', String(day)),
        h('span', 'text-small', String(reward)),
      ]);
      li.setAttribute('aria-label', 'Day ' + day + ', ' + coins(reward) + (done ? ', collected' : next ? ', today' : ''));
      days.appendChild(li);
    });
    var line = c.claimedToday
      ? 'Checked in today. Come back tomorrow for ' + coins(c.nextReward) + '.'
      : c.nextDay > 1
        ? 'Today is day ' + c.nextDay + ' of your streak. Miss a day and it starts again from day 1.'
        : 'Check in every day to build a streak. Miss a day and it starts again from day 1.';
    var children = [days, h('p', 'text-small text-muted', line)];
    if (!c.claimedToday) {
      var btn = h('button', 'btn-primary w-full', 'Check in for ' + coins(c.nextReward));
      btn.type = 'button';
      btn.dataset.testid = 'check-in';
      btn.addEventListener('click', function () { onClaim(btn); });
      children.push(btn);
    }
    return h('div', 'card flex flex-col gap-3', children);
  }

  function renderStore(flash) {
    show(loadingStore());
    var params = new URLSearchParams(location.search);
    var returned = params.get('checkout');
    if (returned) {
      // Drop ?checkout= so a reload does not repeat it; keep the platform's token.
      params.delete('checkout');
      var rest = params.toString();
      history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : ''));
      if (returned === 'cancelled') {
        flash = 'Payment cancelled. Nothing was charged.';
        try { sessionStorage.removeItem(CHECKOUT_KEY); } catch (_) {}
      } else try { sessionStorage.setItem(CHECKOUT_KEY, returned); } catch (_) {}
    }
    var mine = signedIn();
    Promise.all([
      api('/api/store'),
      mine ? refreshMe() : null,
      mine ? api('/api/me/check-in') : null,
    ]).then(function (res) {
      if (location.pathname !== '/store') return;
      var store = res[0], checkIn = res[2];
      var message = h('p', 'text-small text-muted', flash || '');
      message.setAttribute('role', 'status');
      function say(text, isError, link) {
        message.className = 'text-small ' + (isError ? 'text-danger' : 'text-muted');
        message.textContent = text;
        if (link) message.append(' ', link);
      }
      storeNotice = say;

      var balance = mine
        ? h('p', 'text-body text-muted', ['Your balance: ', h('strong', 'text-fg', coins(me.profile.coinBalance))])
        : h('p', 'text-body text-muted', 'Make an account to collect and spend coins.');
      balance.dataset.testid = 'store-balance';

      var checkInSection = h('section', '', [
        h('h2', 'section-label', 'Daily check-in'),
        checkInPanel(checkIn || { rewards: [10, 10, 15, 15, 20, 20, 50], streakDay: 0, claimedToday: false, nextDay: 1, nextReward: 10 }, function (btn) {
          if (isGuest()) return askForAccount('check in');
          btn.disabled = true;
          api('/api/me/check-in', 'POST').then(function (r) {
            setBalance(r.coinBalance);
            renderStore(coins(r.reward) + ' added for day ' + r.streakDay + '.');
          }).catch(function (err) {
            if (err.status === 409) return renderStore();
            btn.disabled = false;
            if (err.status !== 401) say('Could not check in. Try again.', true);
          });
        }),
      ]);

      var list = h('ul', 'list');
      list.dataset.testid = 'coin-packages';
      store.packages.forEach(function (pkg) {
        var label = h('span', 'flex flex-1 items-center gap-2 text-body', [icon('coin', 'h-4 w-4 text-accent'), coins(pkg.coins)]);
        var end;
        if (store.paymentsConfigured) {
          end = h('button', 'btn-secondary', price(pkg));
          end.type = 'button';
          end.setAttribute('aria-label', 'Buy ' + coins(pkg.coins) + ' for ' + price(pkg));
          end.addEventListener('click', function () { buy(pkg, end, say); });
        } else {
          end = h('span', 'text-body text-muted', price(pkg));
        }
        list.appendChild(h('li', 'list-row', [label, end]));
      });
      var storeBody = [h('h2', 'section-label', 'Coin store')];
      if (!store.paymentsConfigured) {
        var off = h('div', 'state-empty', [
          h('h3', 'text-heading', 'Payments are not set up yet'),
          h('p', 'text-body text-muted', 'Coin packages can be bought once this app’s Stripe keys are added. You can still earn coins with the daily check-in and unlock episodes by watching an ad.'),
        ]);
        off.dataset.testid = 'payments-not-configured';
        storeBody.push(off, list);
      } else {
        storeBody.push(list, h('p', 'mt-2 px-1 text-small text-muted', 'Payment opens Stripe in a new tab. Your coins are added once payment is confirmed.'));
      }

      show(h('div', 'flex flex-col gap-6', [
        backLink('/', 'All series'),
        h('div', 'flex flex-col gap-1', [h('h1', 'text-title', 'Coins'), balance, message]),
        checkInSection,
        h('section', '', storeBody),
        backLink('/history', 'Transaction history'),
      ]));

      var pending = null;
      try { pending = sessionStorage.getItem(CHECKOUT_KEY); } catch (_) {}
      if (mine && pending && returned !== 'cancelled' && !flash) pollPurchase(pending, say);
    }).catch(function () {
      if (location.pathname !== '/store') return;
      show(errorState('Could not load your coins', function () { renderStore(); }, backLink('/', 'All series')));
    });
  }

  function buy(pkg, btn, say) {
    if (isGuest()) return askForAccount('buy coins');
    // Open the tab inside the tap, so the browser allows it; fill it in once
    // the server has made the Checkout Session.
    var win = null;
    try { win = window.open('', '_blank'); } catch (_) {}
    btn.disabled = true;
    say('Opening Stripe…', false);
    api('/api/store/checkout', 'POST', { packageId: pkg.id }).then(function (r) {
      btn.disabled = false;
      try { sessionStorage.setItem(CHECKOUT_KEY, r.sessionId); } catch (_) {}
      if (win && !win.closed) {
        win.location.href = r.url;
        say('Finish paying in the Stripe tab. Your coins are added here once payment is confirmed.', false);
      } else {
        // The browser blocked the new tab: a link the person taps opens it.
        var link = h('a', 'font-medium text-accent underline', 'Open Stripe to pay');
        link.href = r.url;
        link.target = '_blank';
        link.rel = 'noopener';
        say('Your browser kept Stripe from opening.', false, link);
      }
    }).catch(function (err) {
      if (win) try { win.close(); } catch (_) {}
      btn.disabled = false;
      if (err.status === 503) return renderStore();
      if (err.status !== 401) say('Could not start the payment. Try again.', true);
    });
  }

  // ── Transaction history ─────────────────────────────────────────────
  function renderHistory() {
    var back = backLink('/store', 'Coins');
    var title = h('h1', 'text-title', 'Transaction history');
    var skel = h('div', 'flex flex-col gap-2', [0, 1, 2, 3, 4].map(function () { return h('div', 'skeleton h-14 w-full'); }));
    show(h('div', 'flex flex-col gap-6', [back, title, skel]));
    if (isGuest()) {
      var join = h('button', 'btn-primary', 'Make an account');
      join.type = 'button';
      join.addEventListener('click', function () { askForAccount('see your transactions'); });
      return show(h('div', 'flex flex-col gap-6', [back, title, h('div', 'state-empty', [
        h('h2', 'text-heading', 'Your transactions are kept with your account'),
        h('p', 'text-body text-muted', 'Make an account to collect and spend coins.'),
        join,
      ])]));
    }
    var when = function (iso) {
      try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); }
      catch (_) { return iso; }
    };
    function row(t) {
      var plus = t.amount > 0;
      return h('li', 'list-row', [
        h('div', 'flex min-w-0 flex-1 flex-col', [
          h('span', 'text-body', t.label),
          h('span', 'text-small text-muted', when(t.createdAt)),
        ]),
        h('span', 'text-body font-semibold ' + (plus ? 'text-accent' : 'text-fg'),
          (plus ? '+' : '−') + count(Math.abs(t.amount))),
      ]);
    }
    function load() {
      api('/api/me/coin-transactions').then(function (data) {
        if (location.pathname !== '/history') return;
        if (!data.transactions.length) {
          return show(h('div', 'flex flex-col gap-6', [back, title, h('div', 'state-empty', [
            h('h2', 'text-heading', 'No transactions yet'),
            h('p', 'text-body text-muted', 'Coins you earn and spend will show up here.'),
            navLink('/store', 'btn-secondary', 'Go to Coins'),
          ])]));
        }
        var list = h('ul', 'list');
        list.dataset.testid = 'transaction-list';
        data.transactions.forEach(function (t) { list.appendChild(row(t)); });
        var more = h('div', 'flex flex-col items-stretch gap-2');
        function paintMore(next) {
          more.replaceChildren();
          if (!next) return;
          var btn = h('button', 'btn-secondary w-full', 'Show more');
          btn.type = 'button';
          btn.addEventListener('click', function () {
            btn.disabled = true;
            api('/api/me/coin-transactions?before=' + next).then(function (page) {
              page.transactions.forEach(function (t) { list.appendChild(row(t)); });
              paintMore(page.nextBefore);
            }).catch(function () {
              btn.disabled = false;
              more.replaceChildren(h('p', 'px-1 text-small text-danger', 'Could not load more transactions. The ones above are up to date.'), btn);
            });
          });
          more.appendChild(btn);
        }
        paintMore(data.nextBefore);
        show(h('div', 'flex flex-col gap-6', [back, title, list, more]));
      }).catch(function (err) {
        if (location.pathname !== '/history') return;
        if (err.status === 401) return;
        show(errorState('Could not load your transactions', load, back));
      });
    }
    load();
  }

  // ── Onboarding ────────────────────────────────────────────────────────
  // Always the dark look: the layer carries the "dark" class, so the colour
  // tokens inside it take their dark values whatever the viewer's theme.
  var layer = null;

  function onboardingDue() {
    return !!(me && me !== 'guest' && me.onboarding.required);
  }

  function closeOnboarding() {
    if (layer) { layer.remove(); layer = null; }
    document.body.classList.remove('overflow-hidden');
  }

  function openOnboarding() {
    if (layer) return;
    layer = h('div', 'dark fixed inset-0 z-50 overflow-y-auto bg-ground text-fg');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'onboarding-title');
    document.body.appendChild(layer);
    document.body.classList.add('overflow-hidden');
    renderOnboarding();
  }

  function onboardingFrame(children) {
    var title = h('h1', 'text-title', 'What do you like to watch?');
    title.id = 'onboarding-title';
    return h('div', 'mx-auto flex min-h-full max-w-md flex-col gap-6 px-6 pb-8 pt-16', [title].concat(children));
  }

  function renderOnboarding() {
    if (!layer) return;
    var skel = h('div', 'flex flex-wrap gap-2');
    for (var i = 0; i < 8; i++) skel.appendChild(h('div', 'skeleton h-11 w-28 rounded-full'));
    layer.replaceChildren(onboardingFrame([skel]));

    api('/api/genres').then(function (data) {
      if (!layer) return;
      var genres = data.genres;
      var min = me && me !== 'guest' ? me.onboarding.minGenres : Math.min(3, genres.length);
      var picked = new Set(me && me !== 'guest' ? me.profile.favoriteGenres : []);
      var due = onboardingDue();

      if (!genres.length) {
        var backBtn = h('button', 'btn-secondary', 'Back to series');
        backBtn.type = 'button';
        backBtn.addEventListener('click', function () { location.hash = '#/'; });
        layer.replaceChildren(onboardingFrame([h('div', 'state-empty', [
          h('h2', 'text-heading', 'No genres yet'),
          h('p', 'text-body text-muted', 'You can pick favourites once the first genres are added.'),
          backBtn,
        ])]));
        return;
      }

      var picker = h('div', 'flex flex-wrap gap-2');
      picker.dataset.testid = 'genre-picker';
      var save = h('button', 'btn-primary w-full');
      save.type = 'button';
      save.dataset.testid = 'genres-save';
      var message = h('p', 'text-small text-danger');
      message.setAttribute('role', 'alert');

      function paintSave() {
        var left = min - picked.size;
        save.disabled = left > 0;
        save.textContent = left > 0 ? 'Pick ' + left + ' more' : 'Start watching';
      }

      genres.forEach(function (g) {
        var chip = h('button', '', g.name);
        chip.type = 'button';
        function paint() {
          var on = picked.has(g.slug);
          chip.className = on
            ? 'inline-flex min-h-11 items-center rounded-full border border-accent bg-accent px-4 text-body font-medium text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
            : 'inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-body text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
          chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        paint();
        chip.addEventListener('click', function () {
          if (picked.has(g.slug)) picked.delete(g.slug); else picked.add(g.slug);
          paint();
          paintSave();
        });
        picker.appendChild(chip);
      });
      paintSave();

      save.addEventListener('click', function () {
        if (isGuest()) return askForAccount('save your favourite genres');
        save.disabled = true;
        message.textContent = '';
        api('/api/me/genres', 'POST', { genres: Array.from(picked) }).then(function (r) {
          me.profile = r.profile;
          me.onboarding.required = false;
          closeOnboarding();
          if (location.hash === '#/onboarding') location.hash = '#/';
        }).catch(function (err) {
          if (err.status !== 401) message.textContent = 'Could not save your genres. Try again.';
          paintSave();
        });
      });

      var later = null;
      if (!due) {
        later = h('button', 'btn-secondary w-full', 'Not now');
        later.type = 'button';
        later.addEventListener('click', function () { location.hash = '#/'; });
      }

      layer.replaceChildren(onboardingFrame([
        h('p', 'text-body text-muted', 'Pick at least ' + plural(min, 'genre', 'genres') + '. We use them to suggest series for you.'),
        picker,
        h('div', 'mt-auto flex flex-col gap-3 pt-4', [message, save, later]),
      ]));
    }).catch(function () {
      if (!layer) return;
      var retry = h('button', 'btn-primary', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', renderOnboarding);
      layer.replaceChildren(onboardingFrame([h('div', 'state-error', [
        h('h2', 'text-heading', 'Could not load genres'),
        h('p', 'text-body text-muted', 'Check your connection and try again.'),
        retry,
      ])]));
    });
  }

  // ── Routing ───────────────────────────────────────────────────────────
  // The query string (the platform's ?token=, ?un-theme=, ...) is kept on
  // every in-app navigation so a reload still works.
  function navigate(path, state) {
    history.pushState(state || null, '', path + location.search);
    route();
  }

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-nav]');
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    navigate(a.getAttribute('href'));
  });

  function route() {
    var legacy = /^#\/series\/([^/]+)$/.exec(location.hash);
    if (legacy) history.replaceState(null, '', '/series/' + legacy[1] + location.search);
    var m;
    closeSheet();
    if ((m = /^\/series\/([^/]+)\/?$/.exec(location.pathname))) renderDetail(decodeURIComponent(m[1]));
    else if ((m = /^\/watch\/(\d+)\/?$/.exec(location.pathname))) renderWatch(m[1]);
    else if (location.pathname === '/store') renderStore();
    else if (location.pathname === '/history') renderHistory();
    else renderBrowse();
    if (location.hash === '#/onboarding' || onboardingDue()) openOnboarding();
    else closeOnboarding();
  }
  // Ask who is looking first, so the buttons know whether to ask a guest to
  // make an account and onboarding knows whether it is due.
  api('/api/me').then(function (data) { me = data; }, function (err) {
    if (err.status === 401) me = 'guest';
  }).then(function () {
    window.addEventListener('popstate', route);
    route();
  });
})();
