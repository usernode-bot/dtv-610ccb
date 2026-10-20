// Drama catalogue seed: 16 original, fictional Chinese and Korean series, 4 in
// each of CN long, CN short, KR long and KR short. None of the titles, plots or
// artwork belong to a real drama. Wholesome and neutral on purpose (the app is
// rated None): the genre ideas are kept to stories with no violence, weapons or
// mature themes.
//
//   long  = 16-40 episodes of 45-70 min, landscape
//   short = 40-100 episodes of 1-3 min, vertical 9:16
//
// Each series has 5 hand-written episode titles; the rest up to total_episodes
// are generated ("Episode N"). Every series is flagged is_demo.
//
// Idempotent: genres are keyed by slug, series by slug, episodes by
// (series, number). Re-running updates the seeded fields of demo rows in place
// and never touches view counts, follows, watch history, coins or unlocks.

import type { Pool } from 'pg';
import { DEMO_STREAMS } from './seed';

type Country = 'china' | 'korea';
type Format = 'long' | 'short';

interface DramaSeries {
  slug: string;
  title: string;
  /** Title in Hanzi (china) or Hangul (korea). */
  originalTitle: string;
  country: Country;
  format: Format;
  /** 2-3 labels; the first is the primary genre (series.genre / genre_id). */
  genres: string[];
  releaseYear: number;
  status: 'ongoing' | 'completed';
  totalEpisodes: number;
  /** Viewer score out of 10. */
  rating: number;
  isFeatured: boolean;
  synopsis: string;
  /** Titles of episodes 1-5. */
  episodeTitles: [string, string, string, string, string];
}

export const DRAMA_SERIES: DramaSeries[] = [
  // Chinese long dramas
  {
    slug: 'the-lantern-keepers-daughter',
    title: "The Lantern Keeper's Daughter",
    originalTitle: '灯守之女',
    country: 'china', format: 'long',
    genres: ['Historical', 'Romance'],
    releaseYear: 2024, status: 'completed', totalEpisodes: 36, rating: 8.7, isFeatured: true,
    synopsis: 'In the capital of a fictional Tang-style dynasty, Shen Yuelan keeps the lanterns of the old Imperial Library lit every night, just as her father did. When a reserved young archivist arrives to catalogue the collection, the two discover that the library hides a forgotten map of the empire\'s lost canals. Restoring it means crossing the city\'s strictest rules of rank, and slowly, each other\'s hearts.',
    episodeTitles: ['The Last Lamp of Winter', 'An Archivist Without a Seal', 'Ink on the Wrong Scroll', 'The Night Market Lantern Riddle', 'A Map Beneath the Floorboards'],
  },
  {
    slug: 'ten-thousand-li-of-pine-wind',
    title: 'Ten Thousand Li of Pine Wind',
    originalTitle: '万里松风',
    country: 'china', format: 'long',
    genres: ['Wuxia', 'Adventure', 'Friendship'],
    releaseYear: 2023, status: 'completed', totalEpisodes: 40, rating: 8.4, isFeatured: false,
    synopsis: 'When her teacher retires to the mountains, young herbalist Lu Qingshan sets out across the jianghu to return a borrowed book of remedies to the sect that wrote it. Along the way she joins a lantern-carrying courier, a retired tea master and a sect heir who would rather paint than practise. Their road is a contest of light-footed qinggong races, riddles and wits, never of blades.',
    episodeTitles: ['The Book Under the Pine', 'Three Bowls of Mountain Tea', 'A Race Across the Rooftops', 'The Riddle Gate of Mist Valley', 'Rain at the Ferry Crossing'],
  },
  {
    slug: 'floor-thirty-two',
    title: 'Floor Thirty-Two',
    originalTitle: '三十二楼',
    country: 'china', format: 'long',
    genres: ['Office', 'Romance', 'Slice of life'],
    releaseYear: 2025, status: 'completed', totalEpisodes: 24, rating: 7.9, isFeatured: false,
    synopsis: 'Product designer Xu Nian transfers to the thirty-second floor of a Shanghai tech company, where the team is six weeks from launching an app nobody has tested. Her new lead, the famously blunt Gu Chengyu, has a rule against overtime and a habit of fixing bugs at dawn. As the launch nears, the team learns that the best work happens when people look out for each other.',
    episodeTitles: ['Lift to Thirty-Two', 'The Meeting That Ran Long', 'Coffee for the Whole Floor', 'A Bug Named Monday', 'The Demo Day Rehearsal'],
  },
  {
    slug: 'the-cloud-weavers-promise',
    title: "The Cloud Weaver's Promise",
    originalTitle: '云织之约',
    country: 'china', format: 'long',
    genres: ['Fantasy', 'Romance'],
    releaseYear: 2026, status: 'ongoing', totalEpisodes: 30, rating: 8.2, isFeatured: false,
    synopsis: 'In the heavenly realm, apprentice Yun Shu weaves the clouds that bring rain to the mortal world, until a single dropped thread leaves a mountain village in a dry season. Sent down to mend it, she must live as an ordinary tea farmer beside Lin Mo, a village schoolteacher who believes the sky can be reasoned with. A promise between realms grows into something neither of them planned.',
    episodeTitles: ['The Dropped Thread', 'A Village Without Rain', 'The Schoolteacher\'s Kite', 'Seven Colours at Dawn', 'The Loom Remembers'],
  },

  // Chinese short dramas
  {
    slug: 'the-delivery-rider-is-the-chairman',
    title: 'The Delivery Rider Is the Chairman',
    originalTitle: '外卖小哥竟是董事长',
    country: 'china', format: 'short',
    genres: ['Hidden identity', 'Romance', 'Comedy'],
    releaseYear: 2025, status: 'completed', totalEpisodes: 80, rating: 8.1, isFeatured: true,
    synopsis: 'Every lunchtime, the same cheerful delivery rider brings noodles to bakery clerk Tang Xiaoyu. She has no idea that Qin Mo is the chairman of the group that owns her shop, riding a scooter for a month to see how his company really treats people. When her bakery is about to close, he has to choose between keeping his secret and keeping her favourite place open.',
    episodeTitles: ['Extra Spicy, No Coriander', 'The Rider Knows the Boss', 'A Tip of One Yuan', 'Board Meeting in a Helmet', 'The Bakery Closing Notice'],
  },
  {
    slug: 'back-to-the-spring-of-2015',
    title: 'Back to the Spring of 2015',
    originalTitle: '重回二〇一五年春',
    country: 'china', format: 'short',
    genres: ['Rebirth', 'Business', 'Family'],
    releaseYear: 2024, status: 'completed', totalEpisodes: 72, rating: 7.8, isFeatured: false,
    synopsis: 'Pastry chef Wen Jing lost her family\'s dumpling recipe book to a slick business partner who turned it into a chain. Waking up ten years earlier, on the morning she first met him, she gets a second chance. This time she registers the recipes, rebuilds the shop with her grandmother and outsmarts him fairly, one honest bargain at a time.',
    episodeTitles: ['The Morning Before', 'Grandma\'s Recipe Book', 'A Contract I Won\'t Sign', 'Queue Around the Block', 'The Rival Opens Next Door'],
  },
  {
    slug: 'a-marriage-on-paper',
    title: 'A Marriage on Paper',
    originalTitle: '纸上婚约',
    country: 'china', format: 'short',
    genres: ['Contract marriage', 'Romance'],
    releaseYear: 2025, status: 'completed', totalEpisodes: 60, rating: 7.6, isFeatured: false,
    synopsis: 'To keep her late grandfather\'s bookshop, translator Su Wan needs a guarantor with property. Architect Lu Zhen needs a spouse on paper so his family stops arranging dinners. Their one-year agreement has twelve neat rules. Living above the bookshop, they break them one at a time, starting with "no cooking for each other".',
    episodeTitles: ['Twelve Rules', 'A Signature in Blue Ink', 'Rule Four: Separate Shelves', 'Dinner With the Whole Family', 'The Rain on the Bookshop Roof'],
  },
  {
    slug: 'not-the-heiress',
    title: 'Not the Heiress',
    originalTitle: '我不是千金',
    country: 'china', format: 'short',
    genres: ['Mistaken identity', 'Comedy', 'Romance'],
    releaseYear: 2026, status: 'ongoing', totalEpisodes: 90, rating: 7.4, isFeatured: false,
    synopsis: 'Interpreter Ye Lingling is hired for a family reunion in Hangzhou and arrives wearing the same jacket as the long-absent granddaughter everyone is expecting. Before she can explain, three aunts, a stern grandmother and a very suspicious estate manager have welcomed her home. She has seven days to find the real granddaughter and bring her back.',
    episodeTitles: ['The Wrong Jacket', 'Welcome Home, Miss Ye', 'The Estate Manager Has Questions', 'Grandmother\'s Tea Test', 'A Photo From Twenty Years Ago'],
  },

  // Korean long dramas
  {
    slug: 'love-in-aisle-seven',
    title: 'Love in Aisle Seven',
    originalTitle: '7번 통로의 사랑',
    country: 'korea', format: 'long',
    genres: ['Romantic comedy', 'Slice of life'],
    releaseYear: 2024, status: 'completed', totalEpisodes: 16, rating: 8.5, isFeatured: true,
    synopsis: 'Han Bom has stocked the snack aisle of a neighbourhood supermarket in Mapo for six years and knows every regular by their order. Then a new regional manager, Kang Jiwoo, arrives with a plan to "modernise" the shop, starting with her aisle. A rivalry over shelf labels turns into midnight inventory counts, shared triangle kimbap and an unexpected friendship.',
    episodeTitles: ['The New Manager', 'Shelf Labels at Dawn', 'The Ramyeon Promotion', 'Inventory Night', 'Rain Over the Loading Dock'],
  },
  {
    slug: 'night-shift-at-haeundae-general',
    title: 'Night Shift at Haeundae General',
    originalTitle: '해운대 종합병원 야간 근무',
    country: 'korea', format: 'long',
    genres: ['Medical', 'Friendship'],
    releaseYear: 2023, status: 'completed', totalEpisodes: 20, rating: 8.8, isFeatured: false,
    synopsis: 'Four first-year residents are assigned to the night shift at a seaside hospital in Busan. Between ward rounds, worried families and a vending machine that only takes coins, they learn that medicine is as much about listening as knowing. Their senior, a quiet paediatrician, teaches them to look after themselves too.',
    episodeTitles: ['First Night on the Ward', 'The Coin Machine', 'A Call From Room 805', 'Sunrise Over the Harbour', 'The Paediatrician\'s Notebook'],
  },
  {
    slug: 'the-last-score-of-composer-yoon',
    title: 'The Last Score of Composer Yoon',
    originalTitle: '작곡가 윤의 마지막 악보',
    country: 'korea', format: 'long',
    genres: ['Mystery', 'Music'],
    releaseYear: 2025, status: 'completed', totalEpisodes: 16, rating: 8.3, isFeatured: false,
    synopsis: 'A celebrated composer retires without a word, leaving an orchestra one week from a premiere and a final score with its last movement missing. Young copyist Seo Hayoon finds a pencilled clue in the margin, then another in a train timetable. Following them across Seoul and Jeonju, she uncovers why he stopped writing, and what he wanted his orchestra to hear.',
    episodeTitles: ['The Missing Movement', 'A Note in the Margin', 'The Jeonju Timetable', 'Rehearsal Without a Conductor', 'The Key of the Old Piano'],
  },
  {
    slug: 'three-daughters-in-law-of-seokdang-house',
    title: 'Three Daughters-in-Law of Seokdang House',
    originalTitle: '석당가의 세 며느리',
    country: 'korea', format: 'long',
    genres: ['Family', 'Melodrama'],
    releaseYear: 2026, status: 'ongoing', totalEpisodes: 40, rating: 7.7, isFeatured: false,
    synopsis: 'The Seokdang family has run a famous soy sauce brewery for five generations, and its matriarch has announced she will name a successor at her eightieth birthday. Three daughters-in-law, each with her own plan for the brewery, compete for the honour. Then a letter arrives revealing that a baby was swapped at the village clinic thirty years ago, and nobody is sure whose child is whose.',
    episodeTitles: ['The Eightieth Birthday Notice', 'Three Jars of Soy Sauce', 'A Letter From the Village Clinic', 'The Family Register', 'Kimchi Day'],
  },

  // Korean short dramas
  {
    slug: 'the-heir-who-waits-tables',
    title: 'The Heir Who Waits Tables',
    originalTitle: '서빙하는 재벌 3세',
    country: 'korea', format: 'short',
    genres: ['Chaebol', 'Romance', 'Comedy'],
    releaseYear: 2025, status: 'completed', totalEpisodes: 60, rating: 8.0, isFeatured: true,
    synopsis: 'Before he can join the family group, chaebol heir Do Hyunwoo must work three months at a small gukbap restaurant without telling anyone who he is. Owner Choi Sena has no time for a new hire who cannot carry four bowls at once. By the end of the summer he can, and the restaurant has become the one place he wants to be.',
    episodeTitles: ['Four Bowls at Once', 'The Heir Has No Apron', 'Lunch Rush in Euljiro', 'The Secret Broth', 'A Visit From Grandfather'],
  },
  {
    slug: 'rewrite-the-ranking',
    title: 'Rewrite the Ranking',
    originalTitle: '랭킹을 다시 쓰다',
    country: 'korea', format: 'short',
    genres: ['School', 'Youth'],
    releaseYear: 2024, status: 'completed', totalEpisodes: 50, rating: 7.9, isFeatured: false,
    synopsis: 'Scholarship student Lee Dahye lost first place to a classmate whose exam answers somehow matched the teacher\'s key word for word. Transferring back a year later, she quietly forms a study group of overlooked students. Together they prove the scholarship test was rigged, and win the ranking back the honest way.',
    episodeTitles: ['Second Place', 'The Transfer Student Returns', 'A Study Group of Five', 'The Answer Key', 'The Retest'],
  },
  {
    slug: 'ten-minutes-before-yesterday',
    title: 'Ten Minutes Before Yesterday',
    originalTitle: '어제보다 10분 전',
    country: 'korea', format: 'short',
    genres: ['Time slip', 'Romance', 'Fantasy'],
    releaseYear: 2026, status: 'completed', totalEpisodes: 45, rating: 8.2, isFeatured: false,
    synopsis: 'Every time florist Jung Haeri winds the old clock in her shop, she slips back to ten minutes before yesterday. She uses it to fix small mistakes, until she notices the same customer, Park Ijun, buying a single sunflower every day and never saying why. To meet him today, she has to stop living in yesterday.',
    episodeTitles: ['The Clock in the Flower Shop', 'One Sunflower', 'Ten Minutes Is Not Enough', 'The Customer Who Remembers', 'Today, for Real'],
  },
  {
    slug: 'our-second-wedding',
    title: 'Our Second Wedding',
    originalTitle: '두 번째 결혼식',
    country: 'korea', format: 'short',
    genres: ['Second chance', 'Romance', 'Family'],
    releaseYear: 2026, status: 'ongoing', totalEpisodes: 70, rating: 7.5, isFeatured: false,
    synopsis: 'Five years after they parted ways, wedding planner Yoon Seol is hired to organise a ceremony for her former husband, Min Jaehyuk, only to learn the wedding is for his younger sister. Working side by side, they discover the misunderstandings that pulled them apart, and wonder whether a second wedding could ever be their own.',
    episodeTitles: ['The New Client', 'Seating Chart Trouble', 'The Cake Tasting', 'An Old Photo Album', 'Rehearsal Dinner'],
  },
];

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Split a title into at most `maxLines` lines of roughly `width` characters. */
function wrap(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

// PLACEHOLDER: replace with licensed content
// A gradient card with the title, original title and format as an SVG data
// URI, so the catalogue has artwork with no image hosting. Swap poster_url and
// banner_url for licensed artwork (uploaded through the platform's file
// storage) when it exists.
export function placeholderArt(d: DramaSeries, index: number, kind: 'poster' | 'banner'): string {
  const [w, h] = kind === 'banner' ? [1280, 720] : d.format === 'short' ? [540, 960] : [600, 900];
  const hue = (index * 47 + (d.country === 'korea' ? 180 : 0)) % 360;
  const lines = wrap(d.title, kind === 'banner' ? 28 : 16, 3);
  const size = kind === 'banner' ? 64 : 52;
  const top = h * (kind === 'banner' ? 0.36 : 0.42);
  const titleText = lines.map((l, i) =>
    `<text x="${w / 2}" y="${top + i * size * 1.15}" font-size="${size}" font-weight="700">${escapeXml(l)}</text>`).join('');
  const label = `${d.country === 'china' ? 'C-drama' : 'K-drama'} · ${d.format === 'short' ? 'Short' : 'Series'}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue},62%,52%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},58%,24%)"/>`
    + `</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`
    + `<g fill="#fff" font-family="system-ui,sans-serif" text-anchor="middle">${titleText}`
    + `<text x="${w / 2}" y="${top + lines.length * size * 1.15 + size * 0.4}" font-size="${size * 0.6}" opacity="0.85">${escapeXml(d.originalTitle)}</text>`
    + `<text x="${w / 2}" y="${h - size}" font-size="${size * 0.4}" opacity="0.7">${escapeXml(label)} · Placeholder art</text></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// PLACEHOLDER: replace with licensed content
// Apple's public HLS test streams (landscape). There is no licensed footage
// yet, and no vertical sample for the short dramas; they reuse these too.
function placeholderVideo(seriesIndex: number, number: number): string {
  return DEMO_STREAMS[(seriesIndex + number) % DEMO_STREAMS.length];
}

/** Runtime of one episode: 45-70 min for long dramas, 60-180 s for short ones. */
export function episodeDuration(format: Format, seriesIndex: number, number: number): number {
  return format === 'long'
    ? (45 + ((seriesIndex * 3 + number * 7) % 26)) * 60
    : 60 + ((seriesIndex * 11 + number * 37) % 121);
}

/** Leading free episodes and the coin price of the rest. */
const PRICING: Record<Format, { free: number; price: number }> = {
  long: { free: 3, price: 15 },
  short: { free: 10, price: 3 },
};

const SUBTITLES: Record<Country, string[]> = {
  china: ['zh-Hans', 'en', 'id'],
  korea: ['ko', 'en', 'id'],
};

export async function seedDramaCatalogue(pool: Pool): Promise<void> {
  for (let s = 0; s < DRAMA_SERIES.length; s++) {
    const d = DRAMA_SERIES[s];
    const primary = d.genres[0];
    const genre = await pool.query(
      `INSERT INTO genres (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`, [slugify(primary), primary]);
    const { rows } = await pool.query(
      `INSERT INTO series (slug, title, original_title, synopsis, genre, genre_id, genres, country, format,
                           release_year, status, total_episodes, rating, is_featured, poster_url, banner_url,
                           cover_tone, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, TRUE)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, original_title = EXCLUDED.original_title, synopsis = EXCLUDED.synopsis,
         genre = EXCLUDED.genre, genre_id = EXCLUDED.genre_id, genres = EXCLUDED.genres,
         country = EXCLUDED.country, format = EXCLUDED.format, release_year = EXCLUDED.release_year,
         status = EXCLUDED.status, total_episodes = EXCLUDED.total_episodes, rating = EXCLUDED.rating,
         is_featured = EXCLUDED.is_featured, poster_url = EXCLUDED.poster_url,
         banner_url = EXCLUDED.banner_url, cover_tone = EXCLUDED.cover_tone
       WHERE series.is_demo
       RETURNING id`,
      [d.slug, d.title, d.originalTitle, d.synopsis, primary, genre.rows[0].id, d.genres, d.country,
       d.format, d.releaseYear, d.status, d.totalEpisodes, d.rating, d.isFeatured,
       placeholderArt(d, s, 'poster'), placeholderArt(d, s, 'banner'), s % 5]);
    // A real (non-demo) series already owns this slug: leave it alone.
    if (!rows.length) continue;
    const seriesId = rows[0].id;

    const numbers: number[] = [];
    const titles: string[] = [];
    const durations: number[] = [];
    const prices: number[] = [];
    const videos: string[] = [];
    const { free, price } = PRICING[d.format];
    for (let n = 1; n <= d.totalEpisodes; n++) {
      numbers.push(n);
      titles.push(d.episodeTitles[n - 1] ?? `Episode ${n}`);
      durations.push(episodeDuration(d.format, s, n));
      prices.push(n <= free ? 0 : price);
      videos.push(placeholderVideo(s, n));
    }
    await pool.query(
      `INSERT INTO episodes (series_id, number, title, duration_seconds, coin_price, video_url, subtitle_langs)
       SELECT $1, n, t, dur, price, url, $7::text[]
         FROM unnest($2::int[], $3::text[], $4::int[], $5::int[], $6::text[]) AS x(n, t, dur, price, url)
       ON CONFLICT (series_id, number) DO UPDATE SET
         title = EXCLUDED.title, duration_seconds = EXCLUDED.duration_seconds,
         coin_price = EXCLUDED.coin_price, video_url = EXCLUDED.video_url,
         subtitle_langs = EXCLUDED.subtitle_langs`,
      [seriesId, numbers, titles, durations, prices, videos, SUBTITLES[d.country]]);
    // total_episodes went down since an earlier run: drop the extra episodes.
    await pool.query(
      'DELETE FROM episodes WHERE series_id = $1 AND number > $2', [seriesId, d.totalEpisodes]);
  }
}
