// Dtv front end: a series browse screen and a series detail screen.
// Hash routes: "#/" (browse) and "#/series/<slug>" (detail). Everything is
// built with DOM calls and textContent, so catalogue text is never parsed as
// HTML. Class names are whole literals so the Tailwind build can see them.
//
// @typedef {{id:number, slug:string, title:string, genre:string, coverUrl:string|null,
//   coverTone:number, episodeCount:number, freeEpisodeCount:number, following:boolean}} SeriesSummary
// @typedef {{id:number, number:number, title:string, durationSeconds:number,
//   coinPrice:number, state:'free'|'unlocked'|'locked'}} EpisodeItem

(function () {
  var root = document.getElementById('app');

  // Neutral placeholder cover tints (colour tokens only), indexed by coverTone.
  var TONES = ['bg-accent/15', 'bg-raised', 'bg-accent/30', 'bg-line', 'bg-accent/20'];

  // The iframe is opened with ?token=...; forward it on every API call.
  var token = new URLSearchParams(location.search).get('token');

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

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function minutes(seconds) {
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function lockIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'h-4 w-4');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    ['x:5', 'y:11', 'width:14', 'height:10', 'rx:2'].forEach(function (p) {
      var kv = p.split(':'); body.setAttribute(kv[0], kv[1]);
    });
    var shackle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shackle.setAttribute('d', 'M8 11V7a4 4 0 0 1 8 0v4');
    svg.appendChild(body);
    svg.appendChild(shackle);
    return svg;
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
      h('div', 'skeleton h-8 w-2/3'),
      h('div', 'skeleton h-20 w-full'),
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
    var a = h('a', 'flex flex-col gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', [
      cover(s, 'aspect-[3/4] w-full rounded-xl border border-line', 'text-title text-fg'),
      h('div', 'flex flex-col', [
        h('h2', 'text-body font-semibold', s.title),
        h('p', 'text-small text-muted', plural(s.episodeCount, 'episode', 'episodes') + (s.genre ? ' · ' + s.genre : '')),
        s.following ? h('p', 'text-small font-medium text-accent', 'Following') : null,
      ]),
    ]);
    a.href = '#/series/' + encodeURIComponent(s.slug);
    a.dataset.testid = 'series-tile';
    return a;
  }

  function renderBrowse() {
    show(loadingBrowse());
    api('/api/series').then(function (data) {
      var page = h('div', 'flex flex-col gap-4');
      page.appendChild(h('h1', 'text-title', 'Series'));
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

  // ── Detail ────────────────────────────────────────────────────────────
  function episodeRow(/** @type {EpisodeItem} */ e) {
    var status;
    if (e.state === 'locked') {
      status = h('span', 'inline-flex items-center gap-1 text-small text-muted', [lockIcon(), plural(e.coinPrice, 'coin', 'coins')]);
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
    show(loadingDetail());
    var back = h('a', 'inline-flex min-h-11 items-center text-body font-medium text-accent', 'All series');
    back.href = '#/';
    api('/api/series/' + encodeURIComponent(slug)).then(function (data) {
      /** @type {SeriesSummary & {synopsis:string, episodes:EpisodeItem[]}} */
      var s = data.series;
      var following = s.following;
      var followBtn = h('button', '');
      followBtn.type = 'button';
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
          cover(s, 'h-36 w-28 shrink-0 rounded-xl border border-line', 'text-title text-fg'),
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
      show(page);
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

  // ── Routing ───────────────────────────────────────────────────────────
  function route() {
    var m = /^#\/series\/([^/]+)$/.exec(location.hash);
    if (m) renderDetail(decodeURIComponent(m[1]));
    else renderBrowse();
  }
  window.addEventListener('hashchange', route);
  route();
})();
