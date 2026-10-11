// Dtv front end: a series browse screen, a series detail screen and the genre
// onboarding. Hash routes: "#/" (browse), "#/series/<slug>" (detail) and
// "#/onboarding". Onboarding is a full-screen layer over the page, shown on
// its own route and, for a signed-in person who has not picked genres yet,
// on every route until they do. Everything is
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
  function episodeRow(/** @type {EpisodeItem} */ e, onUnlock) {
    var status;
    if (e.state === 'locked') {
      status = h('button', 'btn-secondary', [lockIcon(), 'Unlock for ' + plural(e.coinPrice, 'coin', 'coins')]);
      status.type = 'button';
      status.dataset.testid = 'unlock-button';
      status.addEventListener('click', function () { onUnlock(e, status); });
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
      followBtn.dataset.testid = 'follow-button';
      followBtn.addEventListener('click', function () {
        if (isGuest()) return askForAccount('follow this series');
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

      function unlock(e, btn) {
        if (isGuest()) return askForAccount('unlock this episode');
        btn.disabled = true;
        message.textContent = '';
        api('/api/episodes/' + e.id + '/unlock', 'POST')
          .then(function (r) {
            var row = episodeRow(r.episode, unlock);
            btn.closest('li').replaceWith(row);
          })
          .catch(function (err) {
            btn.disabled = false;
            if (err.status === 402) message.textContent = 'Not enough coins to unlock episode ' + e.number + '.';
            else if (err.status !== 401) message.textContent = 'Could not unlock. Try again.';
          });
      }

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
                s.episodes.forEach(function (e) { ul.appendChild(episodeRow(e, unlock)); });
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
  function route() {
    var m = /^#\/series\/([^/]+)$/.exec(location.hash);
    if (m) renderDetail(decodeURIComponent(m[1]));
    else renderBrowse();
    if (location.hash === '#/onboarding' || onboardingDue()) openOnboarding();
    else closeOnboarding();
  }

  show(/^#\/series\//.test(location.hash) ? loadingDetail() : loadingBrowse());
  // Ask who is looking first, so the buttons know whether to ask a guest to
  // make an account and onboarding knows whether it is due.
  api('/api/me').then(function (data) { me = data; }, function (err) {
    if (err.status === 401) me = 'guest';
  }).then(function () {
    window.addEventListener('hashchange', route);
    route();
  });
})();
