// Dtv front end: a series browse screen (featured, shelves, filters and a
// poster grid; filters live in ?country=&format=&genre=&q=), a series detail screen, the watch
// screen, My List and the genre onboarding. Path routes: "/" (browse),
// "/series/<slug>" (detail), "/watch/<episodeId>" (watch, with the player), "/my-list"
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
// Every string a person reads comes from public/js/i18n.js (t(key)), in
// English or Indonesian.
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

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
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
    bookmark: [['path', { d: 'M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }]],
    star: [['path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z' }]],
    search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'M21 21l-4.3-4.3' }]],
    film: [['rect', { x: 3, y: 10, width: 18, height: 10, rx: 2 }],
      ['path', { d: 'M3 10 2.4 6.6 19.1 3.7 19.7 7.1z' }],
      ['path', { d: 'M7.5 5.7 9 9' }], ['path', { d: 'M12.8 4.8 14.3 8.1' }]],
    back: [['path', { d: 'M15 18l-6-6 6-6' }]],
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

  // Stops whatever the watch screen is playing; set while a player is on screen.
  var stopPlayer = null;

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
    if (stopPlayer) { stopPlayer(); stopPlayer = null; }
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
    var grid = h('div', POSTER_GRID);
    for (var j = 0; j < 6; j++) grid.appendChild(skeletonCard());
    var page = h('div', 'flex flex-col gap-6', [
      h('div', 'flex items-center justify-between gap-4', [h('div', 'skeleton h-9 w-32'), h('div', 'skeleton h-11 w-36')]),
      h('div', 'flex flex-col gap-3', [h('div', 'skeleton h-11 w-full'), chips]),
      h('div', 'skeleton h-48 w-full rounded-xl'),
      h('div', 'flex flex-col gap-2', [h('div', 'skeleton h-7 w-40'), row]),
      grid,
    ]);
    page.dataset.testid = 'browse-loading';
    return loadingNode(page);
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

  // Where a request for a series is filed: this app's page on Homeroom.
  var REQUEST_URL = 'https://app.onhomeroom.com/#app/dtv-610ccb';

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
      el.textContent = t('myList') + ' (' + (myListCount || 0) + ')';
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
          episodesCount(s.episodeCount),
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
    var grid = h('div', POSTER_GRID + ' items-start');
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
    setTitle('');
    show(loadingBrowse());
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
        h('h1', 'text-title', t('series')),
        h('div', 'flex items-center gap-4', [adminLink(), myListButton()]),
      ]));
      if (data.demo) {
        page.appendChild(h('p', 'text-small text-muted', t('stagingDemo')));
      }
      if (!all.length) {
        page.appendChild(h('div', 'state-empty', [
          h('div', 'mb-2 flex h-20 w-20 items-center justify-center rounded-xl bg-accent/15 text-accent', [icon('film', 'h-10 w-10')]),
          h('h2', 'text-heading', t('noSeriesTitle')),
          h('p', 'text-body text-muted', t('noSeriesBody')),
          requestLink(),
        ]));
        page.appendChild(languagePicker());
        show(page);
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

  /** The header's My List button, with how many series are in it. */
  function myListButton() {
    var label = h('span', '', t('myList') + ' (' + (myListCount || 0) + ')');
    label.dataset.testid = 'my-list-count';
    var a = navLink('/my-list', 'btn-secondary shrink-0', [icon('bookmark', 'h-4 w-4'), label]);
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
        var grid = h('div', POSTER_GRID + ' items-start');
        grid.dataset.testid = 'followed-series';
        data.series.forEach(function (s) { grid.appendChild(seriesCard(s)); });
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
    var body = posterSkeleton(6);
    section.appendChild(body);
    function load() {
      api('/api/series/' + encodeURIComponent(slug) + '/related').then(function (data) {
        if (!data.series.length) {
          body.replaceWith(body = h('p', 'px-1 text-body text-muted', t('noOtherSeries')));
          return;
        }
        var grid = h('div', POSTER_GRID + ' items-start');
        grid.dataset.testid = 'related-series';
        data.series.forEach(function (r) { grid.appendChild(seriesCard(r)); });
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
          s.originalTitle ? h('p', 'text-body text-muted', s.originalTitle) : null,
          h('div', 'flex flex-wrap items-center gap-2', [
            flag(s.country),
            h('span', 'rounded-full bg-raised px-3 py-1 text-small text-fg', s.format === 'short' ? 'Short drama' : 'Long drama'),
            s.genre ? h('span', 'rounded-full bg-raised px-3 py-1 text-small text-fg', s.genre) : null,
            rating(s, 'text-small font-medium text-fg'),
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
  // Plays a free or unlocked episode (see Player below); a locked one offers
  // the unlock instead.
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
        body = player(e);
      }
      show(h('div', 'flex flex-col gap-6', [
        h('div', 'flex flex-col gap-1', [
          h('h1', 'text-title', title),
          h('p', 'text-small text-muted', minutes(e.durationSeconds)),
        ]),
        body,
      ]), back);
      if (body.stop) stopPlayer = body.stop;
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
