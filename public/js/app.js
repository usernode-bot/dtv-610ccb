// Dtv front end: a series browse screen, a series detail screen, the watch
// screen, My List, the Coins page, the transaction history, the genre onboarding
// and, for admins, the series manager. Path routes: "/" (browse),
// "/series/<slug>" (detail), "/watch/<episodeId>" (watch), "/my-list"
// (followed series), "/my-list/history" (watch history), "/store" (Coins),
// "/history" (transactions) and "/admin" (series manager). Locked episodes open
// the unlock sheet. Coins only ever change on the server: the page asks for an
// action and shows the balance the server answers with. Older "#/series/<slug>" links are
// moved to the path form. Links marked data-nav navigate in place. Onboarding
// is a full-screen layer over the page, shown on "#/onboarding" and, for a
// signed-in person who has not picked genres yet, on every route until they
// do. Everything is
// built with DOM calls and textContent, so catalogue text is never parsed as
// HTML. A sticky "Dtv" header sits above every screen and holds the back
// chevron for the current screen (setHeader per route); leaving the app is
// the Homeroom frame's job, not the header's. Class names are whole literals
// so the Tailwind build can see them.
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

  function episodesCount(n) { return t('episodesCount', { n: n }); }
  function coinsCount(n) { return t('coinsCount', { n: n }); }

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
    bookmark: [['path', { d: 'M6 4h12v17l-6-4-6 4z' }]],
    film: [['rect', { x: 3, y: 10, width: 18, height: 10, rx: 2 }],
      ['path', { d: 'M3 10 2.4 6.6 19.1 3.7 19.7 7.1z' }],
      ['path', { d: 'M7.5 5.7 9 9' }], ['path', { d: 'M12.8 4.8 14.3 8.1' }]],
    back: [['path', { d: 'M15 18l-6-6 6-6' }]],
    search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'M20 20l-4-4' }]],
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

  function setTitle(title) {
    document.title = title ? title + ' | Dtv' : 'Dtv';
  }

  function loadingNode(node) {
    node.dataset.loading = '1';
    return node;
  }

  // Poster grids: 2 columns on a phone, 3 on a large phone or small tablet,
  // 4 on a tablet, 5 on a laptop and 6 on a wide screen. A whole literal, so
  // the Tailwind build sees it. Breakpoints measure the Dtv frame.
  var POSTER_GRID = 'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

  /** n poster placeholders in the shared grid, for a loading state. */
  function posterSkeleton(n) {
    var grid = h('div', POSTER_GRID);
    for (var i = 0; i < n; i++) {
      grid.appendChild(h('div', 'flex flex-col gap-2', [
        h('div', 'skeleton aspect-[3/4] w-full'),
        h('div', 'skeleton h-5 w-3/4'),
        h('div', 'skeleton h-4 w-1/2'),
      ]));
    }
    return loadingNode(grid);
  }

  // ── App header ────────────────────────────────────────────────────────
  // The bar in index.html, painted before any JS runs. It says "you are in
  // Dtv" and puts the way back in one fixed place; the Homeroom frame above
  // it owns leaving the app, so this header never has an exit control.
  var headerBar = document.getElementById('app-header-bar');
  var BACK_HOME = { path: '/', label: 'Back to all series' };

  /** Show a back chevron at the left edge (back is {path, label} or null). */
  function setHeader(back) {
    if (!headerBar) return;
    var children = [];
    if (back) {
      var a = navLink(back.path, 'inline-flex h-11 w-11 items-center justify-center rounded-full text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [icon('back', 'h-6 w-6')]);
      a.setAttribute('aria-label', back.label);
      a.title = back.label;
      a.dataset.testid = 'header-back';
      children.push(a);
    }
    children.push(h('span', 'px-2 text-heading', 'Dtv'));
    headerBar.replaceChildren.apply(headerBar, children);
  }

  /** Put a screen in place. Loading screens are marked data-loading. */
  function show(node, back) {
    setHeader(back || null);
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

  // ── States ────────────────────────────────────────────────────────────
  function loadingBrowse() {
    return loadingNode(h('div', 'flex flex-col gap-4', [h('div', 'skeleton h-7 w-32'), posterSkeleton(12)]));
  }

  function loadingDetail() {
    return loadingNode(h('div', 'flex flex-col gap-4', [
      h('div', 'skeleton h-40 w-full sm:h-56'),
      h('div', 'skeleton h-8 w-2/3'),
      h('div', 'skeleton h-16 w-full'),
      h('div', 'skeleton h-11 w-full'),
      h('div', 'skeleton h-48 w-full'),
    ]));
  }

  function errorState(message, retry) {
    var retryBtn = h('button', 'btn-primary', t('retry'));
    retryBtn.type = 'button';
    retryBtn.addEventListener('click', retry);
    return h('div', 'state-error', [
      h('h2', 'text-heading', message),
      h('p', 'text-body text-muted', t('checkConnection')),
      retryBtn,
    ]);
  }

  // ── Browse ────────────────────────────────────────────────────────────
  // Where a request for a series is filed: this app's page on Homeroom.
  var REQUEST_URL = 'https://app.onhomeroom.com/#app/dtv-610ccb';

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
    // The follow count fills the header button when it arrives; it never
    // blocks or fails the catalogue itself.
    var followsReq = isGuest() ? null : api('/api/me/follows');
    api('/api/series').then(function (data) {
      var page = h('div', 'flex flex-col gap-4');
      var link = myListLink();
      if (followsReq) followsReq.then(function (d) { link.setCount(d.series.length); }).catch(function () {});
      page.appendChild(h('div', 'flex items-center justify-between gap-4', [
        h('h1', 'text-title', t('series')),
        h('div', 'flex items-center gap-4', [adminLink(), link, coinChip()]),
      ]));
      if (data.demo) {
        page.appendChild(h('p', 'text-small text-muted', t('stagingDemo')));
      }
      if (!data.series.length) {
        page.appendChild(h('div', 'state-empty', [
          h('div', 'mb-2 flex h-20 w-20 items-center justify-center rounded-xl bg-accent/15 text-accent', [icon('film', 'h-10 w-10')]),
          h('h2', 'text-heading', t('noSeriesTitle')),
          h('p', 'text-body text-muted', t('noSeriesBody')),
          requestLink(),
        ]));
      } else {
        var all = data.series;
        var input = h('input', 'field pl-10');
        input.type = 'search';
        input.id = 'series-search';
        input.placeholder = t('searchSeries');
        input.setAttribute('aria-label', t('searchSeries'));
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.dataset.testid = 'series-search';
        var search = h('div', 'relative', [
          icon('search', 'pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted'),
          input,
        ]);
        page.appendChild(search);
        var grid = h('div', POSTER_GRID);
        grid.dataset.testid = 'series-grid';
        var noMatchTitle = h('h2', 'text-heading', '');
        var clearBtn = h('button', 'btn-secondary mt-2', t('clearSearch'));
        clearBtn.type = 'button';
        clearBtn.dataset.testid = 'clear-search';
        var noMatch = h('div', 'state-empty', [
          noMatchTitle,
          h('p', 'text-body text-muted', t('noMatchBody')),
          clearBtn,
        ]);
        noMatch.setAttribute('role', 'status');
        noMatch.dataset.testid = 'series-no-match';
        noMatch.hidden = true;
        function applySearch() {
          var q = input.value.trim();
          var needle = q.toLowerCase();
          var hits = needle
            ? all.filter(function (s) { return s.title.toLowerCase().indexOf(needle) !== -1; })
            : all;
          grid.replaceChildren.apply(grid, hits.map(tile));
          grid.hidden = !hits.length;
          noMatch.hidden = !!hits.length;
          if (!hits.length) noMatchTitle.textContent = t('noMatchTitle', { q: q });
        }
        input.addEventListener('input', applySearch);
        clearBtn.addEventListener('click', function () {
          input.value = '';
          applySearch();
          input.focus();
        });
        applySearch();
        page.appendChild(grid);
        page.appendChild(noMatch);
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

  /** The balance button on the Series screen; it opens the Coins page. */
  function coinChip() {
    var a = navLink('/store', 'inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-body font-medium text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
      icon('coin', 'h-4 w-4 text-accent'),
      signedIn() ? coins(me.profile.coinBalance) : 'Coins',
    ]);
    a.dataset.testid = 'coin-balance';
    return a;
  }

  /** An external link to where requests for this app are filed. Not data-nav, so the in-app click handler leaves it alone. */
  function requestLink() {
    var a = h('a', 'btn-primary mt-2', 'Request a series');
    a.href = REQUEST_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.testid = 'request-series';
    return a;
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

  /** "Manage series", for admins only. */
  function adminLink() {
    if (!isAdmin()) return null;
    var a = navLink('/admin', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'Manage series');
    a.dataset.testid = 'admin-link';
    return a;
  }

  // The My List entry on the browse header: a quiet bordered pill matching the
  // unselected My List tabs, with a bookmark icon and (once known) the number
  // of series the person follows. Guests and failed counts just see "My List".
  function myListLink() {
    var label = h('span', '', t('myList'));
    label.dataset.testid = 'my-list-count-label';
    var a = navLink('/my-list', 'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 text-body font-medium text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [icon('bookmark'), label]);
    a.dataset.testid = 'my-list-link';
    a.setCount = function (n) { label.textContent = t('myList') + ' (' + n + ')'; };
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
    var body = h('div', '', [tab === 'history' ? loadingList() : posterSkeleton(6)]);
    body.setAttribute('aria-busy', 'true');
    show(h('div', 'flex flex-col gap-4', [
      h('h1', 'text-title', t('myList')),
      tabs,
      body,
    ]), BACK_HOME);

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
        var list = h('ul', 'list max-w-2xl');
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
        var grid = h('div', POSTER_GRID);
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
          fail(t('notEnoughCoins', { n: e.number }));
        } else if (err.status === 401) { state.busy = false; paint(); }
        else fail(t('unlockFailed'));
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
    var body = posterSkeleton(6);
    section.appendChild(body);
    function load() {
      api('/api/series/' + encodeURIComponent(slug) + '/related').then(function (data) {
        if (!data.series.length) {
          body.replaceWith(body = h('p', 'px-1 text-body text-muted', t('noOtherSeries')));
          return;
        }
        var grid = h('div', POSTER_GRID);
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
    show(loadingDetail(), BACK_HOME);
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
      var synopsis = h('p', 'text-body line-clamp-3 max-w-prose', s.synopsis);
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
        var grid = h('ol', 'grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10');
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
          h('div', 'flex gap-2 sm:max-w-md', [watchBtn, followBtn, shareBtn]),
          message,
        ]),
        h('section', '', [h('h2', 'section-label', t('episodes')), episodes]),
        relatedSection(slug),
      ]);
      show(page, BACK_HOME);
      moreBtn.hidden = synopsis.scrollHeight <= synopsis.clientHeight + 1;
    }).catch(function (err) {
      if (err.status === 404) {
        show(h('div', 'state-empty', [
          h('h2', 'text-heading', t('seriesNotFound')),
          h('p', 'text-body text-muted', t('mayBeRemoved')),
          navLink('/', 'btn-secondary', t('browseSeries')),
        ]), BACK_HOME);
      } else {
        show(errorState(t('loadOneSeriesFailed'), function () { renderDetail(slug); }), BACK_HOME);
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
    var fromSlug = history.state && history.state.seriesSlug;
    var back = fromSlug
      ? { path: '/series/' + encodeURIComponent(fromSlug), label: t('backToSeries') }
      : BACK_HOME;
    show(loadingDetail(), back);
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
        h('div', 'flex flex-col gap-1', [
          h('h1', 'text-title', title),
          h('p', 'text-small text-muted', minutes(e.durationSeconds)),
        ]),
        body,
      ]), back);
    }).catch(function (err) {
      if (err.status === 404) {
        show(h('div', 'state-empty', [
          h('h2', 'text-heading', t('episodeNotFound')),
          h('p', 'text-body text-muted', t('mayBeRemoved')),
          navLink('/', 'btn-secondary', t('browseSeries')),
        ]), back);
      } else {
        show(errorState(t('loadEpisodeFailed'), function () { renderWatch(id); }), back);
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

  // ── Series manager (admins only) ──────────────────────────────────────
  // "/admin" lists every series with its published state; "/admin/series/new"
  // and "/admin/series/<id>" are the series form; "/admin/series/<id>/episodes"
  // adds episodes in bulk. Who is an admin is the server's call (/api/me says
  // isAdmin; every /api/admin route checks again). The rules below repeat
  // lib/admin.ts so most mistakes show before anything is sent; the server's
  // own field errors land in the same places.
  var COUNTRY_LABEL = { china: 'China', korea: 'Korea' };
  var FORMAT_LABEL = { long: 'Long (45-70 min episodes)', short: 'Short (1-3 min episodes)' };
  var SUBTITLE_LABEL = { en: 'English', id: 'Indonesian', 'zh-Hans': 'Chinese', ko: 'Korean' };
  var LIMITS = { title: 120, description: 2000, genres: 5, totalEpisodes: 500, yearMin: 1900, yearMax: 2100, rows: 200, durationMax: 6 * 3600 };
  var LINK_CLS = 'inline-flex min-h-11 items-center self-start text-body font-medium text-accent';

  function isAdmin() { return !!(me && me !== 'guest' && me.isAdmin); }

  function adminBack() { return navLink('/admin', LINK_CLS, 'Manage series'); }

  function notAdminState() {
    var page = h('div', 'flex flex-col gap-4', [
      navLink('/', LINK_CLS, 'All series'),
      h('div', 'state-empty', [
        h('h1', 'text-heading', 'Only Dtv admins can manage series'),
        h('p', 'text-body text-muted', 'Ask whoever runs Dtv to add your username to the app’s admin list (the ADMIN_USERNAMES app secret).'),
      ]),
    ]);
    page.dataset.testid = 'admin-required';
    return page;
  }

  function isHttpsUrl(v) {
    try { return new URL(v).protocol === 'https:'; } catch (_) { return false; }
  }

  /** "45:00", "1:02:30" or plain minutes as seconds; NaN otherwise (same as lib/admin.ts). */
  function parseDuration(v) {
    var s = String(v || '').trim(), m;
    if ((m = /^(\d+):([0-5]\d)$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
    if ((m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(s))) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (/^\d+$/.test(s)) return Number(s) * 60;
    return NaN;
  }

  function validateSeriesForm(v, minTotal) {
    var f = {};
    if (!v.title) f.title = 'Enter a title.';
    else if (v.title.length > LIMITS.title) f.title = 'Keep the title to ' + LIMITS.title + ' characters or fewer.';
    if (v.originalTitle.length > LIMITS.title) f.originalTitle = 'Keep the original title to ' + LIMITS.title + ' characters or fewer.';
    if (!COUNTRY_LABEL[v.country]) f.country = 'Choose a country.';
    if (!FORMAT_LABEL[v.format]) f.format = 'Choose a format.';
    if (!v.genres.length) f.genres = 'Pick at least one genre.';
    else if (v.genres.length > LIMITS.genres) f.genres = 'Pick up to ' + LIMITS.genres + ' genres.';
    var year = /^\d+$/.test(v.year) ? Number(v.year) : NaN;
    if (!v.year) f.year = 'Enter the release year.';
    else if (!(year >= LIMITS.yearMin && year <= LIMITS.yearMax)) f.year = 'Enter a year from ' + LIMITS.yearMin + ' to ' + LIMITS.yearMax + '.';
    if (!v.description) f.description = 'Enter a description.';
    else if (v.description.length > LIMITS.description) f.description = 'Keep the description to ' + LIMITS.description + ' characters or fewer.';
    var total = /^\d+$/.test(v.totalEpisodes) ? Number(v.totalEpisodes) : NaN;
    if (!v.totalEpisodes) f.totalEpisodes = 'Enter the total number of episodes.';
    else if (!(total >= 1 && total <= LIMITS.totalEpisodes)) f.totalEpisodes = 'Enter a whole number from 1 to ' + LIMITS.totalEpisodes + '.';
    else if (total < minTotal) f.totalEpisodes = 'This series already has ' + minTotal + ' episodes. Enter ' + minTotal + ' or more.';
    return f;
  }

  function validateEpisodeRows(rows) {
    var f = {};
    if (!rows.length) f.episodes = 'Add at least one episode.';
    else if (rows.length > LIMITS.rows) f.episodes = 'Add up to ' + LIMITS.rows + ' episodes at a time.';
    rows.forEach(function (r, i) {
      var k = 'episodes.' + i + '.';
      if (!r.videoUrl) f[k + 'videoUrl'] = 'Enter the video URL.';
      else if (!isHttpsUrl(r.videoUrl)) f[k + 'videoUrl'] = 'Enter a full link starting with https://.';
      var d = parseDuration(r.duration);
      if (!r.duration) f[k + 'duration'] = 'Enter the duration.';
      else if (!(d > 0 && d <= LIMITS.durationMax)) f[k + 'duration'] = 'Enter minutes:seconds, e.g. 45:00.';
      if (!SUBTITLE_LABEL[r.subtitleLang]) f[k + 'subtitleLang'] = 'Choose a subtitle language.';
    });
    return f;
  }

  var fieldSeq = 0;
  /**
   * A labelled control with its own error line. `control` is the input; the
   * label points at it and the error is announced with it.
   */
  function field(label, control, hint) {
    var id = 'f' + (++fieldSeq);
    control.id = control.id || id;
    var err = h('p', 'text-small text-danger');
    err.id = id + '-error';
    err.hidden = true;
    var lab = h('label', 'text-body font-medium', label);
    lab.htmlFor = control.id;
    var wrap = h('div', 'flex flex-col gap-1', [lab, hint ? h('p', 'text-small text-muted', hint) : null, control, err]);
    return {
      el: wrap,
      control: control,
      setError: function (msg) {
        err.textContent = msg || '';
        err.hidden = !msg;
        if (msg) {
          control.setAttribute('aria-invalid', 'true');
          control.setAttribute('aria-describedby', err.id);
        } else {
          control.removeAttribute('aria-invalid');
          control.removeAttribute('aria-describedby');
        }
      },
    };
  }

  function input(type, value, attrs) {
    var el = h('input', 'field');
    el.type = type;
    if (value != null) el.value = String(value);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function select(options, value, placeholder) {
    var el = h('select', 'field');
    if (placeholder) {
      var p = h('option', '', placeholder);
      p.value = '';
      el.appendChild(p);
    }
    Object.keys(options).forEach(function (k) {
      var o = h('option', '', options[k]);
      o.value = k;
      el.appendChild(o);
    });
    el.value = value || '';
    return el;
  }

  /** Focus the first control that shows an error, so it is not missed below the fold. */
  function focusFirstError(container) {
    var bad = container.querySelector('[aria-invalid="true"]');
    if (bad) { bad.focus({ preventScroll: true }); bad.scrollIntoView({ block: 'center' }); }
  }

  // Downscale a large photo before it goes to platform storage (5 MB cap).
  // GIFs go as they are (a canvas would drop the animation).
  var MAX_SIDE = 2000;
  function prepareImage(file) {
    if (file.type === 'image/gif' || !window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size <= 4.5 * 1024 * 1024) return file;
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file);
        }, 'image/jpeg', 0.9);
      });
    }, function () { return file; });
  }

  /** Poster or banner: a preview, Upload / Replace and Remove. The URL is in .value(). */
  function imageUpload(label, url, previewCls, testid) {
    var current = url || null;
    var preview = h('div', 'flex items-center justify-center overflow-hidden rounded-lg border border-line bg-raised ' + previewCls);
    var fileInput = h('input', '');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    fileInput.hidden = true;
    var pick = h('button', 'btn-secondary');
    pick.type = 'button';
    var remove = h('button', 'btn-secondary', 'Remove');
    remove.type = 'button';
    var status = h('p', 'text-small text-muted');
    status.setAttribute('role', 'status');
    // The label names the Upload button; the file input itself stays hidden.
    var f = field(label, pick);

    function paint() {
      preview.replaceChildren(current
        ? (function () { var img = h('img', 'h-full w-full object-cover'); img.src = current; img.alt = label + ' preview'; return img; })()
        : h('span', 'text-small text-muted', 'No image'));
      pick.textContent = current ? 'Replace' : 'Upload';
      remove.hidden = !current;
    }
    paint();
    pick.addEventListener('click', function () { fileInput.click(); });
    remove.addEventListener('click', function () { current = null; f.setError(''); paint(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        return f.setError('Choose a PNG, JPEG, WebP or GIF image.');
      }
      if (!(window.usernode && window.usernode.uploadFile)) {
        return f.setError('Uploads only work when Dtv is opened inside Homeroom.');
      }
      f.setError('');
      pick.disabled = true;
      status.textContent = 'Uploading…';
      prepareImage(file).then(function (ready) {
        return window.usernode.uploadFile(ready, { visibility: 'public' });
      }).then(function (stored) {
        current = stored.url;
        status.textContent = '';
        paint();
      }).catch(function (err) {
        status.textContent = '';
        var code = err && (err.code || err.message);
        f.setError(code === 'file_too_large' ? 'That image is over 5 MB. Choose a smaller one.'
          : code === 'invalid_image' ? 'That file is not an image we can use. Choose a PNG, JPEG, WebP or GIF.'
          : /quota/.test(String(code)) ? 'Storage for this app is full. Remove old images first.'
          : 'Could not upload the image. Try again.');
      }).then(function () { pick.disabled = false; });
    });

    var box = h('div', 'flex items-end gap-3', [preview, h('div', 'flex flex-wrap gap-2', [pick, remove]), fileInput]);
    f.el.insertBefore(box, f.el.querySelector('p.text-danger'));
    f.el.appendChild(status);
    f.el.dataset.testid = testid;
    return { el: f.el, setError: f.setError, control: pick, value: function () { return current; } };
  }

  function loadingForm() {
    var rows = h('div', 'flex flex-col gap-4');
    for (var i = 0; i < 6; i++) rows.appendChild(h('div', 'flex flex-col gap-1', [h('div', 'skeleton h-5 w-24'), h('div', 'skeleton h-11 w-full')]));
    return h('div', 'flex flex-col gap-4', [h('div', 'skeleton h-5 w-32'), h('div', 'skeleton h-8 w-48'), rows]);
  }

  // ── Admin list ──
  function renderAdminList() {
    if (!isAdmin()) return show(notAdminState());
    show(h('div', 'flex flex-col gap-4', [navLink('/', LINK_CLS, 'All series'), loadingList()]));
    api('/api/admin/series').then(function (data) {
      var page = h('div', 'flex flex-col gap-4');
      page.appendChild(navLink('/', LINK_CLS, 'All series'));
      var add = navLink('/admin/series/new', 'btn-primary', 'Add series');
      add.dataset.testid = 'admin-add-series';
      page.appendChild(h('div', 'flex items-center justify-between gap-4', [h('h1', 'text-title', 'Manage series'), add]));
      page.appendChild(h('p', 'text-body text-muted', 'Viewers only see published series. A series you add starts unpublished.'));
      if (!data.series.length) {
        page.appendChild(h('div', 'state-empty', [
          h('h2', 'text-heading', 'No series yet'),
          h('p', 'text-body text-muted', 'Add the first series, then its episodes, then publish it.'),
        ]));
        return show(page);
      }
      var list = h('ul', 'list');
      list.dataset.testid = 'admin-series-list';
      data.series.forEach(function (s) {
        var published = s.isPublished;
        var badge = h('span', '');
        var toggle = h('button', 'btn-secondary shrink-0');
        toggle.type = 'button';
        var err = h('p', 'text-small text-danger');
        err.hidden = true;
        function paint() {
          badge.className = published ? 'text-small font-medium text-accent' : 'text-small text-muted';
          badge.textContent = published ? 'Published' : 'Unpublished';
          toggle.textContent = published ? 'Unpublish' : 'Publish';
          toggle.setAttribute('aria-label', (published ? 'Unpublish ' : 'Publish ') + s.title);
        }
        paint();
        toggle.addEventListener('click', function () {
          toggle.disabled = true;
          err.hidden = true;
          api('/api/admin/series/' + s.id + '/published', 'PUT', { published: !published }).then(function (r) {
            published = r.published;
            paint();
          }).catch(function (e) {
            err.textContent = e.status === 400 ? 'Add at least one episode before publishing.' : 'Could not change it. Try again.';
            err.hidden = false;
          }).then(function () { toggle.disabled = false; });
        });
        var li = h('li', 'list-row flex-wrap', [
          navLink('/admin/series/' + s.id, 'flex min-w-0 flex-1 flex-col rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
            h('span', 'truncate text-body font-semibold', s.title),
            h('span', 'text-small text-muted', [
              (s.totalEpisodes ? s.episodeCount + ' of ' + plural(s.totalEpisodes, 'episode', 'episodes') : plural(s.episodeCount, 'episode', 'episodes')) +
                (s.isDemo ? ' · Staging demo' : '') + ' · ',
              badge,
            ]),
          ]),
          toggle,
          err,
        ]);
        li.dataset.testid = 'admin-series-row';
        list.appendChild(li);
      });
      page.appendChild(list);
      show(page);
    }).catch(function (err) {
      if (err.status === 403 || err.status === 401) return show(notAdminState());
      show(errorState('Could not load the series list', renderAdminList, navLink('/', LINK_CLS, 'All series')));
    });
  }

  // ── Series form (add and edit) ──
  function renderSeriesForm(id) {
    if (!isAdmin()) return show(notAdminState());
    show(loadingForm());
    var notice = history.state && history.state.notice;
    Promise.all([
      api('/api/genres'),
      id ? api('/api/admin/series/' + id) : Promise.resolve({ series: null }),
    ]).then(function (res) {
      var genres = res[0].genres;
      var s = res[1].series;
      var minTotal = s ? s.episodes.length : 0;

      var fTitle = field('Title', input('text', s && s.title, { maxlength: String(LIMITS.title), autocomplete: 'off' }));
      var fOriginal = field('Original title (optional)', input('text', s && s.originalTitle, { maxlength: String(LIMITS.title), placeholder: 'e.g. 灯守之女', autocomplete: 'off' }));
      var fCountry = field('Country', select(COUNTRY_LABEL, s && s.country, 'Choose a country'));
      var fFormat = field('Format', select(FORMAT_LABEL, s && s.format, 'Choose a format'));

      var picked = (s && s.genres) ? s.genres.slice() : [];
      var chips = h('div', 'flex flex-wrap gap-2');
      chips.setAttribute('role', 'group');
      chips.dataset.testid = 'admin-genres';
      genres.forEach(function (g) {
        var chip = h('button', '', g.name);
        chip.type = 'button';
        function paint() {
          var on = picked.indexOf(g.slug) >= 0;
          chip.className = on
            ? 'inline-flex min-h-11 items-center rounded-full border border-accent bg-accent px-4 text-body font-medium text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
            : 'inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-body text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
          chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        paint();
        chip.addEventListener('click', function () {
          var i = picked.indexOf(g.slug);
          if (i >= 0) picked.splice(i, 1); else picked.push(g.slug);
          paint();
        });
        chips.appendChild(chip);
      });
      var fGenres = field('Genres', chips, 'The first one you pick is the main genre.');
      fGenres.el.querySelector('label').htmlFor = '';
      chips.setAttribute('aria-label', 'Genres');
      chips.tabIndex = -1;
      if (!genres.length) chips.appendChild(h('p', 'text-small text-muted', 'There are no genres yet.'));

      var fYear = field('Release year', input('text', s && s.year, { inputmode: 'numeric', placeholder: 'e.g. 2024', autocomplete: 'off' }));
      var fTotal = field('Total episodes', input('text', s && s.totalEpisodes, { inputmode: 'numeric', placeholder: 'e.g. 36', autocomplete: 'off' }),
        minTotal ? 'Added so far: ' + plural(minTotal, 'episode', 'episodes') + '.' : null);
      var desc = h('textarea', 'field');
      desc.rows = 5;
      desc.maxLength = LIMITS.description;
      desc.value = (s && s.description) || '';
      var fDesc = field('Description', desc);
      var fPoster = imageUpload('Poster (optional)', s && s.posterUrl, 'aspect-[3/4] w-24', 'admin-poster');
      var fBanner = imageUpload('Banner (optional)', s && s.bannerUrl, 'aspect-video w-40', 'admin-banner');

      var fields = { title: fTitle, originalTitle: fOriginal, country: fCountry, format: fFormat, genres: fGenres,
        year: fYear, totalEpisodes: fTotal, description: fDesc, posterUrl: fPoster, bannerUrl: fBanner };

      var save = h('button', 'btn-primary w-full sm:w-auto', s ? 'Save changes' : 'Add series');
      save.type = 'submit';
      save.dataset.testid = 'admin-save-series';
      var formMsg = h('p', 'text-small');
      formMsg.setAttribute('role', 'status');
      function setFormMsg(text, isError) {
        formMsg.className = 'text-small ' + (isError ? 'text-danger' : 'text-muted');
        formMsg.textContent = text || '';
      }
      if (notice) setFormMsg(notice);

      var form = h('form', 'flex flex-col gap-4', [
        fTitle.el, fOriginal.el,
        h('div', 'grid gap-4 sm:grid-cols-2', [fCountry.el, fFormat.el]),
        fGenres.el,
        h('div', 'grid gap-4 sm:grid-cols-2', [fYear.el, fTotal.el]),
        fDesc.el, fPoster.el, fBanner.el,
        h('div', 'flex flex-col gap-2', [save, formMsg]),
      ]);
      form.noValidate = true;
      form.dataset.testid = 'admin-series-form';

      function showErrors(errs) {
        Object.keys(fields).forEach(function (k) { fields[k].setError(errs[k]); });
        if (Object.keys(errs).length) {
          setFormMsg('Fix the ' + (Object.keys(errs).length === 1 ? 'field' : 'fields') + ' marked above.', true);
          focusFirstError(form);
        }
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var values = {
          title: fTitle.control.value.trim(), originalTitle: fOriginal.control.value.trim(),
          country: fCountry.control.value, format: fFormat.control.value, genres: picked.slice(),
          year: fYear.control.value.trim(), totalEpisodes: fTotal.control.value.trim(),
          description: desc.value.trim(), posterUrl: fPoster.value(), bannerUrl: fBanner.value(),
        };
        setFormMsg('');
        var errs = validateSeriesForm(values, minTotal);
        showErrors(errs);
        if (Object.keys(errs).length) return;
        save.disabled = true;
        api(s ? '/api/admin/series/' + s.id : '/api/admin/series', s ? 'PUT' : 'POST', values).then(function (r) {
          if (s) {
            s = r.series;
            setFormMsg('Changes saved.');
            save.disabled = false;
          } else {
            history.replaceState(null, '', '/admin' + location.search);
            navigate('/admin/series/' + r.series.id, { notice: 'Series added. Add its episodes, then publish it.' });
          }
        }).catch(function (err) {
          save.disabled = false;
          if (err.status === 400 && err.body && err.body.fields) showErrors(err.body.fields);
          else if (err.status === 403) show(notAdminState());
          else if (err.status === 404) setFormMsg('This series no longer exists.', true);
          else setFormMsg('Could not save. Your changes are still here. Try again.', true);
        });
      });

      var parts = [adminBack(), h('h1', 'text-title', s ? 'Edit series' : 'Add series')];
      if (s) parts.push(publishSection(s), episodesLink(s));
      parts.push(form);
      if (s) parts.push(deleteSection(s));
      show(h('div', 'flex flex-col gap-6', parts));
    }).catch(function (err) {
      if (err.status === 403 || err.status === 401) return show(notAdminState());
      if (err.status === 404) {
        return show(h('div', 'state-empty', [
          h('h2', 'text-heading', 'Series not found'),
          h('p', 'text-body text-muted', 'It may have been deleted.'),
          adminBack(),
        ]));
      }
      show(errorState(id ? 'Could not load this series' : 'Could not load the genres', function () { renderSeriesForm(id); }, adminBack()));
    });
  }

  function publishSection(s) {
    var published = s.isPublished;
    var text = h('p', 'text-body');
    var btn = h('button', 'btn-secondary shrink-0');
    btn.type = 'button';
    btn.dataset.testid = 'admin-publish-toggle';
    var err = h('p', 'text-small text-danger');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    function paint() {
      text.replaceChildren(
        h('span', published ? 'font-semibold text-accent' : 'font-semibold', published ? 'Published' : 'Unpublished'),
        h('span', 'text-muted', published ? '. Everyone can see it.' : '. Only admins can see it.'));
      btn.textContent = published ? 'Unpublish' : 'Publish';
      btn.setAttribute('aria-pressed', published ? 'true' : 'false');
    }
    paint();
    btn.addEventListener('click', function () {
      btn.disabled = true;
      err.hidden = true;
      api('/api/admin/series/' + s.id + '/published', 'PUT', { published: !published }).then(function (r) {
        published = s.isPublished = r.published;
        paint();
      }).catch(function (e) {
        err.textContent = (e.body && e.body.fields && e.body.fields.published) || 'Could not change it. Try again.';
        err.hidden = false;
      }).then(function () { btn.disabled = false; });
    });
    return h('div', 'flex flex-col gap-2', [h('div', 'list-row list', [h('div', 'flex-1', [text]), btn]), err]);
  }

  function episodesLink(s) {
    var a = navLink('/admin/series/' + s.id + '/episodes', 'list-row list hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
      h('span', 'flex-1 text-body font-medium', 'Episodes'),
      h('span', 'text-small text-muted', s.episodes.length + (s.totalEpisodes ? ' of ' + s.totalEpisodes : '') + ' added'),
    ]);
    a.dataset.testid = 'admin-episodes-link';
    return a;
  }

  function deleteSection(s) {
    var box = h('section', 'flex flex-col items-start gap-2 border-t border-line pt-6');
    var start = h('button', 'inline-flex min-h-11 items-center text-body font-medium text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', 'Delete series');
    start.type = 'button';
    start.dataset.testid = 'admin-delete-series';
    var err = h('p', 'text-small text-danger');
    err.setAttribute('role', 'alert');
    function idle() { box.replaceChildren(start); }
    start.addEventListener('click', function () {
      var confirmBtn = h('button', 'btn-primary bg-danger text-on-danger', 'Delete');
      confirmBtn.type = 'button';
      confirmBtn.dataset.testid = 'admin-confirm-delete';
      var cancel = h('button', 'btn-secondary', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', idle);
      confirmBtn.addEventListener('click', function () {
        confirmBtn.disabled = true;
        err.textContent = '';
        api('/api/admin/series/' + s.id, 'DELETE').then(function () {
          navigate('/admin');
        }).catch(function () {
          confirmBtn.disabled = false;
          err.textContent = 'Could not delete it. Try again.';
        });
      });
      box.replaceChildren(
        h('p', 'text-body', 'Delete “' + s.title + '” and its ' + plural(s.episodes.length, 'episode', 'episodes') + '? Viewers lose their follows and history for it. This cannot be undone.'),
        h('div', 'flex gap-2', [confirmBtn, cancel]),
        err);
      cancel.focus();
    });
    idle();
    return box;
  }

  // ── Episodes: what is there, and the bulk add form ──
  function renderEpisodesAdmin(id) {
    if (!isAdmin()) return show(notAdminState());
    show(loadingForm());
    var back = navLink('/admin/series/' + id, LINK_CLS, 'Back to series');
    api('/api/admin/series/' + id).then(function (data) {
      var s = data.series;
      var page = h('div', 'flex flex-col gap-6');
      var existing = h('section', '');
      var adder = h('section', '');
      var notice = h('p', 'text-small text-muted');
      notice.setAttribute('role', 'status');

      function paintExisting() {
        existing.replaceChildren(h('h2', 'section-label', 'Added (' + s.episodes.length + (s.totalEpisodes ? ' of ' + s.totalEpisodes : '') + ')'));
        if (!s.episodes.length) {
          existing.appendChild(h('p', 'px-1 text-body text-muted', 'No episodes yet. Add them below.'));
          return;
        }
        var list = h('ul', 'list');
        list.dataset.testid = 'admin-episode-list';
        s.episodes.forEach(function (e) {
          var del = h('button', 'btn-secondary shrink-0', 'Delete');
          del.type = 'button';
          del.setAttribute('aria-label', 'Delete episode ' + e.number);
          del.addEventListener('click', function () {
            del.disabled = true;
            api('/api/admin/episodes/' + e.id, 'DELETE').then(function () {
              s.episodes = s.episodes.filter(function (x) { return x.id !== e.id; });
              notice.textContent = 'Episode ' + e.number + ' deleted.';
              paintExisting();
              paintRows();
            }).catch(function () {
              del.disabled = false;
              notice.textContent = 'Could not delete episode ' + e.number + '. Try again.';
            });
          });
          list.appendChild(h('li', 'list-row', [
            h('span', 'flex min-w-0 flex-1 flex-col', [
              h('span', 'text-body font-semibold', 'Episode ' + e.number),
              h('span', 'truncate text-small text-muted', minutes(e.durationSeconds) + ' · ' +
                (e.subtitleLangs || []).map(function (l) { return SUBTITLE_LABEL[l] || l; }).join(', ') + ' · ' +
                (e.free ? 'Free' : 'Locked, ' + plural(e.coinPrice, 'coin', 'coins'))),
            ]),
            del,
          ]));
        });
        existing.appendChild(list);
      }

      // Rows of the bulk form. Each new row copies the previous row's
      // subtitle language; the first three episodes of a series start free.
      var rows = [];
      var rowList = h('ol', 'flex flex-col gap-3');
      rowList.dataset.testid = 'admin-episode-rows';
      var formErr = h('p', 'text-small text-danger');
      formErr.setAttribute('role', 'alert');
      formErr.hidden = true;
      var submit = h('button', 'btn-primary w-full sm:w-auto');
      submit.type = 'submit';
      submit.dataset.testid = 'admin-save-episodes';

      function nextNumber() {
        return s.episodes.reduce(function (m, e) { return Math.max(m, e.number); }, 0) + 1;
      }

      function addRow() {
        var prev = rows[rows.length - 1];
        var url = input('url', '', { placeholder: 'e.g. https://cdn.example.com/ep1.m3u8', autocomplete: 'off', inputmode: 'url' });
        var dur = input('text', '', { placeholder: 'e.g. 45:00', autocomplete: 'off' });
        var lang = select(SUBTITLE_LABEL, prev ? prev.lang.control.value : 'en');
        var free = h('input', 'h-5 w-5 accent-accent');
        free.type = 'checkbox';
        var remove = h('button', 'btn-secondary', 'Remove');
        remove.type = 'button';
        var row = {
          url: field('Video URL', url), dur: field('Duration (min:sec)', dur), lang: field('Subtitle language', lang),
          free: free, remove: remove, freeTouched: false,
        };
        free.addEventListener('change', function () { row.freeTouched = true; });
        remove.addEventListener('click', function () {
          rows.splice(rows.indexOf(row), 1);
          if (!rows.length) addRow(); else paintRows();
        });
        var freeLabel = h('label', 'inline-flex min-h-11 items-center gap-2 text-body', [free, 'Free episode']);
        row.title = h('h3', 'text-body font-semibold');
        row.el = h('li', 'card flex flex-col gap-3', [
          row.title,
          row.url.el,
          h('div', 'grid gap-3 sm:grid-cols-2', [row.dur.el, row.lang.el]),
          h('div', 'flex items-center justify-between gap-2', [freeLabel, remove]),
        ]);
        rows.push(row);
        paintRows();
        return row;
      }

      function paintRows() {
        var first = nextNumber();
        rowList.replaceChildren();
        rows.forEach(function (r, i) {
          var n = first + i;
          r.title.textContent = 'Episode ' + n;
          if (!r.freeTouched) r.free.checked = n <= 3;
          r.remove.setAttribute('aria-label', 'Remove episode ' + n + ' row');
          r.remove.hidden = rows.length === 1;
          rowList.appendChild(r.el);
        });
        submit.textContent = 'Add ' + plural(rows.length, 'episode', 'episodes');
      }

      var addOne = h('button', 'btn-secondary', 'Add a row');
      addOne.type = 'button';
      addOne.addEventListener('click', function () { addRow().url.control.focus(); });
      var addFive = h('button', 'btn-secondary', 'Add 5 rows');
      addFive.type = 'button';
      addFive.addEventListener('click', function () {
        var r = addRow();
        for (var i = 0; i < 4; i++) addRow();
        r.url.control.focus();
      });

      var form = h('form', 'flex flex-col gap-3', [
        rowList,
        h('div', 'flex flex-wrap gap-2', [addOne, addFive]),
        formErr,
        submit,
      ]);
      form.noValidate = true;

      function showErrors(errs) {
        rows.forEach(function (r, i) {
          r.url.setError(errs['episodes.' + i + '.videoUrl']);
          r.dur.setError(errs['episodes.' + i + '.duration']);
          r.lang.setError(errs['episodes.' + i + '.subtitleLang']);
        });
        var n = Object.keys(errs).length;
        formErr.textContent = errs.episodes || (n ? 'Fix the ' + (n === 1 ? 'field' : 'fields') + ' marked above.' : '');
        formErr.hidden = !n;
        if (n) focusFirstError(form);
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        notice.textContent = '';
        var values = rows.map(function (r) {
          return { videoUrl: r.url.control.value.trim(), duration: r.dur.control.value.trim(),
            subtitleLang: r.lang.control.value, free: r.free.checked };
        });
        var errs = validateEpisodeRows(values);
        if (s.totalEpisodes && s.episodes.length + values.length > s.totalEpisodes && !Object.keys(errs).length) {
          var room = Math.max(0, s.totalEpisodes - s.episodes.length);
          errs.episodes = room
            ? 'This series has ' + s.totalEpisodes + ' episodes planned and ' + s.episodes.length + ' added, so there is room for ' + room + ' more. Remove rows or raise the total episodes.'
            : 'This series already has all ' + s.totalEpisodes + ' planned episodes. Raise the total episodes to add more.';
        }
        showErrors(errs);
        if (Object.keys(errs).length) return;
        submit.disabled = true;
        api('/api/admin/series/' + s.id + '/episodes', 'POST', { episodes: values }).then(function (r) {
          s = r.series;
          rows = [];
          addRow();
          paintExisting();
          notice.textContent = plural(r.added, 'episode', 'episodes') + ' added.';
        }).catch(function (err) {
          if (err.status === 400 && err.body && err.body.fields) showErrors(err.body.fields);
          else {
            formErr.textContent = 'Could not add the episodes. Your rows are still here. Try again.';
            formErr.hidden = false;
          }
        }).then(function () { submit.disabled = false; });
      });

      adder.appendChild(h('h2', 'section-label', 'Add episodes'));
      adder.appendChild(form);
      addRow();
      paintExisting();
      page.append(back, h('div', 'flex flex-col gap-1', [
        h('h1', 'text-title', 'Episodes'),
        h('p', 'text-body text-muted', s.title + '. Locked episodes cost ' + plural(s.format === 'short' ? 3 : 15, 'coin', 'coins') + ' each.'),
      ]), notice, existing, adder);
      show(page);
    }).catch(function (err) {
      if (err.status === 403 || err.status === 401) return show(notAdminState());
      if (err.status === 404) {
        return show(h('div', 'state-empty', [
          h('h2', 'text-heading', 'Series not found'),
          h('p', 'text-body text-muted', 'It may have been deleted.'),
          adminBack(),
        ]));
      }
      show(errorState('Could not load this series', function () { renderEpisodesAdmin(id); }, back));
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
    closeSheet();
    if ((m = /^\/series\/([^/]+)\/?$/.exec(location.pathname))) renderDetail(decodeURIComponent(m[1]));
    else if ((m = /^\/watch\/(\d+)\/?$/.exec(location.pathname))) renderWatch(m[1]);
    else if (location.pathname === '/store') renderStore();
    else if (location.pathname === '/history') renderHistory();
    else if (/^\/my-list\/?$/.test(location.pathname)) renderMyList('following');
    else if (/^\/my-list\/history\/?$/.test(location.pathname)) renderMyList('history');
    else if (/^\/admin\/?$/.test(location.pathname)) renderAdminList();
    else if (/^\/admin\/series\/new\/?$/.test(location.pathname)) renderSeriesForm(null);
    else if ((m = /^\/admin\/series\/(\d+)\/?$/.exec(location.pathname))) renderSeriesForm(m[1]);
    else if ((m = /^\/admin\/series\/(\d+)\/episodes\/?$/.exec(location.pathname))) renderEpisodesAdmin(m[1]);
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

  // Paint a skeleton the moment the app opens, before /api/me answers, so
  // loading never looks like an empty page. It only picks a shape by path;
  // route() replaces it as usual once it runs.
  function bootLoading() {
    if (/^\/series\/[^/]+\/?$/.test(location.pathname) || /^\/watch\/\d+\/?$/.test(location.pathname)) {
      show(loadingDetail(), BACK_HOME);
    } else if (/^\/my-list\/history\/?$/.test(location.pathname)) {
      show(loadingList(), BACK_HOME);
    } else if (/^\/my-list\/?$/.test(location.pathname)) {
      show(posterSkeleton(6), BACK_HOME);
    } else {
      show(loadingBrowse());
    }
  }

  // Ask who is looking first, so the buttons know whether to ask a guest to
  // make an account and onboarding knows whether it is due. The language
  // (which may come from Homeroom) is settled at the same time.
  bootLoading();
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
