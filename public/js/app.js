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
    film: [['rect', { x: 3, y: 10, width: 18, height: 10, rx: 2 }],
      ['path', { d: 'M3 10 2.4 6.6 19.1 3.7 19.7 7.1z' }],
      ['path', { d: 'M7.5 5.7 9 9' }], ['path', { d: 'M12.8 4.8 14.3 8.1' }]],
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
  // Where a request for a series is filed: this app's page on Homeroom.
  var REQUEST_URL = 'https://app.onhomeroom.com/#app/dtv-610ccb';

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
        myListLink(),
      ]));
      if (data.demo) {
        page.appendChild(h('p', 'text-small text-muted', 'Staging demo catalogue: these series are made up for testing.'));
      }
      if (!data.series.length) {
        page.appendChild(h('div', 'state-empty', [
          h('div', 'mb-2 flex h-20 w-20 items-center justify-center rounded-xl bg-accent/15 text-accent', [icon('film', 'h-10 w-10')]),
          h('h2', 'text-heading', 'No series yet'),
          h('p', 'text-body text-muted', 'New series will appear here as soon as they are added.'),
          requestLink(),
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

  /** An external link to where requests for this app are filed. Not data-nav, so the in-app click handler leaves it alone. */
  function requestLink() {
    var a = h('a', 'btn-primary mt-2', 'Request a series');
    a.href = REQUEST_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.testid = 'request-series';
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
    var body = h('div', '', [loadingList()]);
    show(h('div', 'flex flex-col gap-4', [
      navLink('/', 'inline-flex min-h-11 items-center self-start text-body font-medium text-accent', 'All series'),
      h('h1', 'text-title', 'My List'),
      tabs,
      body,
    ]));

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
        var list = h('ul', 'list');
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
        var grid = h('div', 'grid grid-cols-2 gap-4 sm:grid-cols-3');
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
