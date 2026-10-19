// Demo catalogue: 11 Chinese and Korean series (long and short dramas) x 20
// episodes, plus a few genres with no series yet. Wholesome and neutral on purpose (the
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
  /** Made-up view count, so the detail screen has a number to show. */
  views: number;
  originalTitle: string;
  country: 'CN' | 'KR';
  format: 'long' | 'short';
  rating: number;
  featured: boolean;
  /** YYYY-MM-DD, for "New releases". */
  releasedOn: string;
}

export const DEMO_SERIES: DemoSeries[] = [
  {
    slug: 'bakery-on-maple-street',
    title: 'Bakery on Maple Street',
    genre: 'Family drama',
    synopsis: 'A small neighbourhood bakery gets a new apprentice and a very old sourdough starter. Each morning brings a new recipe, a new regular and a small lesson about patience.',
    coverTone: 0, freeCount: 3, price: 10,
    titles: ['The Starter', 'Early Shift', 'Honey and Rye', 'The Rainy Day Rush', 'Cinnamon Mix-up', 'A Table for Six', 'The Town Fair Order', 'Closing Time'],
    views: 12840,
    originalTitle: '메이플 거리의 빵집', country: 'KR', format: 'long', rating: 8.7, featured: false, releasedOn: '2026-08-14',
  },
  {
    slug: 'garden-club-mysteries',
    title: 'Garden Club Mysteries',
    genre: 'Cosy mystery',
    synopsis: 'The members of a village garden club solve gentle puzzles: a missing watering can, a mislabelled seed packet, a prize pumpkin that turns up in the wrong place.',
    coverTone: 1, freeCount: 2, price: 8,
    titles: ['The Missing Watering Can', 'Seeds of Doubt', 'The Wandering Pumpkin', 'A Note in the Greenhouse', 'The Flower Show Puzzle', 'Who Moved the Scarecrow?'],
    views: 5320,
    originalTitle: '花园俱乐部谜案', country: 'CN', format: 'short', rating: 8.1, featured: false, releasedOn: '2026-06-02',
  },
  {
    slug: 'lighthouse-neighbors',
    title: 'Lighthouse Neighbors',
    genre: 'Slice of life',
    synopsis: 'Three households share a quiet harbour town and one old lighthouse. Between boat days and market days, they learn to lean on each other.',
    coverTone: 2, freeCount: 3, price: 12,
    titles: ['Fog Morning', 'The Harbour Market', 'Lamp Oil and Letters', 'A Kite Over the Pier', 'The Long Way Home', 'Lantern Night', 'First Light', 'The Ferry Schedule', 'Tea at Low Tide', 'Season Finale'],
    views: 21900,
    originalTitle: '등대 이웃들', country: 'KR', format: 'long', rating: 9.1, featured: true, releasedOn: '2026-09-20',
  },
  {
    slug: 'little-robot-cooks',
    title: 'Little Robot Cooks',
    genre: 'Animation',
    synopsis: 'A curious robot moves into a tiny kitchen and tries to make dinner for its new friends. Every recipe goes a little differently than the cookbook says.',
    coverTone: 3, freeCount: 4, price: 6,
    titles: ['Boiling Water', 'The Great Pancake Flip', 'Soup of the Day', 'Salt or Sugar?', 'Picnic Basket', 'The Birthday Cake'],
    views: 870,
    originalTitle: '小机器人厨师', country: 'CN', format: 'short', rating: 7.8, featured: false, releasedOn: '2026-09-28',
  },
  {
    slug: 'road-trip-radio',
    title: 'Road Trip Radio',
    genre: 'Comedy',
    synopsis: 'Four friends, one van and a radio that only plays the song the moment needs. A summer drive across small towns, one detour at a time.',
    coverTone: 4, freeCount: 2, price: 10,
    titles: ['Packing the Van', 'Wrong Exit', 'The World\'s Largest Teapot', 'Campsite Karaoke', 'Flat Tyre Picnic', 'Postcards'],
    views: 3410,
    originalTitle: '로드트립 라디오', country: 'KR', format: 'short', rating: 7.5, featured: false, releasedOn: '2026-05-11',
  },
  {
    slug: 'tea-house-by-the-river',
    title: 'Tea House by the River',
    genre: 'Family drama',
    synopsis: 'Three generations run a riverside tea house. When the youngest comes home from the city, she has to learn the old recipes before the spring festival.',
    coverTone: 2, freeCount: 3, price: 10,
    titles: ['Coming Home', 'The First Pot', 'Spring Leaves', 'A Quiet Rival', 'Lanterns on the Water', 'Grandmother\'s Notebook'],
    views: 18350,
    originalTitle: '江边茶馆', country: 'CN', format: 'long', rating: 8.9, featured: true, releasedOn: '2026-10-02',
  },
  {
    slug: 'moon-festival-kitchen',
    title: 'Moon Festival Kitchen',
    genre: 'Comedy',
    synopsis: 'A tiny family kitchen has one week to bake a thousand mooncakes. Every two minutes, something new goes wrong.',
    coverTone: 0, freeCount: 4, price: 5,
    titles: ['A Thousand Orders', 'The Wrong Flour', 'Lotus Paste Panic', 'Delivery Bike', 'Full Moon'],
    views: 26400,
    originalTitle: '中秋厨房', country: 'CN', format: 'short', rating: 8.4, featured: false, releasedOn: '2026-09-30',
  },
  {
    slug: 'paper-crane-library',
    title: 'Paper Crane Library',
    genre: 'Slice of life',
    synopsis: 'A retired librarian opens a reading room in her apartment block. Neighbours who never spoke start leaving folded paper cranes in the returned books.',
    coverTone: 1, freeCount: 3, price: 12,
    titles: ['The Reading Room', 'Overdue', 'A Crane in Chapter Two', 'The Night Shift Reader', 'Shelf Space', 'The Last Page'],
    views: 15120,
    originalTitle: '종이학 도서관', country: 'KR', format: 'long', rating: 9.2, featured: true, releasedOn: '2026-09-05',
  },
  {
    slug: 'the-kite-maker',
    title: 'The Kite Maker',
    genre: 'Family drama',
    synopsis: 'An old kite maker takes on an apprentice who has never flown a kite. Together they build one for the town\'s autumn contest.',
    coverTone: 3, freeCount: 2, price: 10,
    titles: ['Bamboo and Paper', 'The Apprentice', 'Wind Test', 'A Torn Wing', 'Contest Morning'],
    views: 9480,
    originalTitle: '风筝匠', country: 'CN', format: 'long', rating: 8.3, featured: false, releasedOn: '2026-07-19',
  },
  {
    slug: 'bike-courier-days',
    title: 'Bike Courier Days',
    genre: 'Comedy',
    synopsis: 'A cheerful bike courier delivers lunch boxes across the city and keeps getting pulled into other people\'s small problems.',
    coverTone: 4, freeCount: 3, price: 6,
    titles: ['Wrong Address', 'Rainy Route', 'The Forgotten Umbrella', 'Hill Day', 'Lunch for Twelve'],
    views: 11730,
    originalTitle: '자전거 배달부', country: 'KR', format: 'short', rating: 7.9, featured: false, releasedOn: '2026-10-06',
  },
  {
    slug: 'mountain-school',
    title: 'Mountain School',
    genre: 'Slice of life',
    synopsis: 'A young teacher arrives at a small school high in the hills, with nine pupils, one goat and a very slow internet connection.',
    coverTone: 2, freeCount: 3, price: 5,
    titles: ['First Bell', 'The Goat Problem', 'Science Fair', 'Snow Day', 'Graduation'],
    views: 7260,
    originalTitle: '山里的学校', country: 'CN', format: 'short', rating: 8.0, featured: false, releasedOn: '2026-08-27',
  },
];

/** Genres with no demo series yet, so onboarding has more than five to pick from. */
export const EXTRA_DEMO_GENRES = ['Adventure', 'Documentary', 'Musical'];

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Runtime of a demo episode: a few minutes for a short drama, about 45 for a long one. */
function demoDuration(seriesIndex: number, episodeIndex: number, format: 'long' | 'short'): number {
  const vary = (seriesIndex * 7 + episodeIndex * 13) % 8;
  return format === 'short' ? 150 + vary * 15 : 2520 + vary * 60;
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
    // Browse metadata, filled in once (an older seed made the row without it).
    await pool.query(
      `UPDATE series SET original_title = $2, country = $3, format = $4, rating = $5,
              is_featured = $6, released_on = $7
        WHERE slug = $1 AND is_demo AND country IS NULL`,
      [d.slug, d.originalTitle, d.country, d.format, d.rating, d.featured, d.releasedOn]);
    // An older seed may have left the row without a genre link.
    const { rows } = await pool.query(
      `UPDATE series SET genre_id = COALESCE(genre_id, $2) WHERE slug = $1 RETURNING id`,
      [d.slug, genre.rows[0].id]);
    const seriesId = rows[0].id;
    await pool.query(
      'UPDATE series SET view_count = $2 WHERE id = $1 AND is_demo AND view_count = 0',
      [seriesId, d.views]);
    for (let e = 0; e < EPISODES_PER_SERIES; e++) {
      await pool.query(
        `INSERT INTO episodes (series_id, number, title, duration_seconds, coin_price, video_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (series_id, number) DO UPDATE
           SET video_url = COALESCE(episodes.video_url, EXCLUDED.video_url)`,
        [seriesId, e + 1, d.titles[e] ?? `Episode ${e + 1}`, demoDuration(s, e, d.format),
         e < d.freeCount ? 0 : d.price, DEMO_STREAMS[(s + e) % DEMO_STREAMS.length]]);
    }
  }
}
