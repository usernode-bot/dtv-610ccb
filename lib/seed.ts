// Demo catalogue: 5 series x 20 episodes, plus a few genres with no series yet. Wholesome and neutral on purpose (the
// app is rated None). Every series is flagged is_demo, and covers are the
// tinted placeholder tiles (cover_url stays empty until real artwork exists).
// Streams are Apple's public HLS test streams.
//
// Idempotent: genres are keyed by slug, series by slug, episodes by
// (series, number); re-running changes nothing. Never touches profiles,
// follows, watch history, coins or unlocks.

import type { Pool } from 'pg';

export const EPISODES_PER_SERIES = 20;

export const DEMO_STREAMS = [
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
];

interface DemoSeries {
  slug: string;
  title: string;
  genre: string;
  synopsis: string;
  coverTone: number;
  /** Leading episodes that are free. */
  freeCount: number;
  /** Coin price of each later episode. */
  price: number;
  /** Titles of the first episodes; the rest are "Episode N". */
  titles: string[];
}

export const DEMO_SERIES: DemoSeries[] = [
  {
    slug: 'bakery-on-maple-street',
    title: 'Bakery on Maple Street',
    genre: 'Family drama',
    synopsis: 'A small neighbourhood bakery gets a new apprentice and a very old sourdough starter. Each morning brings a new recipe, a new regular and a small lesson about patience.',
    coverTone: 0, freeCount: 3, price: 10,
    titles: ['The Starter', 'Early Shift', 'Honey and Rye', 'The Rainy Day Rush', 'Cinnamon Mix-up', 'A Table for Six', 'The Town Fair Order', 'Closing Time'],
  },
  {
    slug: 'garden-club-mysteries',
    title: 'Garden Club Mysteries',
    genre: 'Cosy mystery',
    synopsis: 'The members of a village garden club solve gentle puzzles: a missing watering can, a mislabelled seed packet, a prize pumpkin that turns up in the wrong place.',
    coverTone: 1, freeCount: 2, price: 8,
    titles: ['The Missing Watering Can', 'Seeds of Doubt', 'The Wandering Pumpkin', 'A Note in the Greenhouse', 'The Flower Show Puzzle', 'Who Moved the Scarecrow?'],
  },
  {
    slug: 'lighthouse-neighbors',
    title: 'Lighthouse Neighbors',
    genre: 'Slice of life',
    synopsis: 'Three households share a quiet harbour town and one old lighthouse. Between boat days and market days, they learn to lean on each other.',
    coverTone: 2, freeCount: 3, price: 12,
    titles: ['Fog Morning', 'The Harbour Market', 'Lamp Oil and Letters', 'A Kite Over the Pier', 'The Long Way Home', 'Lantern Night', 'First Light', 'The Ferry Schedule', 'Tea at Low Tide', 'Season Finale'],
  },
  {
    slug: 'little-robot-cooks',
    title: 'Little Robot Cooks',
    genre: 'Animation',
    synopsis: 'A curious robot moves into a tiny kitchen and tries to make dinner for its new friends. Every recipe goes a little differently than the cookbook says.',
    coverTone: 3, freeCount: 4, price: 6,
    titles: ['Boiling Water', 'The Great Pancake Flip', 'Soup of the Day', 'Salt or Sugar?', 'Picnic Basket', 'The Birthday Cake'],
  },
  {
    slug: 'road-trip-radio',
    title: 'Road Trip Radio',
    genre: 'Comedy',
    synopsis: 'Four friends, one van and a radio that only plays the song the moment needs. A summer drive across small towns, one detour at a time.',
    coverTone: 4, freeCount: 2, price: 10,
    titles: ['Packing the Van', 'Wrong Exit', 'The World\'s Largest Teapot', 'Campsite Karaoke', 'Flat Tyre Picnic', 'Postcards'],
  },
];

/** Genres with no demo series yet, so onboarding has more than five to pick from. */
export const EXTRA_DEMO_GENRES = ['Adventure', 'Documentary', 'Musical'];

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Runtime of a demo episode: a short-drama length that varies a little. */
function demoDuration(seriesIndex: number, episodeIndex: number): number {
  return 150 + ((seriesIndex * 7 + episodeIndex * 13) % 8) * 15;
}

export async function seedDemoCatalogue(pool: Pool): Promise<void> {
  for (const name of EXTRA_DEMO_GENRES) {
    await pool.query(
      'INSERT INTO genres (slug, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [slugify(name), name]);
  }
  for (let s = 0; s < DEMO_SERIES.length; s++) {
    const d = DEMO_SERIES[s];
    const genre = await pool.query(
      `INSERT INTO genres (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`, [slugify(d.genre), d.genre]);
    await pool.query(
      `INSERT INTO series (slug, title, synopsis, genre, genre_id, cover_tone, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       ON CONFLICT (slug) DO NOTHING`,
      [d.slug, d.title, d.synopsis, d.genre, genre.rows[0].id, d.coverTone]);
    // An older seed may have left the row without a genre link.
    const { rows } = await pool.query(
      `UPDATE series SET genre_id = COALESCE(genre_id, $2) WHERE slug = $1 RETURNING id`,
      [d.slug, genre.rows[0].id]);
    const seriesId = rows[0].id;
    for (let e = 0; e < EPISODES_PER_SERIES; e++) {
      await pool.query(
        `INSERT INTO episodes (series_id, number, title, duration_seconds, coin_price, video_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (series_id, number) DO UPDATE
           SET video_url = COALESCE(episodes.video_url, EXCLUDED.video_url)`,
        [seriesId, e + 1, d.titles[e] ?? `Episode ${e + 1}`, demoDuration(s, e),
         e < d.freeCount ? 0 : d.price, DEMO_STREAMS[(s + e) % DEMO_STREAMS.length]]);
    }
  }
}
