// Dtv's interface strings in English and Indonesian, and which one to show.
// The language is, in order: the one picked in the app (Language, at the
// bottom of the series screen, kept in localStorage), the person's Homeroom
// language, the device language, then English. window.dtvI18n.t(key, vars)
// returns a string; a value may be a function of vars for plurals.

(function () {
  var STORE_KEY = 'dtv.locale';

  var LOCALES = [
    { code: 'en', name: 'English' },
    { code: 'id', name: 'Bahasa Indonesia' },
  ];

  var STRINGS = {
    en: {
      skipToContent: 'Skip to content',
      language: 'Language',
      series: 'Series',
      stagingDemo: 'Staging demo catalogue: these series are made up for testing.',
      noSeriesTitle: 'No series yet',
      noSeriesBody: 'New series will appear here as soon as they are added.',
      searchSeries: 'Search series',
      noMatchTitle: function (v) { return 'No series match "' + v.q + '"'; },
      noMatchBody: 'Check the spelling or try another title.',
      clearSearch: 'Clear search',
      loadSeriesFailed: 'Could not load series',
      checkConnection: 'Check your connection and try again.',
      retry: 'Retry',
      myList: 'My List',
      episodesCount: function (v) { return v.n === 1 ? '1 episode' : v.n + ' episodes'; },
      coinsCount: function (v) { return v.n === 1 ? '1 coin' : v.n + ' coins'; },
      genresCount: function (v) { return v.n === 1 ? '1 genre' : v.n + ' genres'; },
      views: function (v) { return v.count + (v.n === 1 ? ' view' : ' views'); },
      following: 'Following',
      follow: 'Follow',
      allSeries: 'All series',
      watchHistory: 'Watch history',
      browseSeries: 'Browse series',
      makeAccount: 'Make an account',
      listNeedsAccountTitle: 'Your list needs an account',
      listNeedsAccountBody: 'Make an account to follow series and keep a watch history.',
      nothingWatchedTitle: 'Nothing watched yet',
      nothingWatchedBody: 'Episodes you play show up here, most recent first.',
      notFollowingTitle: 'You are not following any series',
      notFollowingBody: 'Tap Follow on a series to keep it here.',
      loadHistoryFailed: 'Could not load your watch history',
      loadFollowsFailed: 'Could not load the series you follow',
      watched: 'Watched',
      stoppedAt: function (v) { return 'Stopped at ' + v.time; },
      started: 'Started',
      episodeTitle: function (v) { return 'Episode ' + v.n + ': ' + v.title; },
      episodeLabel: function (v) { return 'Episode ' + v.n + ', ' + v.title + ', ' + v.state; },
      notEnoughCoins: function (v) { return 'Not enough coins to unlock episode ' + v.n + '.'; },
      unlockFailed: 'Could not unlock. Try again.',
      stateFree: 'free',
      stateUnlocked: 'unlocked',
      stateLocked: 'locked',
      stateWatching: 'currently watching',
      stateWatched: 'watched',
      freeBadge: 'Free',
      legendLocked: 'Locked (coins)',
      legendUnlocked: 'Unlocked',
      legendWatching: 'Watching',
      legendWatched: 'Watched',
      relatedSeries: 'Related series',
      noOtherSeries: 'No other series yet.',
      relatedFailed: 'Could not load related series. The rest of this page still works.',
      continueEpisode: function (v) { return 'Continue episode ' + v.n; },
      watchNow: 'Watch now',
      followFailed: 'Could not update follow. Try again.',
      share: 'Share',
      linkCopied: 'Link copied.',
      copyFailed: function (v) { return 'Could not copy. The link is ' + v.url; },
      more: 'More',
      less: 'Less',
      episodes: 'Episodes',
      noEpisodesTitle: 'No episodes yet',
      noEpisodesBody: 'Episodes will show up here once they are added.',
      seriesNotFound: 'Series not found',
      mayBeRemoved: 'It may have been removed.',
      loadOneSeriesFailed: 'Could not load this series',
      backToSeries: 'Back to series',
      unlockFor: function (v) { return 'Unlock for ' + v.coins; },
      lockedTitle: 'This episode is locked',
      lockedBody: 'Unlock it with coins or by watching an ad.',
      playerSoonTitle: 'The player is coming soon',
      playerSoonBody: 'Watching episodes arrives in a later update.',
      episodeNotFound: 'Episode not found',
      loadEpisodeFailed: 'Could not load this episode',
      onboardingTitle: 'What do you like to watch?',
      noGenresTitle: 'No genres yet',
      noGenresBody: 'You can pick favourites once the first genres are added.',
      pickMore: function (v) { return 'Pick ' + v.n + ' more'; },
      startWatching: 'Start watching',
      saveGenresFailed: 'Could not save your genres. Try again.',
      notNow: 'Not now',
      pickAtLeast: function (v) { return 'Pick at least ' + v.genres + '. We use them to suggest series for you.'; },
      loadGenresFailed: 'Could not load genres',
    },
    id: {
      skipToContent: 'Langsung ke konten',
      language: 'Bahasa',
      series: 'Serial',
      stagingDemo: 'Katalog demo staging: serial ini dibuat-buat untuk pengujian.',
      noSeriesTitle: 'Belum ada serial',
      noSeriesBody: 'Serial baru akan muncul di sini begitu ditambahkan.',
      searchSeries: 'Cari serial',
      noMatchTitle: function (v) { return 'Tidak ada serial yang cocok dengan "' + v.q + '"'; },
      noMatchBody: 'Periksa ejaan atau coba judul lain.',
      clearSearch: 'Hapus pencarian',
      loadSeriesFailed: 'Tidak dapat memuat serial',
      checkConnection: 'Periksa koneksi Anda lalu coba lagi.',
      retry: 'Coba lagi',
      myList: 'Daftarku',
      episodesCount: function (v) { return v.n + ' episode'; },
      coinsCount: function (v) { return v.n + ' koin'; },
      genresCount: function (v) { return v.n + ' genre'; },
      views: function (v) { return v.count + ' kali ditonton'; },
      following: 'Diikuti',
      follow: 'Ikuti',
      allSeries: 'Semua serial',
      watchHistory: 'Riwayat tontonan',
      browseSeries: 'Jelajahi serial',
      makeAccount: 'Buat akun',
      listNeedsAccountTitle: 'Daftar Anda memerlukan akun',
      listNeedsAccountBody: 'Buat akun untuk mengikuti serial dan menyimpan riwayat tontonan.',
      nothingWatchedTitle: 'Belum ada yang ditonton',
      nothingWatchedBody: 'Episode yang Anda putar muncul di sini, yang terbaru di atas.',
      notFollowingTitle: 'Anda belum mengikuti serial apa pun',
      notFollowingBody: 'Ketuk Ikuti pada sebuah serial untuk menyimpannya di sini.',
      loadHistoryFailed: 'Tidak dapat memuat riwayat tontonan Anda',
      loadFollowsFailed: 'Tidak dapat memuat serial yang Anda ikuti',
      watched: 'Sudah ditonton',
      stoppedAt: function (v) { return 'Berhenti di ' + v.time; },
      started: 'Sudah dimulai',
      episodeTitle: function (v) { return 'Episode ' + v.n + ': ' + v.title; },
      episodeLabel: function (v) { return 'Episode ' + v.n + ', ' + v.title + ', ' + v.state; },
      notEnoughCoins: function (v) { return 'Koin tidak cukup untuk membuka episode ' + v.n + '.'; },
      unlockFailed: 'Tidak dapat membuka episode. Coba lagi.',
      stateFree: 'gratis',
      stateUnlocked: 'terbuka',
      stateLocked: 'terkunci',
      stateWatching: 'sedang ditonton',
      stateWatched: 'sudah ditonton',
      freeBadge: 'Gratis',
      legendLocked: 'Terkunci (koin)',
      legendUnlocked: 'Terbuka',
      legendWatching: 'Sedang ditonton',
      legendWatched: 'Sudah ditonton',
      relatedSeries: 'Serial terkait',
      noOtherSeries: 'Belum ada serial lain.',
      relatedFailed: 'Tidak dapat memuat serial terkait. Bagian lain halaman ini tetap berfungsi.',
      continueEpisode: function (v) { return 'Lanjutkan episode ' + v.n; },
      watchNow: 'Tonton sekarang',
      followFailed: 'Tidak dapat memperbarui status ikuti. Coba lagi.',
      share: 'Bagikan',
      linkCopied: 'Tautan disalin.',
      copyFailed: function (v) { return 'Tidak dapat menyalin. Tautannya: ' + v.url; },
      more: 'Selengkapnya',
      less: 'Ringkas',
      episodes: 'Episode',
      noEpisodesTitle: 'Belum ada episode',
      noEpisodesBody: 'Episode akan muncul di sini setelah ditambahkan.',
      seriesNotFound: 'Serial tidak ditemukan',
      mayBeRemoved: 'Mungkin sudah dihapus.',
      loadOneSeriesFailed: 'Tidak dapat memuat serial ini',
      backToSeries: 'Kembali ke serial',
      unlockFor: function (v) { return 'Buka dengan ' + v.coins; },
      lockedTitle: 'Episode ini terkunci',
      lockedBody: 'Buka dengan koin atau dengan menonton iklan.',
      playerSoonTitle: 'Pemutar segera hadir',
      playerSoonBody: 'Menonton episode hadir di pembaruan berikutnya.',
      episodeNotFound: 'Episode tidak ditemukan',
      loadEpisodeFailed: 'Tidak dapat memuat episode ini',
      onboardingTitle: 'Anda suka menonton apa?',
      noGenresTitle: 'Belum ada genre',
      noGenresBody: 'Anda bisa memilih favorit setelah genre pertama ditambahkan.',
      pickMore: function (v) { return 'Pilih ' + v.n + ' lagi'; },
      startWatching: 'Mulai menonton',
      saveGenresFailed: 'Tidak dapat menyimpan genre Anda. Coba lagi.',
      notNow: 'Nanti saja',
      pickAtLeast: function (v) { return 'Pilih minimal ' + v.genres + '. Kami memakainya untuk menyarankan serial untuk Anda.'; },
      loadGenresFailed: 'Tidak dapat memuat genre',
    },
  };

  /** A BCP-47 tag onto one of LOCALES, by language subtag; null when none fits. */
  function match(tag) {
    if (!tag || typeof tag !== 'string') return null;
    var lang = tag.toLowerCase().split(/[-_]/)[0];
    if (lang === 'in') lang = 'id'; // the old code for Indonesian
    return STRINGS[lang] ? lang : null;
  }

  function stored() {
    try { return match(localStorage.getItem(STORE_KEY)); } catch (_) { return null; }
  }

  function fromDevice() {
    var tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (var i = 0; i < tags.length; i++) { var m = match(tags[i]); if (m) return m; }
    return null;
  }

  var locale = stored() || fromDevice() || 'en';
  document.documentElement.lang = locale;

  function t(key, vars) {
    var v = STRINGS[locale][key];
    if (v === undefined) v = STRINGS.en[key];
    if (typeof v === 'function') return v(vars || {});
    return v === undefined ? key : v;
  }

  function setLocale(code) {
    var m = match(code);
    if (!m) return;
    locale = m;
    document.documentElement.lang = m;
    try { localStorage.setItem(STORE_KEY, m); } catch (_) {}
  }

  // The Homeroom language wins over the device's, unless one was picked in
  // the app. getUserLocale never rejects, but may be missing outside Homeroom.
  var ready = Promise.resolve().then(function () {
    if (stored() || !window.usernode || !window.usernode.getUserLocale) return;
    return window.usernode.getUserLocale().then(function (r) {
      var m = r && match(r.locale);
      if (m) { locale = m; document.documentElement.lang = m; }
    });
  }).catch(function () {});

  window.dtvI18n = {
    t: t,
    ready: ready,
    locales: LOCALES,
    locale: function () { return locale; },
    setLocale: setLocale,
  };
})();
