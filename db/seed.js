// Demo catalogue for staging previews. Everything here is wholesome and
// neutral on purpose (the app is rated None): cosy, family-friendly stories,
// no violence, no romance, no gambling. Covers are tinted placeholders until
// real artwork exists.
//
// Idempotent: series are keyed by slug and episodes by (series, number), so
// re-running on every staging boot changes nothing.

/**
 * @typedef {Object} DemoSeries
 * @property {string} slug
 * @property {string} title
 * @property {string} genre
 * @property {string} synopsis
 * @property {number} coverTone      0..4, a neutral tint for the placeholder cover
 * @property {string[]} episodes     episode titles, in order
 * @property {number} freeCount      how many leading episodes are free
 * @property {number} price          coin price of each later episode
 */

/** @type {DemoSeries[]} */
const DEMO_SERIES = [
  {
    slug: 'bakery-on-maple-street',
    title: 'Bakery on Maple Street',
    genre: 'Family drama',
    synopsis: 'A small neighbourhood bakery gets a new apprentice and a very old sourdough starter. Each morning brings a new recipe, a new regular and a small lesson about patience.',
    coverTone: 0, freeCount: 3, price: 10,
    episodes: ['The Starter', 'Early Shift', 'Honey and Rye', 'The Rainy Day Rush', 'Cinnamon Mix-up', 'A Table for Six', 'The Town Fair Order', 'Closing Time'],
  },
  {
    slug: 'garden-club-mysteries',
    title: 'Garden Club Mysteries',
    genre: 'Cosy mystery',
    synopsis: 'The members of a village garden club solve gentle puzzles: a missing watering can, a mislabelled seed packet, a prize pumpkin that turns up in the wrong place.',
    coverTone: 1, freeCount: 2, price: 8,
    episodes: ['The Missing Watering Can', 'Seeds of Doubt', 'The Wandering Pumpkin', 'A Note in the Greenhouse', 'The Flower Show Puzzle', 'Who Moved the Scarecrow?'],
  },
  {
    slug: 'lighthouse-neighbors',
    title: 'Lighthouse Neighbors',
    genre: 'Slice of life',
    synopsis: 'Three households share a quiet harbour town and one old lighthouse. Between boat days and market days, they learn to lean on each other.',
    coverTone: 2, freeCount: 3, price: 12,
    episodes: ['Fog Morning', 'The Harbour Market', 'Lamp Oil and Letters', 'A Kite Over the Pier', 'The Long Way Home', 'Lantern Night', 'First Light', 'The Ferry Schedule', 'Tea at Low Tide', 'Season Finale'],
  },
  {
    slug: 'little-robot-cooks',
    title: 'Little Robot Cooks',
    genre: 'Animation',
    synopsis: 'A curious robot moves into a tiny kitchen and tries to make dinner for its new friends. Every recipe goes a little differently than the cookbook says.',
    coverTone: 3, freeCount: 4, price: 6,
    episodes: ['Boiling Water', 'The Great Pancake Flip', 'Soup of the Day', 'Salt or Sugar?', 'Picnic Basket', 'The Birthday Cake'],
  },
  {
    slug: 'road-trip-radio',
    title: 'Road Trip Radio',
    genre: 'Comedy',
    synopsis: 'Four friends, one van and a radio that only plays the song the moment needs. A summer drive across small towns, one detour at a time.',
    coverTone: 4, freeCount: 2, price: 10,
    episodes: ['Packing the Van', 'Wrong Exit', 'The World\'s Largest Teapot', 'Campsite Karaoke', 'Flat Tyre Picnic', 'Postcards'],
  },
  {
    slug: 'village-chess-club',
    title: 'Village Chess Club',
    genre: 'Feel-good',
    synopsis: 'Every Thursday the village hall fills with friendly rivals and a very large pot of tea. A new member shows up who has never played before.',
    coverTone: 1, freeCount: 3, price: 8,
    episodes: ['Thursday Night', 'The Beginner\'s Board', 'A Tricky Opening', 'Tea Break Tournament', 'The Quiet Champion'],
  },
];

/** Runtime of a demo episode: a short-drama length that varies a little. */
function demoDuration(seriesIndex, episodeIndex) {
  return 150 + ((seriesIndex * 7 + episodeIndex * 13) % 8) * 15;
}

/**
 * Insert the demo catalogue. Never touches users, follows, coins or unlocks.
 * @param {import('pg').Pool} pool
 * @returns {Promise<void>}
 */
async function seedDemoCatalogue(pool) {
  for (let s = 0; s < DEMO_SERIES.length; s++) {
    const d = DEMO_SERIES[s];
    const { rows } = await pool.query(
      `INSERT INTO series (slug, title, synopsis, genre, cover_tone)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [d.slug, d.title, d.synopsis, d.genre, d.coverTone]
    );
    // Already seeded on an earlier boot: its episodes are there too.
    if (!rows.length) continue;
    const seriesId = rows[0].id;
    for (let e = 0; e < d.episodes.length; e++) {
      await pool.query(
        `INSERT INTO episodes (series_id, number, title, duration_seconds, coin_price)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (series_id, number) DO NOTHING`,
        [seriesId, e + 1, d.episodes[e], demoDuration(s, e), e < d.freeCount ? 0 : d.price]
      );
    }
  }
}

module.exports = { seedDemoCatalogue, DEMO_SERIES };
