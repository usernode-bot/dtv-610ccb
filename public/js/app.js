// Dtv front end: four tabs (Home, Discover, My list, Profile) and the series
// detail screen. Hash routes: "#/", "#/discover?q=&genre=", "#/my-list",
// "#/profile" and "#/series/<slug>". Everything is built with DOM calls and
// textContent, so catalogue text is never parsed as HTML. Class names are
// whole literals so the Tailwind build can see them.
//
// @typedef {{id:number, slug:string, title:string, genre:string, coverUrl:string|null,
//   coverTone:number, episodeCount:number, freeEpisodeCount:number, following:boolean}} SeriesSummary
// @typedef {SeriesSummary & {episodeNumber:number, positionSeconds:number,
//   durationSeconds:number}} ContinueWatchingItem
// @typedef {{id:number, number:number, title:string, durationSeconds:number,
//   coinPrice:number, state:'free'|'unlocked'|'locked'}} EpisodeItem

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

  /** @returns {Promise<any>} parsed JSON; rejects with an Error carrying .status */
  function api(path, method) {
    var headers = {};
    if (token) headers['x-usernode-token'] = token;
    if (window.usernode && window.usernode.previewNow && window.usernode.now) {
      headers['x-usernode-now'] = window.usernode.now().toISOString();
    }
    return fetch(path, { method: method || 'GET', headers: headers }).then(function (res) {
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

  function link(href, cls, children) {
    var a = h('a', cls, children);
    a.href = href;
    return a;
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

  // Lucide glyphs (ISC licence), drawn in currentColor.
  var ICONS = {
    lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]],
    search: [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
    x: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
  };

  function icon(name, cls) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    var attrs = { viewBox: '0 0 24 24', class: cls, fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
    Object.keys(attrs).forEach(function (k) { svg.setAttribute(k, attrs[k]); });
    ICONS[name].forEach(function (part) {
      var el = document.createElementNS(NS, part[0]);
      Object.keys(part[1]).forEach(function (k) { el.setAttribute(k, part[1][k]); });
      svg.appendChild(el);
    });
    return svg;
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
    var a = link('#/series/' + encodeURIComponent(s.slug),
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
        opts.moreHref ? link(opts.moreHref, 'inline-flex min-h-11 items-center text-small font-medium text-accent', 'See all') : null,
      ]),
      scroller,
    ]);
    if (opts.testid) section.dataset.testid = opts.testid;
    return section;
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
      var slide = link('#/series/' + encodeURIComponent(s.slug),
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
      page.appendChild(seriesRow('Trending now', data.trending, { moreHref: '#/discover', testid: 'row-trending' }));
      page.appendChild(seriesRow('New releases', data.newReleases, { moreHref: '#/discover', testid: 'row-new' }));
      data.genreRows.forEach(function (row) {
        page.appendChild(seriesRow('Top ' + row.genre.name, row.series, {
          moreHref: '#/discover?genre=' + encodeURIComponent(row.genre.slug), testid: 'row-genre',
        }));
      });
      show(mine, page);
    }).catch(function () {
      show(mine, errorState('Could not load the home screen', renderHome, link('#/discover', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'Search series instead')));
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
      history.replaceState(null, '', '#/discover' + (s ? '?' + s : ''));
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
            link('#/discover', 'btn-primary', 'Discover series'),
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
                ul.appendChild(h('li', '', [link('#/series/' + encodeURIComponent(w.seriesSlug),
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
              link('#/', 'btn-secondary', 'Go to Home'),
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

  // ── Detail ────────────────────────────────────────────────────────────
  function episodeRow(/** @type {EpisodeItem} */ e) {
    var status;
    if (e.state === 'locked') {
      status = h('span', 'inline-flex items-center gap-1 text-small text-muted', [icon('lock', 'h-4 w-4'), plural(e.coinPrice, 'coin', 'coins')]);
    } else {
      status = h('span', 'text-small font-medium ' + (e.state === 'free' ? 'text-accent' : 'text-muted'), e.state === 'free' ? 'Free' : 'Unlocked');
    }
    var row = h('li', 'list-row', [
      h('span', 'w-6 shrink-0 text-small text-muted', String(e.number)),
      h('div', 'min-w-0 flex-1', [
        h('p', 'truncate text-body', e.title),
        h('p', 'text-small text-muted', minutes(e.durationSeconds)),
      ]),
      status,
    ]);
    row.dataset.state = e.state;
    return row;
  }

  function renderDetail(slug) {
    var mine = screenId;
    markTab(null);
    show(mine, h('div', 'flex flex-col gap-4', [
      h('div', 'skeleton h-5 w-24'),
      h('div', 'skeleton h-8 w-2/3'),
      h('div', 'skeleton h-20 w-full'),
      h('div', 'skeleton h-48 w-full'),
    ]));
    var back = link('#/', 'inline-flex min-h-11 items-center self-start text-body font-medium text-accent', 'Back');
    back.addEventListener('click', function (e) {
      if (navCount > 0) { e.preventDefault(); history.back(); }
    });
    api('/api/series/' + encodeURIComponent(slug)).then(function (data) {
      /** @type {SeriesSummary & {synopsis:string, episodes:EpisodeItem[]}} */
      var s = data.series;
      var following = s.following;
      var followBtn = button('', '');
      var message = h('p', 'text-small text-danger');
      message.setAttribute('role', 'alert');

      function paintFollow() {
        followBtn.className = following ? 'btn-secondary' : 'btn-primary';
        followBtn.textContent = following ? 'Following' : 'Follow';
        followBtn.setAttribute('aria-pressed', following ? 'true' : 'false');
      }
      paintFollow();
      followBtn.addEventListener('click', function () {
        followBtn.disabled = true;
        message.textContent = '';
        api('/api/series/' + encodeURIComponent(slug) + '/follow', following ? 'DELETE' : 'PUT')
          .then(function (r) { following = r.following; })
          .catch(function (err) {
            // A guest gets "account_required"; the platform bridge shows its own sign-up sheet.
            if (err.status !== 401) message.textContent = 'Could not update. Try again.';
          })
          .then(function () { followBtn.disabled = false; paintFollow(); });
      });

      var free = s.episodes.filter(function (e) { return e.state !== 'locked'; }).length;
      var page = h('div', 'flex flex-col gap-6', [
        back,
        h('div', 'flex gap-4', [
          cover(s, 'aspect-[2/3] w-28 shrink-0 rounded-xl border border-line', 'text-title text-fg'),
          h('div', 'flex min-w-0 flex-1 flex-col items-start gap-2', [
            h('h1', 'text-title', s.title),
            h('p', 'text-small text-muted', [s.genre, plural(s.episodes.length, 'episode', 'episodes')].filter(Boolean).join(' · ')),
            followBtn,
          ]),
        ]),
        message,
        h('p', 'text-body', s.synopsis),
        h('section', '', [
          h('h2', 'section-label', 'Episodes (' + free + ' of ' + s.episodes.length + ' ready to watch)'),
          s.episodes.length
            ? (function () {
                var ul = h('ul', 'list');
                ul.dataset.testid = 'episode-list';
                s.episodes.forEach(function (e) { ul.appendChild(episodeRow(e)); });
                return ul;
              })()
            : h('div', 'state-empty', [
                h('h3', 'text-heading', 'No episodes yet'),
                h('p', 'text-body text-muted', 'Episodes will show up here once they are added.'),
              ]),
        ]),
      ]);
      show(mine, page);
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

  // ── Routing ───────────────────────────────────────────────────────────
  function route() {
    var hash = location.hash.replace(/^#/, '') || '/';
    var qi = hash.indexOf('?');
    var path = qi === -1 ? hash : hash.slice(0, qi);
    var params = new URLSearchParams(qi === -1 ? '' : hash.slice(qi + 1));
    var m = /^\/series\/([^/]+)$/.exec(path);
    if (m) renderDetail(decodeURIComponent(m[1]));
    else if (path === '/discover') renderDiscover(params);
    else if (path === '/my-list') renderMyList();
    else if (path === '/profile') renderProfile();
    else renderHome();
  }
  window.addEventListener('hashchange', function () {
    navCount++;
    screenId++;
    cleanups.splice(0).forEach(function (fn) { fn(); });
    route();
  });
  loadViewer();
  route();
})();
