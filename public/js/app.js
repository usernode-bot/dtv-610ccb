// Dtv front end: a series browse screen, a series detail screen, the watch
// screen, My List and the genre onboarding. Path routes: "/" (browse),
// "/series/<slug>" (detail), "/watch/<episodeId>" (watch), "/my-list"
// (followed series) and "/my-list/history" (watch history). Older "#/series/<slug>" links are
// moved to the path form. Links marked data-nav navigate in place. Onboarding
// is a full-screen layer over the page, shown on "#/onboarding" and, for a
// signed-in person who has not picked genres yet, on every route until they
// do. Everything is
// built with DOM calls and textContent, so catalogue text is never parsed as
// HTML. Class names are whole literals so the Tailwind build can see them.
// Every string a person reads comes from public/js/i18n.js (t(key)), in
// English or Indonesian.
//
// @typedef {{id:number, slug:string, title:string, genre:string, coverUrl:string|null,
//   coverTone:number, episodeCount:number, freeEpisodeCount:number, following:boolean}} SeriesSummary
// @typedef {{id:number, number:number, title:string, durationSeconds:number,
//   coinPrice:number, state:'free'|'unlocked'|'locked',
//   positionSeconds?:number|null, watched?:boolean}} EpisodeItem

(function () {
  var root = document.getElementById('app');
  var t = window.dtvI18n.t;

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

  function episodesCount(n) { return t('episodesCount', { n: n }); }
  function coinsCount(n) { return t('coinsCount', { n: n }); }

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
    try { return new Intl.NumberFormat(window.dtvI18n.locale(), { notation: 'compact' }).format(n); }
    catch (_) { return String(n); }
  }

  /**
   * Cover art: the image when there is one, else a tinted tile with the
   * title's initial. Grid covers load lazily; the detail banner (priority)
   * loads first. The box keeps its size, so nothing shifts as images arrive.
   */
  function cover(s, sizeCls, letterCls, priority) {
    var box = h('div', 'flex items-center justify-center overflow-hidden ' + sizeCls + ' ' + (TONES[s.coverTone % TONES.length] || TONES[0]));
    if (s.coverUrl) {
      var img = h('img', 'h-full w-full object-cover');
      img.alt = '';
      img.decoding = 'async';
      if (priority) img.setAttribute('fetchpriority', 'high');
      else img.loading = 'lazy';
      img.src = s.coverUrl;
      box.appendChild(img);
    } else {
      box.appendChild(h('span', letterCls, s.title.charAt(0)));
    }
    return box;
  }

  // Set by an in-app navigation: once the new screen's heading is on
  // screen, move keyboard and screen reader focus to it.
  var focusHeading = false;

  /** Put a screen in place. Loading screens are marked data-loading. */
  function show(node) {
    root.replaceChildren(node);
    window.scrollTo(0, 0);
    var loading = node.dataset && node.dataset.loading === '1';
    root.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (!loading && focusHeading) {
      var heading = root.querySelector('h1, h2');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        focusHeading = false;
      }
    }
  }

  function setTitle(title) {
    document.title = title ? title + ' | Dtv' : 'Dtv';
  }

  function loadingNode(node) {
    node.dataset.loading = '1';
    return node;
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
    return loadingNode(h('div', 'flex flex-col gap-4', [h('div', 'skeleton h-7 w-32'), grid]));
  }

  function loadingDetail() {
    return loadingNode(h('div', 'flex flex-col gap-4', [
      h('div', 'skeleton h-5 w-24'),
      h('div', 'skeleton h-40 w-full sm:h-56'),
      h('div', 'skeleton h-8 w-2/3'),
      h('div', 'skeleton h-16 w-full'),
      h('div', 'skeleton h-11 w-full'),
      h('div', 'skeleton h-48 w-full'),
    ]));
  }

  function errorState(message, retry, backLink) {
    var retryBtn = h('button', 'btn-primary', t('retry'));
    retryBtn.type = 'button';
    retryBtn.addEventListener('click', retry);
    return h('div', 'state-error', [
      h('h2', 'text-heading', message),
      h('p', 'text-body text-muted', t('checkConnection')),
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
        h('p', 'text-small text-muted', episodesCount(s.episodeCount) + (s.genre ? ' · ' + s.genre : '')),
        s.following ? h('p', 'text-small font-medium text-accent', t('following')) : null,
      ]),
    ]);
    a.dataset.testid = 'series-tile';
    return a;
  }

  function renderBrowse() {
    setTitle('');
    show(loadingBrowse());
    api('/api/series').then(function (data) {
      var page = h('div', 'flex flex-col gap-4');
      page.appendChild(h('div', 'flex items-center justify-between gap-4', [
        h('h1', 'text-title', t('series')),
        myListLink(),
      ]));
      if (data.demo) {
        page.appendChild(h('p', 'text-small text-muted', t('stagingDemo')));
      }
      if (!data.series.length) {
        page.appendChild(h('div', 'state-empty', [
          h('h2', 'text-heading', t('noSeriesTitle')),
          h('p', 'text-body text-muted', t('noSeriesBody')),
        ]));
      } else {
        var grid = h('div', 'grid grid-cols-2 gap-4 sm:grid-cols-3');
        grid.dataset.testid = 'series-grid';
        data.series.forEach(function (s) { grid.appendChild(tile(s)); });
        page.appendChild(grid);
      }
      page.appendChild(languagePicker());
      show(page);
      if (refocusLanguage) {
        refocusLanguage = false;
        document.getElementById('language-select').focus();
      }
    }).catch(function () {
      show(errorState(t('loadSeriesFailed'), renderBrowse));
    });
  }

  // Language: English or Bahasa Indonesia. Starts from the Homeroom or device
  // language (public/js/i18n.js); a choice here is kept on this device.
  var refocusLanguage = false;
  function languagePicker() {
    var select = h('select', 'field w-auto');
    select.id = 'language-select';
    select.dataset.testid = 'language-select';
    window.dtvI18n.locales.forEach(function (l) {
      var o = h('option', '', l.name);
      o.value = l.code;
      o.lang = l.code;
      if (l.code === window.dtvI18n.locale()) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', function () {
      window.dtvI18n.setLocale(select.value);
      applyChrome();
      refocusLanguage = true;
      route();
    });
    var label = h('label', 'text-small text-muted', t('language'));
    label.htmlFor = select.id;
    return h('div', 'mt-4 flex items-center gap-3 border-t border-line pt-4', [label, select]);
  }

  function myListLink() {
    var a = navLink('/my-list', 'inline-flex min-h-11 items-center text-body font-medium text-accent', t('myList'));
    a.dataset.testid = 'my-list-link';
    return a;
  }

  // ── My List ───────────────────────────────────────────────────────────
  // Two tabs: the series the person follows, and the episodes they played,
  // most recent first. Both are their own rows, so a guest is asked to make
  // an account instead.
  function loadingList() {
    var rows = h('div', 'flex flex-col gap-2');
    for (var i = 0; i < 4; i++) rows.appendChild(h('div', 'skeleton h-16 w-full'));
    return rows;
  }

  function historyRow(item) {
    var progress = item.completed ? t('watched')
      : item.positionSeconds > 0 ? t('stoppedAt', { time: minutes(item.positionSeconds) }) : t('started');
    var a = navLink('/watch/' + item.episodeId, 'list-row hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus', [
      h('span', 'flex min-w-0 flex-1 flex-col', [
        h('span', 'truncate text-body font-semibold', item.seriesTitle),
        h('span', 'truncate text-small text-muted', t('episodeTitle', { n: item.episodeNumber, title: item.episodeTitle })),
      ]),
      h('span', 'shrink-0 text-small text-muted', progress),
    ]);
    a.dataset.seriesSlug = item.seriesSlug;
    return h('li', '', [a]);
  }

  function renderMyList(tab) {
    setTitle(t('myList'));
    var tabs = h('nav', 'flex gap-2', [
      ['following', '/my-list', t('following')],
      ['history', '/my-list/history', t('watchHistory')],
    ].map(function (tb) {
      var on = tb[0] === tab;
      var a = navLink(tb[1], on
        ? 'inline-flex min-h-11 items-center rounded-full border border-accent bg-accent px-4 text-body font-medium text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
        : 'inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-body text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', tb[2]);
      if (on) a.setAttribute('aria-current', 'page');
      a.dataset.testid = 'my-list-tab-' + tb[0];
      return a;
    }));
    tabs.setAttribute('aria-label', t('myList'));
    var body = h('div', '', [loadingList()]);
    body.setAttribute('aria-busy', 'true');
    show(h('div', 'flex flex-col gap-4', [
      navLink('/', 'inline-flex min-h-11 items-center self-start text-body font-medium text-accent', t('allSeries')),
      h('h1', 'text-title', t('myList')),
      tabs,
      body,
    ]));

    function browseButton() {
      return navLink('/', 'btn-primary', t('browseSeries'));
    }
    function fill(node) {
      body.replaceChildren(node);
      body.setAttribute('aria-busy', 'false');
    }

    if (isGuest()) {
      var join = h('button', 'btn-primary', t('makeAccount'));
      join.type = 'button';
      join.addEventListener('click', function () { askForAccount('keep your own list'); });
      fill(h('div', 'state-empty', [
        h('h2', 'text-heading', t('listNeedsAccountTitle')),
        h('p', 'text-body text-muted', t('listNeedsAccountBody')),
        join,
      ]));
      return;
    }

    var path = tab === 'history' ? '/api/me/watch-history' : '/api/me/follows';
    api(path).then(function (data) {
      if (tab === 'history') {
        if (!data.history.length) {
          fill(h('div', 'state-empty', [
            h('h2', 'text-heading', t('nothingWatchedTitle')),
            h('p', 'text-body text-muted', t('nothingWatchedBody')),
            browseButton(),
          ]));
          return;
        }
        var list = h('ul', 'list');
        list.dataset.testid = 'watch-history';
        data.history.forEach(function (item) { list.appendChild(historyRow(item)); });
        fill(list);
      } else {
        if (!data.series.length) {
          fill(h('div', 'state-empty', [
            h('h2', 'text-heading', t('notFollowingTitle')),
            h('p', 'text-body text-muted', t('notFollowingBody')),
            browseButton(),
          ]));
          return;
        }
        var grid = h('div', 'grid grid-cols-2 gap-4 sm:grid-cols-3');
        grid.dataset.testid = 'followed-series';
        data.series.forEach(function (s) { grid.appendChild(tile(s)); });
        fill(grid);
      }
    }).catch(function () {
      fill(errorState(
        tab === 'history' ? t('loadHistoryFailed') : t('loadFollowsFailed'),
        function () { renderMyList(tab); }));
    });
  }

  // ── Unlock ────────────────────────────────────────────────────────────
  // A richer unlock sheet can plug in by setting
  //   window.dtv.openUnlockSheet = function (ctx) { ... }
  // where ctx is { episode, series, notice(text), onUnlocked() }: call
  // onUnlocked() once the episode is unlocked so the screen reloads. Without
  // one, unlocking goes straight to the API.
  window.dtv = window.dtv || {};
  function openUnlockSheet(ctx) {
    if (typeof window.dtv.openUnlockSheet === 'function') return window.dtv.openUnlockSheet(ctx);
    if (isGuest()) return askForAccount('unlock this episode');
    ctx.notice('');
    api('/api/episodes/' + ctx.episode.id + '/unlock', 'POST')
      .then(function () { ctx.onUnlocked(); })
      .catch(function (err) {
        if (err.status === 402) ctx.notice(t('notEnoughCoins', { n: ctx.episode.number }), true);
        else if (err.status !== 401) ctx.notice(t('unlockFailed'), true);
      });
  }

  // ── Detail ────────────────────────────────────────────────────────────
  /** What an episode shows in the grid: its access, or the viewer's progress on it. */
  function displayState(/** @type {EpisodeItem} */ e, watchingId) {
    if (e.state === 'locked') return 'locked';
    if (e.id === watchingId) return 'watching';
    if (e.watched) return 'watched';
    return e.state;
  }

  var STATE_KEY = { free: 'stateFree', unlocked: 'stateUnlocked', locked: 'stateLocked', watching: 'stateWatching', watched: 'stateWatched' };

  function episodeTile(/** @type {EpisodeItem} */ e, state, onOpen) {
    var cls = {
      free: 'border border-line bg-surface text-fg hover:bg-raised',
      unlocked: 'border border-line bg-surface text-fg hover:bg-raised',
      locked: 'border border-line bg-raised text-muted',
      watching: 'border border-accent bg-accent text-on-accent',
      watched: 'border border-line bg-raised text-muted',
    }[state];
    var marker = {
      free: h('span', 'text-small font-medium text-accent', t('freeBadge')),
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
    btn.setAttribute('aria-label', t('episodeLabel', { n: e.number, title: e.title, state: t(STATE_KEY[state]) }) +
      (state === 'locked' ? ', ' + coinsCount(e.coinPrice) : ''));
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
      item(icon('coin', 'h-3 w-3'), t('legendLocked')),
      item(icon('unlock', 'h-3 w-3'), t('legendUnlocked')),
      item(icon('play', 'h-3 w-3'), t('legendWatching')),
      item(icon('check', 'h-3 w-3'), t('legendWatched')),
    ]);
  }

  function relatedSection(slug) {
    var section = h('section', '');
    section.appendChild(h('h2', 'section-label', t('relatedSeries')));
    var body = h('div', 'grid grid-cols-3 gap-4', [0, 1, 2].map(function () {
      return h('div', 'flex flex-col gap-2', [h('div', 'skeleton aspect-[3/4] w-full'), h('div', 'skeleton h-5 w-3/4')]);
    }));
    section.appendChild(body);
    function load() {
      api('/api/series/' + encodeURIComponent(slug) + '/related').then(function (data) {
        if (!data.series.length) {
          body.replaceWith(body = h('p', 'px-1 text-body text-muted', t('noOtherSeries')));
          return;
        }
        var grid = h('div', 'grid grid-cols-3 gap-4');
        grid.dataset.testid = 'related-series';
        data.series.forEach(function (r) { grid.appendChild(tile(r)); });
        body.replaceWith(body = grid);
      }).catch(function () {
        var retry = h('button', 'btn-secondary', t('retry'));
        retry.type = 'button';
        retry.addEventListener('click', load);
        body.replaceWith(body = h('div', 'flex flex-col items-start gap-2 px-1', [
          h('p', 'text-body text-muted', t('relatedFailed')),
          retry,
        ]));
      });
    }
    load();
    return section;
  }

  function renderDetail(slug) {
    show(loadingDetail());
    var back = navLink('/', 'inline-flex min-h-11 items-center text-body font-medium text-accent', t('allSeries'));
    api('/api/series/' + encodeURIComponent(slug)).then(function (data) {
      /** @type {SeriesSummary & {synopsis:string, viewCount:number, episodes:EpisodeItem[],
       *   continueEpisode:{id:number, number:number, resume:boolean}|null}} */
      var s = data.series;
      setTitle(s.title);
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
        s.continueEpisode ? t('continueEpisode', { n: s.continueEpisode.number }) : t('watchNow'),
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
        followBtn.textContent = following ? t('following') : t('follow');
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
            if (err.status !== 401) notice(t('followFailed'), true);
          });
      });

      // Share: the system share sheet where there is one, else copy the link.
      var shareBtn = h('button', 'btn-secondary', [icon('share')]);
      shareBtn.type = 'button';
      shareBtn.setAttribute('aria-label', t('share'));
      shareBtn.title = t('share');
      shareBtn.addEventListener('click', function () {
        var url = location.origin + '/series/' + encodeURIComponent(slug);
        function copy() {
          if (!navigator.clipboard) return Promise.reject(new Error('no clipboard'));
          return navigator.clipboard.writeText(url).then(function () { notice(t('linkCopied')); });
        }
        var shared = navigator.share
          ? navigator.share({ title: s.title, url: url }).catch(function (err) {
              if (err && err.name === 'AbortError') return; // closed the share sheet
              return copy();
            })
          : copy();
        shared.catch(function () { notice(t('copyFailed', { url: url }), true); });
      });

      // Description, clamped to three lines with More / Less when it is longer.
      var synopsis = h('p', 'text-body line-clamp-3', s.synopsis);
      synopsis.id = 'series-synopsis';
      var moreBtn = h('button', 'inline-flex min-h-11 items-center text-body font-medium text-accent', t('more'));
      moreBtn.type = 'button';
      moreBtn.hidden = true;
      moreBtn.setAttribute('aria-controls', synopsis.id);
      moreBtn.setAttribute('aria-expanded', 'false');
      moreBtn.addEventListener('click', function () {
        var open = synopsis.classList.toggle('line-clamp-3') === false;
        moreBtn.textContent = open ? t('less') : t('more');
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
          h('h3', 'text-heading', t('noEpisodesTitle')),
          h('p', 'text-body text-muted', t('noEpisodesBody')),
        ]);
      }

      var page = h('div', 'flex flex-col gap-6', [
        back,
        cover(s, 'h-40 w-full rounded-xl border border-line sm:h-56', 'text-title text-fg', true),
        h('div', 'flex flex-col gap-2', [
          h('h1', 'text-title', s.title),
          h('div', 'flex flex-wrap items-center gap-2', [
            s.genre ? h('span', 'rounded-full bg-raised px-3 py-1 text-small text-fg', s.genre) : null,
            h('span', 'text-small text-muted', episodesCount(s.episodes.length) + ' · ' +
              t('views', { n: s.viewCount, count: compact(s.viewCount) })),
          ]),
          h('div', 'flex flex-col items-start', [synopsis, moreBtn]),
        ]),
        h('div', 'flex flex-col gap-2', [
          h('div', 'flex gap-2', [watchBtn, followBtn, shareBtn]),
          message,
        ]),
        h('section', '', [h('h2', 'section-label', t('episodes')), episodes]),
        relatedSection(slug),
      ]);
      show(page);
      moreBtn.hidden = synopsis.scrollHeight <= synopsis.clientHeight + 1;
    }).catch(function (err) {
      if (err.status === 404) {
        show(h('div', 'state-empty', [
          h('h2', 'text-heading', t('seriesNotFound')),
          h('p', 'text-body text-muted', t('mayBeRemoved')),
          back,
        ]));
      } else {
        show(errorState(t('loadOneSeriesFailed'), function () { renderDetail(slug); }, back));
      }
    });
  }

  // ── Analytics: drop-off ───────────────────────────────────────────────
  // The server records play, complete and unlock itself. Leaving a playable
  // episode before the end (another screen, closing the app) is reported
  // here as drop_off, with the last position the player gave. A player sets
  // that with window.dtv.reportPlayback(seconds, completed).
  var watching = null; // { episodeId, position, completed }

  window.dtv.reportPlayback = function (seconds, completed) {
    if (!watching) return;
    if (typeof seconds === 'number' && seconds >= 0) watching.position = Math.floor(seconds);
    if (completed) watching.completed = true;
  };

  function endWatching() {
    var w = watching;
    watching = null;
    if (!w || w.completed || !me || isGuest()) return;
    var headers = { 'content-type': 'application/json' };
    if (token) headers['x-usernode-token'] = token;
    fetch('/api/events', {
      method: 'POST', headers: headers, keepalive: true,
      body: JSON.stringify({ name: 'drop_off', episodeId: w.episodeId, positionSeconds: w.position }),
    }).catch(function () {});
  }
  window.addEventListener('pagehide', endWatching);

  // ── Watch ─────────────────────────────────────────────────────────────
  // The player arrives in a later phase; this screen names the episode and
  // links back so a tap on an episode lands somewhere real.
  function renderWatch(id) {
    show(loadingDetail());
    var fromSlug = history.state && history.state.seriesSlug;
    var back = fromSlug
      ? navLink('/series/' + encodeURIComponent(fromSlug), 'inline-flex min-h-11 items-center text-body font-medium text-accent', t('backToSeries'))
      : navLink('/', 'inline-flex min-h-11 items-center text-body font-medium text-accent', t('allSeries'));
    api('/api/episodes/' + encodeURIComponent(id)).then(function (data) {
      /** @type {EpisodeItem} */
      var e = data.episode;
      var title = t('episodeTitle', { n: e.number, title: e.title });
      setTitle(title);
      var message = h('p', 'text-small text-muted');
      message.setAttribute('role', 'status');
      var body;
      if (e.state === 'locked') {
        var unlockBtn = h('button', 'btn-primary', [icon('coin'), t('unlockFor', { coins: coinsCount(e.coinPrice) })]);
        unlockBtn.type = 'button';
        unlockBtn.addEventListener('click', function () {
          openUnlockSheet({
            episode: e, series: null,
            notice: function (text) { message.textContent = text; },
            onUnlocked: function () { renderWatch(id); },
          });
        });
        body = h('div', 'state-empty', [
          h('h2', 'text-heading', t('lockedTitle')),
          h('p', 'text-body text-muted', t('lockedBody')),
          unlockBtn,
          message,
        ]);
      } else {
        // Opening a playable episode puts it in the person's watch history
        // (and the server counts a play).
        if (me && !isGuest()) {
          api('/api/me/watch-history/' + e.id + '/play', 'POST').catch(function () {});
          watching = { episodeId: e.id, position: 0, completed: false };
        }
        body = h('div', 'state-empty', [
          h('h2', 'text-heading', t('playerSoonTitle')),
          h('p', 'text-body text-muted', t('playerSoonBody')),
        ]);
      }
      show(h('div', 'flex flex-col gap-6', [
        back,
        h('div', 'flex flex-col gap-1', [
          h('h1', 'text-title', title),
          h('p', 'text-small text-muted', minutes(e.durationSeconds)),
        ]),
        body,
      ]));
    }).catch(function (err) {
      if (err.status === 404) {
        show(h('div', 'state-empty', [
          h('h2', 'text-heading', t('episodeNotFound')),
          h('p', 'text-body text-muted', t('mayBeRemoved')),
          back,
        ]));
      } else {
        show(errorState(t('loadEpisodeFailed'), function () { renderWatch(id); }, back));
      }
    });
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
    var title = h('h1', 'text-title', t('onboardingTitle'));
    title.id = 'onboarding-title';
    title.tabIndex = -1;
    return h('div', 'mx-auto flex min-h-full max-w-md flex-col gap-6 px-6 pb-8 pt-16', [title].concat(children));
  }

  function renderOnboarding() {
    if (!layer) return;
    var skel = h('div', 'flex flex-wrap gap-2');
    for (var i = 0; i < 8; i++) skel.appendChild(h('div', 'skeleton h-11 w-28 rounded-full'));
    layer.replaceChildren(onboardingFrame([skel]));
    // Move focus into the dialog, onto its title.
    var heading = layer.querySelector('#onboarding-title');
    if (heading) heading.focus({ preventScroll: true });

    api('/api/genres').then(function (data) {
      if (!layer) return;
      var genres = data.genres;
      var min = me && me !== 'guest' ? me.onboarding.minGenres : Math.min(3, genres.length);
      var picked = new Set(me && me !== 'guest' ? me.profile.favoriteGenres : []);
      var due = onboardingDue();

      if (!genres.length) {
        var backBtn = h('button', 'btn-secondary', t('backToSeries'));
        backBtn.type = 'button';
        backBtn.addEventListener('click', function () { location.hash = '#/'; });
        layer.replaceChildren(onboardingFrame([h('div', 'state-empty', [
          h('h2', 'text-heading', t('noGenresTitle')),
          h('p', 'text-body text-muted', t('noGenresBody')),
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
        save.textContent = left > 0 ? t('pickMore', { n: left }) : t('startWatching');
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
          if (err.status !== 401) message.textContent = t('saveGenresFailed');
          paintSave();
        });
      });

      var later = null;
      if (!due) {
        later = h('button', 'btn-secondary w-full', t('notNow'));
        later.type = 'button';
        later.addEventListener('click', function () { location.hash = '#/'; });
      }

      layer.replaceChildren(onboardingFrame([
        h('p', 'text-body text-muted', t('pickAtLeast', { genres: t('genresCount', { n: min }) })),
        picker,
        h('div', 'mt-auto flex flex-col gap-3 pt-4', [message, save, later]),
      ]));
    }).catch(function () {
      if (!layer) return;
      var retry = h('button', 'btn-primary', t('retry'));
      retry.type = 'button';
      retry.addEventListener('click', renderOnboarding);
      layer.replaceChildren(onboardingFrame([h('div', 'state-error', [
        h('h2', 'text-heading', t('loadGenresFailed')),
        h('p', 'text-body text-muted', t('checkConnection')),
        retry,
      ])]));
    });
  }

  // ── Routing ───────────────────────────────────────────────────────────
  // The query string (the platform's ?token=, ?un-theme=, ...) is kept on
  // every in-app navigation so a reload still works.
  function navigate(path, state) {
    history.pushState(state || null, '', path + location.search);
    focusHeading = true;
    route();
  }

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-nav]');
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    navigate(a.getAttribute('href'), a.dataset.seriesSlug ? { seriesSlug: a.dataset.seriesSlug } : null);
  });

  function route() {
    endWatching();
    var legacy = /^#\/series\/([^/]+)$/.exec(location.hash);
    if (legacy) history.replaceState(null, '', '/series/' + legacy[1] + location.search);
    var m;
    if ((m = /^\/series\/([^/]+)\/?$/.exec(location.pathname))) renderDetail(decodeURIComponent(m[1]));
    else if ((m = /^\/watch\/(\d+)\/?$/.exec(location.pathname))) renderWatch(m[1]);
    else if (/^\/my-list\/?$/.test(location.pathname)) renderMyList('following');
    else if (/^\/my-list\/history\/?$/.test(location.pathname)) renderMyList('history');
    else renderBrowse();
    if (location.hash === '#/onboarding' || onboardingDue()) openOnboarding();
    else closeOnboarding();
  }
  // Strings outside the screens: the skip link.
  function applyChrome() {
    var skip = document.getElementById('skip-link');
    if (skip) skip.textContent = t('skipToContent');
  }

  // ── Error reports ─────────────────────────────────────────────────────
  // Uncaught errors in this page go to the server, which passes them to
  // Sentry (when it is set up). Only for a signed-in person: a guest's write
  // would be answered with the platform's "make an account" sheet. At most
  // five a page; the path is sent without its query (the token).
  var errorBudget = 5;
  var pendingErrors = [];
  function sendError(report) {
    if (me === null) { if (pendingErrors.length < errorBudget) pendingErrors.push(report); return; }
    if (isGuest() || errorBudget <= 0) return;
    errorBudget -= 1;
    api('/api/client-errors', 'POST', report).catch(function () {});
  }
  function reportError(err, fallback) {
    sendError({
      name: (err && err.name) || 'Error',
      message: String((err && err.message) || fallback || err).slice(0, 2000),
      stack: err && err.stack ? String(err.stack).slice(0, 8000) : undefined,
      path: location.pathname,
    });
  }
  window.addEventListener('error', function (e) { reportError(e.error, e.message); });
  window.addEventListener('unhandledrejection', function (e) { reportError(e.reason); });

  // Installable and offline-aware: the service worker (public/sw.js) shows
  // the offline page when there is no connection. Registration can fail in
  // a third-party frame; the app works the same without it.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  // Ask who is looking first, so the buttons know whether to ask a guest to
  // make an account and onboarding knows whether it is due. The language
  // (which may come from Homeroom) is settled at the same time.
  var who = api('/api/me').then(function (data) { me = data; }, function (err) {
    me = err.status === 401 ? 'guest' : false;
  });
  Promise.all([who, window.dtvI18n.ready]).then(function () {
    if (me === false) me = null;
    var queued = pendingErrors;
    pendingErrors = [];
    if (me) queued.forEach(sendError);
    applyChrome();
    window.addEventListener('popstate', function () { focusHeading = true; route(); });
    route();
  });
})();
