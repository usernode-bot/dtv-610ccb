// Dtv front end: four tabs (Home, Discover, My list, Profile), the series
// detail screen, the watch screen and the genre onboarding. Path routes: "/"
// (Home), "/discover?q=&genre=", "/my-list", "/profile", "/series/<slug>" and
// "/watch/<episodeId>". Older "#/series/<slug>" links are moved to the path
// form. Links marked data-nav navigate in place. Onboarding is a full-screen
// layer over the page, shown on "#/onboarding" and, for a signed-in person who
// has not picked genres yet, on every route until they do. Everything is
// built with DOM calls and textContent, so catalogue text is never parsed as
// HTML. Class names are whole literals so the Tailwind build can see them.
//
// @typedef {{id:number, slug:string, title:string, genre:string, coverUrl:string|null,
//   coverTone:number, episodeCount:number, freeEpisodeCount:number, following:boolean}} SeriesSummary
// @typedef {SeriesSummary & {episodeNumber:number, positionSeconds:number,
//   durationSeconds:number}} ContinueWatchingItem
// @typedef {{id:number, number:number, title:string, durationSeconds:number,
//   coinPrice:number, state:'free'|'unlocked'|'locked',
//   positionSeconds?:number|null, watched?:boolean}} EpisodeItem

(function () {
  var root = document.getElementById('app');
  var coinsBadge = document.getElementById('coins-badge');
  var coinsCount = document.getElementById('coins-count');

  // Neutral placeholder cover tints (colour tokens only), indexed by coverTone.
  var TONES = ['bg-accent/15', 'bg-raised', 'bg-accent/30', 'bg-line', 'bg-accent/20'];
  var HERO_INTERVAL_MS = 5000;
  var SEARCH_DEBOUNCE_MS = 250;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // The iframe is opened with ?token=...; forward it on every API call.
  var token = new URLSearchParams(location.search).get('token');

  /** Who is looking: {signedIn, username?, coinBalance?}; null until known. */
  var viewer = null;
  var viewerReady = null;

  /** Undo work the current screen started (timers, listeners) before the next one. */
  var cleanups = [];
  /** Bumped on every navigation, so a slow load never paints over a newer screen. */
  var screenId = 0;
  /** In-app navigations so far, so "Back" only leaves the app's own history. */
  var navCount = 0;
  /** Set by the top bar's search button: focus the field when Discover opens. */
  var focusSearch = false;

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

  function button(cls, label, onClick) {
    var b = h('button', cls, label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function minutes(seconds) {
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Small stroked icons in currentColor, 24-unit grid (Lucide glyphs, ISC
  // licence, for lock/search/x). Each shape is [tag, {attr: value}].
  var ICONS = {
    lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]],
    unlock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 7.5-2' }]],
    coin: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 5 }]],
    play: [['path', { d: 'M7 5l12 7-12 7z' }]],
    check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
    share: [['path', { d: 'M12 3v12' }], ['path', { d: 'M7 8l5-5 5 5' }], ['path', { d: 'M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6' }]],
    search: [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
    x: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
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
      // Covers are 2:3; the intrinsic size stops the layout jumping as they load.
      img.width = 400;
      img.height = 600;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = s.coverUrl;
      img.alt = '';
      box.appendChild(img);
    } else {
      box.appendChild(h('span', letterCls, s.title.charAt(0)));
    }
    return box;
  }

  /** "Free" when every episode is, "3 free" when the first few are, else nothing. */
  function freeLabel(s) {
    if (!s.freeEpisodeCount) return null;
    return s.freeEpisodeCount >= s.episodeCount ? 'Free' : s.freeEpisodeCount + ' free';
  }

  /** Paint a screen, unless the viewer has moved on since `mine` began. */
  function show(mine, node) {
    if (mine !== screenId) return;
    root.replaceChildren(node);
    window.scrollTo(0, 0);
  }

  // ── Shared pieces ─────────────────────────────────────────────────────
  /**
   * The series card: a 2:3 poster with the episode count and a free tag on it,
   * then the title. `progress` (Continue watching) adds where the viewer got to.
   * @param {SeriesSummary} s
   * @param {{inRow?:boolean, progress?:ContinueWatchingItem}} [opts]
   */
  function seriesCard(s, opts) {
    opts = opts || {};
    var free = freeLabel(s);
    var p = opts.progress;
    var poster = h('div', 'relative', [
      cover(s, 'aspect-[2/3] w-full rounded-lg border border-line', 'text-title text-fg'),
      free ? h('span', 'absolute left-1.5 top-1.5 rounded bg-accent px-1.5 text-small font-medium text-on-accent', free) : null,
      h('span', 'absolute bottom-2 right-1.5 rounded bg-ground/85 px-1.5 text-small text-fg', plural(s.episodeCount, 'ep', 'eps')),
    ]);
    if (p) {
      var fill = h('div', 'h-full bg-accent');
      fill.style.width = Math.min(100, Math.round(100 * p.positionSeconds / Math.max(1, p.durationSeconds))) + '%';
      var bar = h('div', 'absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-lg bg-line', [fill]);
      bar.setAttribute('aria-hidden', 'true');
      poster.appendChild(bar);
    }
    var a = navLink('/series/' + encodeURIComponent(s.slug),
      'flex flex-col gap-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
        (opts.inRow ? 'w-28 shrink-0 snap-start' : 'w-full'),
      [
        poster,
        h('p', 'line-clamp-2 text-small font-medium', s.title),
        p ? h('p', 'text-small text-muted', 'Episode ' + p.episodeNumber) : null,
      ]);
    a.dataset.testid = 'series-card';
    return a;
  }

  /** A titled, horizontally scrolling row of cards. */
  function seriesRow(title, items, opts) {
    opts = opts || {};
    var scroller = h('div', 'scroll-row -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4');
    items.forEach(function (s) {
      scroller.appendChild(seriesCard(s, { inRow: true, progress: opts.progress ? s : null }));
    });
    var section = h('section', 'flex flex-col gap-2', [
      h('div', 'flex items-center justify-between gap-2', [
        h('h2', 'text-heading', title),
        opts.moreHref ? navLink(opts.moreHref, 'inline-flex min-h-11 items-center text-small font-medium text-accent', 'See all') : null,
      ]),
      scroller,
    ]);
    if (opts.testid) section.dataset.testid = opts.testid;
    return section;
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
    return h('div', 'state-error', [
      h('h2', 'text-heading', message),
      h('p', 'text-body text-muted', 'Check your connection and try again.'),
      button('btn-primary', 'Retry', retry),
      backLink || null,
    ]);
  }

  function skeletonCards(n, inRow) {
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(h('div', 'flex flex-col gap-1.5 ' + (inRow ? 'w-28 shrink-0' : 'w-full'), [
        h('div', 'skeleton aspect-[2/3] w-full rounded-lg'),
        h('div', 'skeleton h-4 w-3/4'),
      ]));
    }
    return out;
  }

  /** A related-series tile on the detail screen. */
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

  function skeletonGrid() {
    return h('div', 'grid grid-cols-3 gap-3 sm:grid-cols-4', skeletonCards(6, false));
  }

  /** For a guest: what the screen would hold, and the way to make an account. */
  function accountPrompt(title, body, action) {
    return h('div', 'state-empty', [
      h('h2', 'text-heading', title),
      h('p', 'text-body text-muted', body),
      button('btn-primary', 'Make an account', function () {
        if (window.usernode && window.usernode.askForAccount) window.usernode.askForAccount({ action: action });
      }),
    ]);
  }

  // ── Top bar and tabs ──────────────────────────────────────────────────
  function loadViewer() {
    viewerReady = api('/api/viewer').then(function (v) {
      viewer = v;
      if (v.signedIn) {
        coinsCount.textContent = String(v.coinBalance);
        coinsBadge.setAttribute('aria-label', plural(v.coinBalance, 'coin', 'coins'));
        coinsBadge.hidden = false;
      }
      return v;
    }).catch(function () {
      viewerReady = null; // ask again next time a screen needs it
      return { signedIn: false, unknown: true };
    });
    return viewerReady;
  }
  function getViewer() { return viewerReady || loadViewer(); }

  document.getElementById('search-button').addEventListener('click', function () { focusSearch = true; });

  function markTab(name) {
    document.querySelectorAll('[data-tab]').forEach(function (a) {
      var on = a.getAttribute('data-tab') === name;
      a.classList.toggle('text-accent', on);
      a.classList.toggle('text-muted', !on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  // ── Home ──────────────────────────────────────────────────────────────
  function loadingHome() {
    var rows = [];
    for (var i = 0; i < 3; i++) {
      rows.push(h('div', 'flex flex-col gap-2', [
        h('div', 'skeleton h-7 w-40'),
        h('div', '-mx-4 flex gap-3 overflow-hidden px-4', skeletonCards(4, true)),
      ]));
    }
    return h('div', 'flex flex-col gap-6', [h('div', 'skeleton aspect-[16/10] w-full rounded-xl')].concat(rows));
  }

  /** The featured series, one slide each: swipe, tap a dot, or let it advance. */
  function hero(items) {
    var scroller = h('div', 'scroll-row -mx-4 flex snap-x snap-mandatory overflow-x-auto');
    scroller.setAttribute('aria-live', 'off');
    var dots = h('div', 'flex justify-center');
    var current = 0;

    items.forEach(function (s, i) {
      var free = freeLabel(s);
      var slide = navLink('/series/' + encodeURIComponent(s.slug),
        'block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
          h('div', 'relative flex aspect-[16/10] w-full items-end gap-4 overflow-hidden rounded-xl border border-line bg-surface p-4', [
            cover(s, 'aspect-[2/3] w-24 shrink-0 rounded-lg border border-line', 'text-title text-fg'),
            h('div', 'flex min-w-0 flex-col items-start gap-1', [
              free ? h('span', 'rounded bg-accent px-1.5 text-small font-medium text-on-accent', free) : null,
              h('h2', 'line-clamp-2 text-title', s.title),
              h('p', 'text-small text-muted', [s.genre, plural(s.episodeCount, 'episode', 'episodes')].filter(Boolean).join(' · ')),
            ]),
          ]),
        ]);
      var wrap = h('div', 'w-full shrink-0 snap-center px-4', [slide]);
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-roledescription', 'slide');
      wrap.setAttribute('aria-label', (i + 1) + ' of ' + items.length + ': ' + s.title);
      scroller.appendChild(wrap);

      var dot = button('inline-flex min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
        h('span', 'block h-2 rounded-full'),
      ], function () { goTo(i, true); });
      dot.setAttribute('aria-label', 'Show ' + s.title);
      dots.appendChild(dot);
    });

    function paintDots() {
      [].forEach.call(dots.children, function (d, i) {
        d.firstChild.className = 'block h-2 rounded-full ' + (i === current ? 'w-5 bg-accent' : 'w-2 bg-line');
        if (i === current) d.setAttribute('aria-current', 'true');
        else d.removeAttribute('aria-current');
      });
    }

    function goTo(i, byUser) {
      current = (i + items.length) % items.length;
      scroller.scrollTo({ left: current * scroller.clientWidth, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      paintDots();
      if (byUser) pause();
    }

    scroller.addEventListener('scroll', function () {
      var i = Math.round(scroller.scrollLeft / Math.max(1, scroller.clientWidth));
      if (i !== current && i >= 0 && i < items.length) { current = i; paintDots(); }
    }, { passive: true });

    // Auto-play: advance every few seconds, hold off for a while after the
    // viewer touches it, and never while hidden or with reduced motion.
    var timer = null;
    var resumeAt = 0;
    function pause() { resumeAt = Date.now() + HERO_INTERVAL_MS * 2; }
    scroller.addEventListener('pointerdown', pause, { passive: true });
    scroller.addEventListener('touchstart', pause, { passive: true });
    scroller.addEventListener('wheel', pause, { passive: true });
    scroller.addEventListener('focusin', pause);
    var hiddenInShell = false;
    function onShellVisibility(e) { hiddenInShell = !!(e.detail && e.detail.hidden); }
    window.addEventListener('usernode:visibility-changed', onShellVisibility);
    if (items.length > 1) {
      timer = setInterval(function () {
        if (reducedMotion.matches || document.hidden || hiddenInShell || Date.now() < resumeAt) return;
        goTo(current + 1, false);
      }, HERO_INTERVAL_MS);
    }
    cleanups.push(function () {
      clearInterval(timer);
      window.removeEventListener('usernode:visibility-changed', onShellVisibility);
    });

    paintDots();
    var section = h('section', 'flex flex-col', [scroller, items.length > 1 ? dots : null]);
    section.setAttribute('aria-roledescription', 'carousel');
    section.setAttribute('aria-label', 'Featured series');
    section.dataset.testid = 'hero';
    return section;
  }

  function renderHome() {
    var mine = screenId;
    markTab('home');
    show(mine, loadingHome());
    api('/api/home').then(function (data) {
      var page = h('div', 'flex flex-col gap-6');
      page.dataset.testid = 'home';
      if (data.demo) {
        page.appendChild(h('p', 'text-small text-muted', 'Staging demo catalogue: these series are made up for testing.'));
      }
      if (!data.featured.length) {
        page.appendChild(h('div', 'state-empty', [
          h('h2', 'text-heading', 'No series yet'),
          h('p', 'text-body text-muted', 'New series will appear here as soon as they are added.'),
        ]));
        return show(mine, page);
      }
      page.appendChild(hero(data.featured));
      if (data.continueWatching && data.continueWatching.length) {
        page.appendChild(seriesRow('Continue watching', data.continueWatching, { progress: true, testid: 'row-continue' }));
      }
      page.appendChild(seriesRow('Trending now', data.trending, { moreHref: '/discover', testid: 'row-trending' }));
      page.appendChild(seriesRow('New releases', data.newReleases, { moreHref: '/discover', testid: 'row-new' }));
      data.genreRows.forEach(function (row) {
        page.appendChild(seriesRow('Top ' + row.genre.name, row.series, {
          moreHref: '/discover?genre=' + encodeURIComponent(row.genre.slug), testid: 'row-genre',
        }));
      });
      show(mine, page);
    }).catch(function () {
      show(mine, errorState('Could not load the home screen', renderHome, navLink('/discover', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'Search series instead')));
    });
  }

  // ── Discover (search) ─────────────────────────────────────────────────
  function renderDiscover(params) {
    var mine = screenId;
    markTab('discover');
    var q = params.get('q') || '';
    var genre = params.get('genre') || '';
    var seq = 0;
    var debounce = null;

    var input = h('input', 'field pl-10 pr-12');
    input.type = 'search';
    input.id = 'search-input';
    input.placeholder = 'e.g. Bakery';
    input.autocomplete = 'off';
    input.enterKeyHint = 'search';
    input.value = q;
    var clear = button('absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [icon('x', 'h-5 w-5')], function () {
      input.value = '';
      onInput();
      input.focus();
    });
    clear.setAttribute('aria-label', 'Clear search');
    var label = h('label', 'section-label block', 'Search by title');
    label.htmlFor = 'search-input';
    var field = h('div', 'relative', [
      h('span', 'pointer-events-none absolute left-3 top-0 flex h-11 items-center text-muted', [icon('search', 'h-5 w-5')]),
      input,
      clear,
    ]);

    var chips = h('div', 'scroll-row -mx-4 flex gap-2 overflow-x-auto px-4');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Genre');
    chips.dataset.testid = 'genre-chips';
    var results = h('div', 'flex flex-col gap-3', [skeletonGrid()]);
    results.setAttribute('aria-live', 'polite');

    function chip(name, slug) {
      var b = button('', name, function () {
        genre = slug;
        paintChips();
        load();
      });
      b.dataset.genre = slug;
      return b;
    }
    function paintChips() {
      [].forEach.call(chips.children, function (b) {
        var on = b.dataset.genre === genre;
        b.className = 'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-small font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
          (on ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-fg hover:bg-raised');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    chips.appendChild(chip('All', ''));
    paintChips();
    // The chips are a filter, not the screen: if they fail to load, search still works.
    api('/api/genres').then(function (data) {
      data.genres.forEach(function (g) { chips.appendChild(chip(g.name, g.slug)); });
      paintChips();
    }).catch(function () {});

    function syncUrl() {
      var p = new URLSearchParams();
      if (input.value.trim()) p.set('q', input.value.trim());
      if (genre) p.set('genre', genre);
      var s = p.toString();
      history.replaceState(null, '', withSearch('/discover' + (s ? '?' + s : '')));
    }

    function load() {
      clear.hidden = !input.value;
      syncUrl();
      var req = ++seq;
      results.replaceChildren(skeletonGrid());
      var p = new URLSearchParams();
      if (input.value.trim()) p.set('q', input.value.trim());
      if (genre) p.set('genre', genre);
      api('/api/series?' + p.toString()).then(function (data) {
        if (req !== seq) return;
        if (!data.series.length) {
          results.replaceChildren(h('div', 'state-empty', [
            h('h2', 'text-heading', 'No series match'),
            h('p', 'text-body text-muted', 'Try another title or genre.'),
            button('btn-secondary', 'Clear search and filters', function () {
              input.value = '';
              genre = '';
              paintChips();
              load();
            }),
          ]));
          return;
        }
        var grid = h('div', 'grid grid-cols-3 gap-3 sm:grid-cols-4');
        grid.dataset.testid = 'series-grid';
        data.series.forEach(function (s) { grid.appendChild(seriesCard(s)); });
        results.replaceChildren(h('p', 'text-small text-muted', plural(data.series.length, 'series', 'series')), grid);
      }).catch(function () {
        if (req !== seq) return;
        results.replaceChildren(errorState('Could not search series', load));
      });
    }

    function onInput() {
      clearTimeout(debounce);
      debounce = setTimeout(load, SEARCH_DEBOUNCE_MS);
    }
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(debounce); load(); input.blur(); }
    });
    cleanups.push(function () { clearTimeout(debounce); seq++; });

    show(mine, h('div', 'flex flex-col gap-4', [
      h('h1', 'text-title', 'Discover'),
      h('div', '', [label, field]),
      chips,
      results,
    ]));
    if (focusSearch) { focusSearch = false; input.focus({ preventScroll: true }); }
    load();
  }

  // ── My list ───────────────────────────────────────────────────────────
  function renderMyList() {
    var mine = screenId;
    markTab('my-list');
    var title = h('h1', 'text-title', 'My list');
    show(mine, h('div', 'flex flex-col gap-4', [title, skeletonGrid()]));
    getViewer().then(function (v) {
      if (!v.signedIn && !v.unknown) {
        return show(mine, h('div', 'flex flex-col gap-4', [title,
          accountPrompt('Keep a list of series', 'Make an account to follow series and find them here.', 'keep a list')]));
      }
      return api('/api/me/follows').then(function (data) {
        if (!data.series.length) {
          return show(mine, h('div', 'flex flex-col gap-4', [title, h('div', 'state-empty', [
            h('h2', 'text-heading', 'Your list is empty'),
            h('p', 'text-body text-muted', 'Follow a series and it will be kept here.'),
            navLink('/discover', 'btn-primary', 'Discover series'),
          ])]));
        }
        var grid = h('div', 'grid grid-cols-3 gap-3 sm:grid-cols-4');
        grid.dataset.testid = 'my-list';
        data.series.forEach(function (s) { grid.appendChild(seriesCard(s)); });
        show(mine, h('div', 'flex flex-col gap-4', [title, grid]));
      });
    }).catch(function () {
      show(mine, h('div', 'flex flex-col gap-4', [title, errorState('Could not load your list', renderMyList)]));
    });
  }

  // ── Profile ───────────────────────────────────────────────────────────
  function renderProfile() {
    var mine = screenId;
    markTab('profile');
    show(mine, h('div', 'flex flex-col gap-4', [h('div', 'skeleton h-9 w-40'), h('div', 'skeleton h-24 w-full')]));
    getViewer().then(function (v) {
      if (!v.signedIn && !v.unknown) {
        return show(mine, h('div', 'flex flex-col gap-4', [h('h1', 'text-title', 'Profile'),
          accountPrompt('Your profile', 'Make an account to keep coins, follows and what you have watched.', 'see your profile')]));
      }
      return Promise.all([api('/api/me'), api('/api/me/watch-history')]).then(function (r) {
        var profile = r[0].profile;
        var history = r[1].history.slice(0, 20);
        var watched = history.length
          ? (function () {
              var ul = h('ul', 'list');
              history.forEach(function (w) {
                ul.appendChild(h('li', '', [navLink('/series/' + encodeURIComponent(w.seriesSlug),
                  'list-row hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus', [
                    h('div', 'min-w-0 flex-1', [
                      h('p', 'truncate text-body', w.seriesTitle),
                      h('p', 'text-small text-muted', 'Episode ' + w.episodeNumber + (w.completed ? ' · Watched' : '')),
                    ]),
                  ])]));
              });
              return ul;
            })()
          : h('div', 'state-empty', [
              h('h3', 'text-heading', 'Nothing watched yet'),
              h('p', 'text-body text-muted', 'Series you start watching show up here.'),
              navLink('/', 'btn-secondary', 'Go to Home'),
            ]);
        show(mine, h('div', 'flex flex-col gap-6', [
          h('h1', 'text-title', profile.username),
          h('section', '', [
            h('h2', 'section-label', 'Wallet'),
            h('ul', 'list', [h('li', 'list-row justify-between', [
              h('span', 'text-body', 'Coins'),
              h('span', 'text-body font-semibold', String(profile.coinBalance)),
            ])]),
          ]),
          h('section', '', [h('h2', 'section-label', 'Recently watched'), watched]),
        ]));
      });
    }).catch(function () {
      show(mine, errorState('Could not load your profile', renderProfile));
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
    var mine = screenId;
    markTab(null);
    show(mine, loadingDetail());
    var back = navLink('/', 'inline-flex min-h-11 items-center self-start text-body font-medium text-accent', 'Back');
    back.addEventListener('click', function (e) {
      if (navCount > 0) { e.preventDefault(); history.back(); }
    });
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
      show(mine, page);
      moreBtn.hidden = synopsis.scrollHeight <= synopsis.clientHeight + 1;
    }).catch(function (err) {
      if (err.status === 404) {
        show(mine, h('div', 'state-empty', [
          h('h2', 'text-heading', 'Series not found'),
          h('p', 'text-body text-muted', 'It may have been removed.'),
          back,
        ]));
      } else {
        show(mine, errorState('Could not load this series', function () { renderDetail(slug); }, back));
      }
    });
  }

  // ── Watch ─────────────────────────────────────────────────────────────
  // The player arrives in a later phase; this screen names the episode and
  // links back so a tap on an episode lands somewhere real.
  function renderWatch(id) {
    var mine = screenId;
    markTab(null);
    show(mine, loadingDetail());
    var fromSlug = history.state && history.state.seriesSlug;
    var back = fromSlug
      ? navLink('/series/' + encodeURIComponent(fromSlug), 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'Back to series')
      : navLink('/', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'Back to Home');
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
        body = h('div', 'state-empty', [
          h('h2', 'text-heading', 'The player is coming soon'),
          h('p', 'text-body text-muted', 'Watching episodes arrives in a later update.'),
        ]);
      }
      show(mine, h('div', 'flex flex-col gap-6', [
        back,
        h('div', 'flex flex-col gap-1', [
          h('h1', 'text-title', 'Episode ' + e.number + ': ' + e.title),
          h('p', 'text-small text-muted', minutes(e.durationSeconds)),
        ]),
        body,
      ]));
    }).catch(function (err) {
      if (err.status === 404) {
        show(mine, h('div', 'state-empty', [
          h('h2', 'text-heading', 'Episode not found'),
          h('p', 'text-body text-muted', 'It may have been removed.'),
          back,
        ]));
      } else {
        show(mine, errorState('Could not load this episode', function () { renderWatch(id); }, back));
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
  // The rest of the query string (the platform's ?token=, ?un-theme=, ...) is
  // kept on every in-app navigation so a reload still works; q and genre
  // belong to Discover alone.
  function withSearch(path) {
    var qi = path.indexOf('?');
    var params = new URLSearchParams(qi === -1 ? '' : path.slice(qi + 1));
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (k !== 'q' && k !== 'genre' && !params.has(k)) params.set(k, v);
    });
    var qs = params.toString();
    return (qi === -1 ? path : path.slice(0, qi)) + (qs ? '?' + qs : '');
  }

  function navigate(path, state) {
    navCount++;
    history.pushState(state || null, '', withSearch(path));
    route();
  }

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-nav]');
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    navigate(a.getAttribute('href'));
  });

  function route() {
    screenId++;
    cleanups.splice(0).forEach(function (fn) { fn(); });
    var legacy = /^#\/series\/([^/]+)$/.exec(location.hash);
    if (legacy) history.replaceState(null, '', '/series/' + legacy[1] + location.search);
    var m;
    if ((m = /^\/series\/([^/]+)\/?$/.exec(location.pathname))) renderDetail(decodeURIComponent(m[1]));
    else if ((m = /^\/watch\/(\d+)\/?$/.exec(location.pathname))) renderWatch(m[1]);
    else if (/^\/discover\/?$/.test(location.pathname)) renderDiscover(new URLSearchParams(location.search));
    else if (/^\/my-list\/?$/.test(location.pathname)) renderMyList();
    else if (/^\/profile\/?$/.test(location.pathname)) renderProfile();
    else renderHome();
    if (location.hash === '#/onboarding' || onboardingDue()) openOnboarding();
    else closeOnboarding();
  }
  // Ask who is looking first, so the buttons know whether to ask a guest to
  // make an account and onboarding knows whether it is due.
  loadViewer();
  api('/api/me').then(function (data) { me = data; }, function (err) {
    if (err.status === 401) me = 'guest';
  }).then(function () {
    window.addEventListener('popstate', function () { navCount++; route(); });
    route();
  });
})();

