// Dtv front end: a series browse screen (featured, shelves, filters and a
// poster grid; filters live in ?country=&format=&genre=&q=), a series detail screen, the watch
// screen, My List and the genre onboarding. Path routes: "/" (browse),
// "/series/<slug>" (detail), "/watch/<episodeId>" (watch, with the player), "/my-list"
// (followed series) and "/my-list/history" (watch history). Older "#/series/<slug>" links are
// moved to the path form. Links marked data-nav navigate in place. Onboarding
// is a full-screen layer over the page, shown on "#/onboarding" and, for a
// signed-in person who has not picked genres yet, on every route until they
// do. Everything is
// built with DOM calls and textContent, so catalogue text is never parsed as
// HTML. Class names are whole literals so the Tailwind build can see them.
//
// @typedef {{id:number, slug:string, title:string, synopsis:string, genre:string, genreSlug:string|null,
//   originalTitle:string, country:string|null, format:'long'|'short', rating:number|null,
//   isFeatured:boolean, releasedOn:string|null, viewCount:number, coverUrl:string|null,
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
    bookmark: [['path', { d: 'M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }]],
    star: [['path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z' }]],
    search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'M21 21l-4.3-4.3' }]],
  };

  /** filled: paint the shape in currentColor too (a saved bookmark, a rating star). */
  function icon(name, cls, filled) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls || 'h-4 w-4');
    svg.setAttribute('fill', filled ? 'currentColor' : 'none');
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

  // Stops whatever the watch screen is playing; set while a player is on screen.
  var stopPlayer = null;

  /** Put a screen on the page. wide: browse's poster grid gets the full width. */
  function show(node, wide) {
    if (stopPlayer) { stopPlayer(); stopPlayer = null; }
    root.className = wide ? 'mx-auto max-w-6xl px-4 py-6' : 'mx-auto max-w-2xl px-4 py-6';
    root.replaceChildren(node);
    window.scrollTo(0, 0);
  }

  // ── States ────────────────────────────────────────────────────────────
  function skeletonCard(cls) {
    return h('div', 'flex flex-col gap-2 ' + (cls || ''), [
      h('div', 'skeleton aspect-[2/3] w-full rounded-xl'),
      h('div', 'skeleton h-5 w-3/4'),
      h('div', 'skeleton h-4 w-1/2'),
    ]);
  }

  function loadingBrowse() {
    var chips = h('div', 'flex gap-2', [0, 1, 2].map(function () { return h('div', 'skeleton h-11 w-24 rounded-full'); }));
    var row = h('div', 'flex gap-3 overflow-hidden');
    for (var i = 0; i < 6; i++) row.appendChild(skeletonCard('w-32 shrink-0 sm:w-36 lg:w-40'));
    var grid = h('div', 'grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6');
    for (var j = 0; j < 6; j++) grid.appendChild(skeletonCard());
    var page = h('div', 'flex flex-col gap-6', [
      h('div', 'flex items-center justify-between gap-4', [h('div', 'skeleton h-9 w-32'), h('div', 'skeleton h-11 w-36')]),
      h('div', 'flex flex-col gap-3', [h('div', 'skeleton h-11 w-full'), chips]),
      h('div', 'skeleton h-48 w-full rounded-xl'),
      h('div', 'flex flex-col gap-2', [h('div', 'skeleton h-7 w-40'), row]),
      grid,
    ]);
    page.dataset.testid = 'browse-loading';
    page.setAttribute('aria-busy', 'true');
    return page;
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

  // ── Series cards ──────────────────────────────────────────────────────
  // Short dramas are vertical (9:16 posters), long dramas 2:3.
  var COUNTRY_NAME = { CN: 'China', KR: 'South Korea' };

  /** A small flag in the country's own colours, for CN and KR; null for any other. */
  function flag(code) {
    var NS = 'http://www.w3.org/2000/svg';
    function el(tag, attrs, parent) {
      var e = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
      parent.appendChild(e);
      return e;
    }
    function star(cx, cy, r, rot) {
      var pts = [];
      for (var i = 0; i < 10; i++) {
        var a = rot + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r;
        pts.push((cx + rr * Math.sin(a)).toFixed(2) + ',' + (cy - rr * Math.cos(a)).toFixed(2));
      }
      return pts.join(' ');
    }
    if (code !== 'CN' && code !== 'KR') return null;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 30 20');
    svg.setAttribute('class', 'h-3.5 w-5 shrink-0 rounded-sm');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', COUNTRY_NAME[code]);
    if (code === 'CN') {
      el('rect', { width: 30, height: 20, fill: '#EE1C25' }, svg);
      el('polygon', { points: star(5, 5, 3, 0), fill: '#FFDE00' }, svg);
      [[10, 2], [12, 4], [12, 7], [10, 9]].forEach(function (p) {
        el('polygon', { points: star(p[0], p[1], 1, 0.6), fill: '#FFDE00' }, svg);
      });
    } else {
      el('rect', { width: 30, height: 20, fill: '#FFFFFF' }, svg);
      el('path', { d: 'M10 10a5 5 0 0 1 10 0z', fill: '#CD2E3A' }, svg);
      el('path', { d: 'M10 10a5 5 0 0 0 10 0z', fill: '#0047A0' }, svg);
      [[6, 4.5, -34], [24, 4.5, 34], [6, 15.5, 34], [24, 15.5, -34]].forEach(function (p) {
        el('rect', { x: p[0] - 2, y: p[1] - 1.3, width: 4, height: 2.6, fill: '#000000', transform: 'rotate(' + p[2] + ' ' + p[0] + ' ' + p[1] + ')' }, svg);
      });
      el('rect', { x: 0.5, y: 0.5, width: 29, height: 19, fill: 'none', stroke: '#000000', 'stroke-opacity': 0.15 }, svg);
    }
    return svg;
  }

  function rating(s, cls) {
    if (s.rating == null) return null;
    var r = h('span', 'inline-flex items-center gap-1 ' + cls, [icon('star', 'h-3 w-3', true), s.rating.toFixed(1)]);
    r.setAttribute('aria-label', 'Rated ' + s.rating.toFixed(1) + ' out of 10');
    return r;
  }

  // My List is the series a person follows: the bookmark on a card and the
  // Follow button on the detail screen are the same switch.
  var myListCount = null;

  function paintBookmarks(s) {
    document.querySelectorAll('[data-bookmark]').forEach(function (b) {
      if (b.dataset.bookmark !== s.slug) return;
      b.setAttribute('aria-pressed', s.following ? 'true' : 'false');
      b.setAttribute('aria-label', (s.following ? 'Remove ' + s.title + ' from' : 'Add ' + s.title + ' to') + ' My List');
      b.title = s.following ? 'Remove from My List' : 'Add to My List';
      b.firstChild.replaceChildren(icon('bookmark', 'h-4 w-4', s.following));
    });
  }

  function paintMyListCount() {
    document.querySelectorAll('[data-testid=my-list-count]').forEach(function (el) {
      el.textContent = 'My List (' + (myListCount || 0) + ')';
    });
  }

  /** Optimistic, like Follow: flip at once, put it back if the server says no. */
  function toggleBookmark(s) {
    if (isGuest()) return askForAccount('save series to My List');
    var want = !s.following;
    var call = s.bookmarkCall = (s.bookmarkCall || 0) + 1;
    s.following = want;
    myListCount = (myListCount || 0) + (want ? 1 : -1);
    paintBookmarks(s);
    paintMyListCount();
    api('/api/series/' + encodeURIComponent(s.slug) + '/follow', want ? 'PUT' : 'DELETE').catch(function (err) {
      if (call !== s.bookmarkCall) return; // a later tap decides the state
      s.following = !want;
      myListCount += want ? -1 : 1;
      paintBookmarks(s);
      paintMyListCount();
      // A guest gets "account_required"; the platform bridge shows its own sign-up sheet.
      if (err.status !== 401) toast('Could not update My List. Try again.');
    });
  }

  /** A short status line at the bottom of the screen. */
  function toast(text) {
    var t = h('p', 'fixed inset-x-4 bottom-4 z-40 mx-auto max-w-sm rounded-lg bg-fg px-4 py-3 text-center text-small text-ground', text);
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }

  /** A poster card: poster with format and rating, title, flag and episode count, and a bookmark. */
  function seriesCard(/** @type {SeriesSummary} */ s, cls) {
    var short = s.format === 'short';
    var poster = cover(s, (short ? 'aspect-[9/16]' : 'aspect-[2/3]') + ' w-full rounded-xl border border-line', 'text-title text-fg');
    poster.classList.add('relative');
    var badge = h('span', 'absolute left-2 top-2 rounded-md bg-ground/90 px-2 text-small font-medium text-fg', short ? 'Short' : 'Long');
    badge.dataset.testid = 'format-badge';
    poster.appendChild(badge);
    var r = rating(s, 'absolute bottom-2 left-2 rounded-md bg-ground/90 px-2 text-small font-medium text-fg');
    if (r) poster.appendChild(r);

    var link = navLink('/series/' + encodeURIComponent(s.slug), 'flex flex-col gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
      poster,
      h('div', 'flex flex-col', [
        h('h3', 'line-clamp-2 text-body font-semibold', s.title),
        h('p', 'flex items-center gap-1 text-small text-muted', [
          flag(s.country),
          plural(s.episodeCount, 'episode', 'episodes'),
        ]),
      ]),
    ]);
    link.dataset.testid = 'series-tile';
    link.dataset.format = s.format;

    var mark = h('button', 'absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
      h('span', 'flex h-8 w-8 items-center justify-center rounded-full bg-ground/90'),
    ]);
    mark.type = 'button';
    mark.dataset.bookmark = s.slug;
    mark.dataset.testid = 'bookmark-button';
    mark.addEventListener('click', function () { toggleBookmark(s); });

    var card = h('div', 'relative ' + (cls || ''), [link, mark]);
    // Paint the bookmark once the card is on the page (paintBookmarks finds it there).
    mark.setAttribute('aria-pressed', s.following ? 'true' : 'false');
    mark.setAttribute('aria-label', (s.following ? 'Remove ' + s.title + ' from' : 'Add ' + s.title + ' to') + ' My List');
    mark.title = s.following ? 'Remove from My List' : 'Add to My List';
    mark.firstChild.appendChild(icon('bookmark', 'h-4 w-4', s.following));
    return card;
  }

  function seriesGrid(list, testid) {
    var grid = h('div', 'grid grid-cols-2 items-start gap-4 md:grid-cols-4 lg:grid-cols-6');
    grid.dataset.testid = testid;
    list.forEach(function (s) { grid.appendChild(seriesCard(s)); });
    return grid;
  }

  // ── Browse ────────────────────────────────────────────────────────────
  // Filters live in the address (?country=cn&format=short&genre=comedy&q=tea),
  // next to the platform's own parameters, so Back and reloads keep them.
  var COUNTRIES = [['', 'All'], ['cn', 'Chinese'], ['kr', 'Korean']];
  var FORMATS = [['', 'All formats'], ['long', 'Long drama'], ['short', 'Short drama']];

  function readFilters() {
    var q = new URLSearchParams(location.search);
    function pick(v, list) { return list.some(function (o) { return o[0] === v; }) ? v : ''; }
    return {
      country: pick(q.get('country') || '', COUNTRIES),
      format: pick(q.get('format') || '', FORMATS),
      genre: q.get('genre') || '',
      q: q.get('q') || '',
    };
  }

  function writeFilters(f) {
    var q = new URLSearchParams(location.search);
    ['country', 'format', 'genre', 'q'].forEach(function (k) {
      if (f[k]) q.set(k, f[k]); else q.delete(k);
    });
    var qs = q.toString();
    history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  function filtering(f) { return !!(f.country || f.format || f.genre || f.q.trim()); }

  function matches(s, f) {
    if (f.country && (s.country || '').toLowerCase() !== f.country) return false;
    if (f.format && s.format !== f.format) return false;
    if (f.genre && s.genreSlug !== f.genre) return false;
    var q = f.q.trim().toLowerCase();
    if (q && s.title.toLowerCase().indexOf(q) < 0 && (s.originalTitle || '').toLowerCase().indexOf(q) < 0) return false;
    return true;
  }

  function chipRow(label, options, current, onPick) {
    var row = h('div', 'flex gap-2 overflow-x-auto pb-1');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    var chips = options.map(function (o) {
      var chip = h('button', '', o[1]);
      chip.type = 'button';
      chip.dataset.value = o[0];
      chip.addEventListener('click', function () { onPick(o[0]); });
      row.appendChild(chip);
      return chip;
    });
    row.paint = function (value) {
      chips.forEach(function (chip) {
        var on = chip.dataset.value === value;
        chip.className = on
          ? 'inline-flex min-h-11 shrink-0 items-center rounded-full border border-accent bg-accent px-4 text-body font-medium text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
          : 'inline-flex min-h-11 shrink-0 items-center rounded-full border border-line bg-surface px-4 text-body text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    row.paint(current);
    return row;
  }

  /** The featured banners: series marked is_featured, side by side, swipeable. */
  function featuredHero(list) {
    var strip = h('div', 'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1');
    list.forEach(function (s) {
      var short = s.format === 'short';
      var a = navLink('/series/' + encodeURIComponent(s.slug),
        (list.length > 1 ? 'w-11/12 md:w-2/3 lg:w-1/2 ' : 'w-full ') +
        'flex shrink-0 snap-start items-center gap-4 rounded-xl border border-line p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
        (TONES[s.coverTone % TONES.length] || TONES[0]), [
        cover(s, (short ? 'aspect-[9/16]' : 'aspect-[2/3]') + ' w-24 shrink-0 rounded-lg border border-line bg-surface sm:w-32', 'text-title text-fg'),
        h('div', 'flex min-w-0 flex-col gap-1', [
          h('p', 'text-small font-medium text-fg', 'Featured'),
          h('h3', 'text-heading', s.title),
          s.originalTitle ? h('p', 'text-small text-fg', s.originalTitle) : null,
          h('p', 'flex flex-wrap items-center gap-2 text-small text-fg', [
            flag(s.country),
            short ? 'Short drama' : 'Long drama',
            rating(s, 'text-fg'),
          ]),
          h('p', 'line-clamp-2 text-small text-fg', s.synopsis || ''),
        ]),
      ]);
      a.dataset.testid = 'featured-item';
      strip.appendChild(a);
    });
    var section = h('section', '', [strip]);
    section.setAttribute('aria-label', 'Featured');
    section.dataset.testid = 'featured-hero';
    return section;
  }

  /** A titled, sideways-scrolling row of cards; null when it has nothing to show. */
  function shelf(title, testid, list) {
    if (!list.length) return null;
    var row = h('div', 'flex snap-x gap-3 overflow-x-auto pb-2');
    list.forEach(function (s) { row.appendChild(seriesCard(s, 'w-32 shrink-0 snap-start sm:w-36 lg:w-40')); });
    var section = h('section', 'flex flex-col gap-2', [h('h2', 'text-heading', title), row]);
    section.dataset.testid = testid;
    return section;
  }

  function byDateDesc(a, b) { return (b.releasedOn || '').localeCompare(a.releasedOn || ''); }

  function renderBrowse() {
    show(loadingBrowse(), true);
    Promise.all([
      api('/api/series'),
      api('/api/genres').catch(function () { return { genres: [] }; }),
    ]).then(function (res) {
      var data = res[0];
      var all = data.series;
      var f = readFilters();
      myListCount = all.filter(function (s) { return s.following; }).length;

      var page = h('div', 'flex flex-col gap-6');
      page.appendChild(h('div', 'flex items-center justify-between gap-4', [
        h('h1', 'text-title', 'Series'),
        myListButton(),
      ]));
      if (data.demo) {
        page.appendChild(h('p', 'text-small text-muted', 'Staging demo catalogue: these series are made up for testing.'));
      }
      if (!all.length) {
        page.appendChild(h('div', 'state-empty', [
          h('h2', 'text-heading', 'No series yet'),
          h('p', 'text-body text-muted', 'New series will appear here as soon as they are added.'),
        ]));
        show(page, true);
        return;
      }

      // Search and genre.
      var search = h('input', 'field pl-10');
      search.type = 'search';
      search.id = 'series-search';
      search.placeholder = 'Title or original title, e.g. Tea House';
      search.value = f.q;
      search.autocomplete = 'off';
      search.dataset.testid = 'series-search';
      var searchLabel = h('label', 'sr-only', 'Search series');
      searchLabel.htmlFor = search.id;
      var genre = h('select', 'field');
      genre.id = 'series-genre';
      genre.dataset.testid = 'genre-filter';
      genre.appendChild(new Option('All genres', ''));
      res[1].genres.forEach(function (g) { genre.appendChild(new Option(g.name, g.slug)); });
      genre.value = f.genre;
      if (genre.value !== f.genre) f.genre = ''; // an unknown genre in the address
      var genreLabel = h('label', 'sr-only', 'Genre');
      genreLabel.htmlFor = genre.id;

      var countryRow = chipRow('Country', COUNTRIES, f.country, function (v) { f.country = v; update(); });
      var formatRow = chipRow('Format', FORMATS, f.format, function (v) { f.format = v; update(); });
      countryRow.dataset.testid = 'country-filter';
      formatRow.dataset.testid = 'format-filter';

      page.appendChild(h('div', 'flex flex-col gap-3', [
        h('div', 'flex flex-col gap-3 sm:flex-row', [
          h('div', 'relative flex-1', [
            searchLabel,
            h('span', 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted', [icon('search', 'h-5 w-5')]),
            search,
          ]),
          h('div', 'sm:w-56', [genreLabel, genre]),
        ]),
        countryRow,
        formatRow,
      ]));

      var content = h('div', 'flex flex-col gap-8');
      page.appendChild(content);

      function clearFilters() {
        f = { country: '', format: '', genre: '', q: '' };
        search.value = '';
        genre.value = '';
        update();
      }

      function update() {
        writeFilters(f);
        countryRow.paint(f.country);
        formatRow.paint(f.format);
        paintContent();
      }

      function paintContent() {
        if (filtering(f)) {
          var found = all.filter(function (s) { return matches(s, f); });
          var count = h('p', 'text-small text-muted', plural(found.length, 'series', 'series') + ' found');
          count.setAttribute('role', 'status');
          if (!found.length) {
            var clear = h('button', 'btn-primary', 'Clear filters');
            clear.type = 'button';
            clear.dataset.testid = 'clear-filters';
            clear.addEventListener('click', clearFilters);
            var empty = h('div', 'state-empty', [
              h('h2', 'text-heading', 'No series match'),
              h('p', 'text-body text-muted', 'Try another search, or clear the filters to see every series.'),
              clear,
            ]);
            empty.dataset.testid = 'no-results';
            content.replaceChildren(count, empty);
          } else {
            content.replaceChildren(count, seriesGrid(found, 'series-grid'));
          }
          return;
        }
        var featured = all.filter(function (s) { return s.isFeatured; });
        content.replaceChildren.apply(content, [
          featured.length ? featuredHero(featured) : null,
          shelf('New releases', 'row-new', all.slice().sort(byDateDesc).slice(0, 10)),
          shelf('Trending', 'row-trending', all.slice().sort(function (a, b) { return b.viewCount - a.viewCount; }).slice(0, 10)),
          shelf('Chinese short dramas', 'row-cn-short', all.filter(function (s) { return s.country === 'CN' && s.format === 'short'; })),
          shelf('Korean long dramas', 'row-kr-long', all.filter(function (s) { return s.country === 'KR' && s.format === 'long'; })),
          h('section', 'flex flex-col gap-2', [h('h2', 'text-heading', 'All series'), seriesGrid(all, 'series-grid')]),
        ].filter(Boolean));
      }

      search.addEventListener('input', function () { f.q = search.value; update(); });
      genre.addEventListener('change', function () { f.genre = genre.value; update(); });
      paintContent();
      show(page, true);
    }).catch(function () {
      show(errorState('Could not load series', renderBrowse));
    });
  }

  /** The header's My List button, with how many series are in it. */
  function myListButton() {
    var label = h('span', '', 'My List (' + (myListCount || 0) + ')');
    label.dataset.testid = 'my-list-count';
    var a = navLink('/my-list', 'btn-secondary shrink-0', [icon('bookmark', 'h-4 w-4'), label]);
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
        var grid = h('div', 'grid grid-cols-2 items-start gap-4 sm:grid-cols-3');
        grid.dataset.testid = 'followed-series';
        data.series.forEach(function (s) { grid.appendChild(seriesCard(s)); });
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
    var body = h('div', 'grid grid-cols-2 gap-4 sm:grid-cols-3', [0, 1, 2].map(function () { return skeletonCard(); }));
    section.appendChild(body);
    function load() {
      api('/api/series/' + encodeURIComponent(slug) + '/related').then(function (data) {
        if (!data.series.length) {
          body.replaceWith(body = h('p', 'px-1 text-body text-muted', 'No other series yet.'));
          return;
        }
        var grid = h('div', 'grid grid-cols-2 items-start gap-4 sm:grid-cols-3');
        grid.dataset.testid = 'related-series';
        data.series.forEach(function (r) { grid.appendChild(seriesCard(r)); });
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
          s.originalTitle ? h('p', 'text-body text-muted', s.originalTitle) : null,
          h('div', 'flex flex-wrap items-center gap-2', [
            flag(s.country),
            h('span', 'rounded-full bg-raised px-3 py-1 text-small text-fg', s.format === 'short' ? 'Short drama' : 'Long drama'),
            s.genre ? h('span', 'rounded-full bg-raised px-3 py-1 text-small text-fg', s.genre) : null,
            rating(s, 'text-small font-medium text-fg'),
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
  // Plays a free or unlocked episode (see Player below); a locked one offers
  // the unlock instead.
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
        body = player(e);
      }
      show(h('div', 'flex flex-col gap-6', [
        back,
        h('div', 'flex flex-col gap-1', [
          h('h1', 'text-title', 'Episode ' + e.number + ': ' + e.title),
          h('p', 'text-small text-muted', minutes(e.durationSeconds)),
        ]),
        body,
      ]));
      if (body.stop) stopPlayer = body.stop;
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

  // ── Player ────────────────────────────────────────────────────────────
  // Plays an episode's HLS stream: natively where the browser can (Safari,
  // iOS), else through hls.js, which the server hands out at
  // /vendor/hls.min.js and which is only fetched when it is needed.
  var hlsScript = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsScript) {
      hlsScript = new Promise(function (resolve, reject) {
        var tag = document.createElement('script');
        tag.src = '/vendor/hls.min.js';
        tag.onload = function () { window.Hls ? resolve(window.Hls) : reject(new Error('hls.js missing')); };
        tag.onerror = function () { hlsScript = null; reject(new Error('hls.js failed to load')); };
        document.head.appendChild(tag);
      });
    }
    return hlsScript;
  }

  function player(/** @type {EpisodeItem} */ e) {
    var video = h('video', 'aspect-video w-full rounded-xl border border-line bg-raised');
    video.controls = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'metadata';
    video.dataset.testid = 'video-player';
    video.setAttribute('aria-label', 'Episode ' + e.number + ': ' + e.title);
    var problem = h('div', 'flex flex-col items-start gap-2');
    problem.setAttribute('role', 'alert');
    var box = h('div', 'flex flex-col gap-3', [video, problem]);
    var hls = null;
    var gone = false;
    var lastSaved = 0;

    // Where the person got to, so Continue and the episode grid know.
    function saveProgress(completed) {
      if (!me || isGuest() || !isFinite(video.currentTime)) return;
      lastSaved = Date.now();
      api('/api/me/watch-history/' + e.id, 'PUT', {
        positionSeconds: Math.floor(video.currentTime), completed: !!completed,
      }).catch(function () {});
    }
    video.addEventListener('pause', function () { if (!video.ended) saveProgress(false); });
    video.addEventListener('ended', function () { saveProgress(true); });
    video.addEventListener('timeupdate', function () { if (Date.now() - lastSaved > 15000) saveProgress(false); });

    function fail() {
      if (gone) return;
      var retry = h('button', 'btn-secondary', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', function () { problem.replaceChildren(); start(); });
      problem.replaceChildren(
        h('p', 'text-body text-danger', 'Could not play this episode. Try again, or open it in another browser.'),
        retry);
    }
    video.addEventListener('error', fail);

    function start() {
      if (hls) { hls.destroy(); hls = null; }
      if (!e.videoUrl) return fail();
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = e.videoUrl;
        video.play().catch(function () {}); // a refused autoplay leaves the controls to the viewer
        return;
      }
      loadHls().then(function (Hls) {
        if (gone) return;
        if (!Hls.isSupported()) return fail();
        hls = new Hls();
        hls.on(Hls.Events.ERROR, function (_ev, data) { if (data && data.fatal) fail(); });
        hls.on(Hls.Events.MANIFEST_PARSED, function () { video.play().catch(function () {}); });
        hls.loadSource(e.videoUrl);
        hls.attachMedia(video);
      }, fail);
    }

    // Leaving the screen: save where they got to and stop the stream. The
    // watch screen hands this to show() as stopPlayer once it is on the page.
    box.stop = function () {
      gone = true;
      if (video.currentTime > 0 && !video.ended) saveProgress(false);
      video.pause();
      if (hls) hls.destroy();
    };
    start();
    return box;
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
