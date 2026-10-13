// Dtv's service worker: makes the app installable and gives it an offline
// page. Pages always come from the network; with no connection the offline
// page (public/offline.html) is shown instead. Scripts, the stylesheet and
// the icon also come from the network (a quick revalidation when unchanged,
// so a new deploy is never mixed with an old script) and are kept in the
// cache for when there is no connection.
// The API, the platform's hosted files (/usernode-*) and everything else
// always go to the network: nothing personal is ever cached here.

var CACHE = 'dtv-v2';
var OFFLINE_URL = '/offline.html';
var PRECACHE = [OFFLINE_URL, '/tailwind.css', '/js/i18n.js', '/icons/icon-512.png', '/manifest.webmanifest'];
var ASSET = /^\/(?:js\/[\w.-]+\.js|tailwind\.css|icons\/[\w.-]+\.png|manifest\.webmanifest|offline\.html)$/;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(function () {
      return caches.match(OFFLINE_URL);
    }));
    return;
  }

  if (!ASSET.test(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(function (cache) {
    return fetch(req).then(function (res) {
      if (res.ok) cache.put(url.pathname, res.clone());
      return res;
    }).catch(function () {
      return cache.match(url.pathname).then(function (cached) {
        return cached || Response.error();
      });
    });
  }));
});
