// Dtv front end: a series browse screen, a series detail screen, the watch
// screen, My List and the genre onboarding. Path routes: "/" (browse),
// "/series/<slug>" (detail), "/watch/<episodeId>" (watch), "/my-list"
// (followed series), "/my-list/history" (watch history) and, for admins, the
// series manager under "/admin". Older "#/series/<slug>" links are
// moved to the path form. Links marked data-nav navigate in place. Onboarding
// is a full-screen layer over the page, shown on "#/onboarding" and, for a
// signed-in person who has not picked genres yet, on every route until they
// do. Everything is
// built with DOM calls and textContent, so catalogue text is never parsed as
// HTML. A sticky "Dtv" header sits above every screen and holds the back
// chevron for the current screen (setHeader per route); leaving the app is
// the Homeroom frame's job, not the header's. Class names are whole literals
// so the Tailwind build can see them.
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
    back: [['path', { d: 'M15 18l-6-6 6-6' }]],
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
    return grid;
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

  function show(node, back) {
    setHeader(back || null);
    root.replaceChildren(node);
    window.scrollTo(0, 0);
  }

  // ── States ────────────────────────────────────────────────────────────
  function loadingBrowse() {
    return h('div', 'flex flex-col gap-4', [h('div', 'skeleton h-7 w-32'), posterSkeleton(12)]);
  }

  function loadingDetail() {
    return h('div', 'flex flex-col gap-4', [
      h('div', 'skeleton h-40 w-full sm:h-56'),
      h('div', 'skeleton h-8 w-2/3'),
      h('div', 'skeleton h-16 w-full'),
      h('div', 'skeleton h-11 w-full'),
      h('div', 'skeleton h-48 w-full'),
    ]);
  }

  function errorState(message, retry) {
    var retryBtn = h('button', 'btn-primary', 'Retry');
    retryBtn.type = 'button';
    retryBtn.addEventListener('click', retry);
    return h('div', 'state-error', [
      h('h2', 'text-heading', message),
      h('p', 'text-body text-muted', 'Check your connection and try again.'),
      retryBtn,
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
      page.appendChild(h('div', 'flex items-center justify-between gap-4', [
        h('h1', 'text-title', 'Series'),
        h('div', 'flex items-center gap-4', [adminLink(), myListLink()]),
      ]));
      if (data.demo) {
        page.appendChild(h('p', 'text-small text-muted', 'Staging demo catalogue: these series are made up for testing.'));
      }
      if (!data.series.length) {
        page.appendChild(h('div', 'state-empty', [
          h('h2', 'text-heading', 'No series yet'),
          h('p', 'text-body text-muted', 'New series will appear here as soon as they are added.'),
        ]));
      } else {
        var grid = h('div', POSTER_GRID);
        grid.dataset.testid = 'series-grid';
        data.series.forEach(function (s) { grid.appendChild(tile(s)); });
        page.appendChild(grid);
      }
      show(page);
    }).catch(function () {
      show(errorState('Could not load series', renderBrowse));
    });
  }

  /** "Manage series", for admins only. */
  function adminLink() {
    if (!isAdmin()) return null;
    var a = navLink('/admin', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'Manage series');
    a.dataset.testid = 'admin-link';
    return a;
  }

  function myListLink() {
    var a = navLink('/my-list', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'My List');
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
    var progress = item.completed ? 'Watched'
      : item.positionSeconds > 0 ? 'Stopped at ' + minutes(item.positionSeconds) : 'Started';
    var a = navLink('/watch/' + item.episodeId, 'list-row hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus', [
      h('span', 'flex min-w-0 flex-1 flex-col', [
        h('span', 'truncate text-body font-semibold', item.seriesTitle),
        h('span', 'truncate text-small text-muted', 'Episode ' + item.episodeNumber + ': ' + item.episodeTitle),
      ]),
      h('span', 'shrink-0 text-small text-muted', progress),
    ]);
    a.dataset.seriesSlug = item.seriesSlug;
    return h('li', '', [a]);
  }

  function renderMyList(tab) {
    var tabs = h('nav', 'flex gap-2', [
      ['following', '/my-list', 'Following'],
      ['history', '/my-list/history', 'Watch history'],
    ].map(function (t) {
      var on = t[0] === tab;
      var a = navLink(t[1], on
        ? 'inline-flex min-h-11 items-center rounded-full border border-accent bg-accent px-4 text-body font-medium text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
        : 'inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-body text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', t[2]);
      if (on) a.setAttribute('aria-current', 'page');
      a.dataset.testid = 'my-list-tab-' + t[0];
      return a;
    }));
    tabs.setAttribute('aria-label', 'My List');
    var body = h('div', '', [tab === 'history' ? loadingList() : posterSkeleton(6)]);
    show(h('div', 'flex flex-col gap-4', [
      h('h1', 'text-title', 'My List'),
      tabs,
      body,
    ]), BACK_HOME);

    function browseButton() {
      return navLink('/', 'btn-primary', 'Browse series');
    }

    if (isGuest()) {
      var join = h('button', 'btn-primary', 'Make an account');
      join.type = 'button';
      join.addEventListener('click', function () { askForAccount('keep your own list'); });
      body.replaceChildren(h('div', 'state-empty', [
        h('h2', 'text-heading', 'Your list needs an account'),
        h('p', 'text-body text-muted', 'Make an account to follow series and keep a watch history.'),
        join,
      ]));
      return;
    }

    var path = tab === 'history' ? '/api/me/watch-history' : '/api/me/follows';
    api(path).then(function (data) {
      if (tab === 'history') {
        if (!data.history.length) {
          body.replaceChildren(h('div', 'state-empty', [
            h('h2', 'text-heading', 'Nothing watched yet'),
            h('p', 'text-body text-muted', 'Episodes you play show up here, most recent first.'),
            browseButton(),
          ]));
          return;
        }
        var list = h('ul', 'list max-w-2xl');
        list.dataset.testid = 'watch-history';
        data.history.forEach(function (item) { list.appendChild(historyRow(item)); });
        body.replaceChildren(list);
      } else {
        if (!data.series.length) {
          body.replaceChildren(h('div', 'state-empty', [
            h('h2', 'text-heading', 'You are not following any series'),
            h('p', 'text-body text-muted', 'Tap Follow on a series to keep it here.'),
            browseButton(),
          ]));
          return;
        }
        var grid = h('div', POSTER_GRID);
        grid.dataset.testid = 'followed-series';
        data.series.forEach(function (s) { grid.appendChild(tile(s)); });
        body.replaceChildren(grid);
      }
    }).catch(function () {
      body.replaceChildren(errorState(
        tab === 'history' ? 'Could not load your watch history' : 'Could not load the series you follow',
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
        if (err.status === 402) ctx.notice('Not enough coins to unlock episode ' + ctx.episode.number + '.', true);
        else if (err.status !== 401) ctx.notice('Could not unlock. Try again.', true);
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
    var body = posterSkeleton(6);
    section.appendChild(body);
    function load() {
      api('/api/series/' + encodeURIComponent(slug) + '/related').then(function (data) {
        if (!data.series.length) {
          body.replaceWith(body = h('p', 'px-1 text-body text-muted', 'No other series yet.'));
          return;
        }
        var grid = h('div', POSTER_GRID);
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
    show(loadingDetail(), BACK_HOME);
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
      var synopsis = h('p', 'text-body line-clamp-3 max-w-prose', s.synopsis);
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
        var grid = h('ol', 'grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10');
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
          h('div', 'flex gap-2 sm:max-w-md', [watchBtn, followBtn, shareBtn]),
          message,
        ]),
        h('section', '', [h('h2', 'section-label', 'Episodes'), episodes]),
        relatedSection(slug),
      ]);
      show(page, BACK_HOME);
      moreBtn.hidden = synopsis.scrollHeight <= synopsis.clientHeight + 1;
    }).catch(function (err) {
      if (err.status === 404) {
        show(h('div', 'state-empty', [
          h('h2', 'text-heading', 'Series not found'),
          h('p', 'text-body text-muted', 'It may have been removed.'),
          navLink('/', 'btn-secondary', 'Browse series'),
        ]), BACK_HOME);
      } else {
        show(errorState('Could not load this series', function () { renderDetail(slug); }), BACK_HOME);
      }
    });
  }

  // ── Watch ─────────────────────────────────────────────────────────────
  // The player arrives in a later phase; this screen names the episode and
  // links back so a tap on an episode lands somewhere real.
  function renderWatch(id) {
    var fromSlug = history.state && history.state.seriesSlug;
    var back = fromSlug
      ? { path: '/series/' + encodeURIComponent(fromSlug), label: 'Back to series' }
      : BACK_HOME;
    show(loadingDetail(), back);
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
          h('p', 'text-body text-muted', 'Unlock it with coins to watch.'),
          unlockBtn,
          message,
        ]);
      } else {
        // Opening a playable episode puts it in the person's watch history.
        if (me && !isGuest()) {
          api('/api/me/watch-history/' + e.id + '/play', 'POST').catch(function () {});
        }
        body = h('div', 'state-empty', [
          h('h2', 'text-heading', 'The player is coming soon'),
          h('p', 'text-body text-muted', 'Watching episodes arrives in a later update.'),
        ]);
      }
      show(h('div', 'flex flex-col gap-6', [
        h('div', 'flex flex-col gap-1', [
          h('h1', 'text-title', 'Episode ' + e.number + ': ' + e.title),
          h('p', 'text-small text-muted', minutes(e.durationSeconds)),
        ]),
        body,
      ]), back);
    }).catch(function (err) {
      if (err.status === 404) {
        show(h('div', 'state-empty', [
          h('h2', 'text-heading', 'Episode not found'),
          h('p', 'text-body text-muted', 'It may have been removed.'),
          navLink('/', 'btn-secondary', 'Browse series'),
        ]), back);
      } else {
        show(errorState('Could not load this episode', function () { renderWatch(id); }), back);
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
    route();
  }

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-nav]');
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    navigate(a.getAttribute('href'), a.dataset.seriesSlug ? { seriesSlug: a.dataset.seriesSlug } : null);
  });

  function route() {
    var legacy = /^#\/series\/([^/]+)$/.exec(location.hash);
    if (legacy) history.replaceState(null, '', '/series/' + legacy[1] + location.search);
    var m;
    if ((m = /^\/series\/([^/]+)\/?$/.exec(location.pathname))) renderDetail(decodeURIComponent(m[1]));
    else if ((m = /^\/watch\/(\d+)\/?$/.exec(location.pathname))) renderWatch(m[1]);
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
  // make an account and onboarding knows whether it is due.
  bootLoading();
  api('/api/me').then(function (data) { me = data; }, function (err) {
    if (err.status === 401) me = 'guest';
  }).then(function () {
    window.addEventListener('popstate', route);
    route();
  });
})();
