// Public catalogue queries: genres, series, episodes, and follow state.
// Every function takes the pool first and returns plain camelCase objects.
// `userId` is the signed-in person's id, or null for a guest. Viewers only
// ever see published series (series.is_published) and their episodes.

import type { Pool } from 'pg';
import type {
  BundleQuote, EpisodeItem, EpisodeWithProgress, Genre, SeriesDetail, SeriesSummary, WatchPayload,
} from '../types';

const SUMMARY_SQL = `
  SELECT s.id, s.slug, s.title, s.synopsis, s.genre, s.cover_url, s.cover_tone, s.is_demo,
         s.view_count,
         COUNT(e.id)::int AS episode_count,
         COUNT(e.id) FILTER (WHERE e.coin_price = 0)::int AS free_episode_count,
         EXISTS (SELECT 1 FROM follows f
                  WHERE f.series_id = s.id AND f.user_id = $1) AS following
    FROM series s
    LEFT JOIN episodes e ON e.series_id = s.id
   WHERE s.is_published
   GROUP BY s.id`;

const EPISODE_SQL = `
  SELECT e.id, e.series_id, e.number, e.title, e.duration_seconds, e.coin_price, e.video_url,
         e.subtitles_url,
         EXISTS (SELECT 1 FROM unlocked_episodes u
                  WHERE u.episode_id = e.id AND u.user_id = $1) AS unlocked
    FROM episodes e
    JOIN series ps ON ps.id = e.series_id AND ps.is_published`;

function toSummary(r: any): SeriesSummary {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    genre: r.genre,
    coverUrl: r.cover_url,
    coverTone: r.cover_tone,
    isDemo: r.is_demo,
    episodeCount: r.episode_count,
    freeEpisodeCount: r.free_episode_count,
    following: r.following,
  };
}

function toEpisode(e: any): EpisodeItem {
  const state = e.coin_price === 0 ? 'free' : e.unlocked ? 'unlocked' : 'locked';
  return {
    id: e.id,
    seriesId: e.series_id,
    number: e.number,
    title: e.title,
    durationSeconds: e.duration_seconds,
    coinPrice: e.coin_price,
    state,
    // A locked episode's stream address stays server-side.
    videoUrl: state === 'locked' ? null : e.video_url,
    subtitlesUrl: state === 'locked' ? null : e.subtitles_url,
  };
}

export async function listGenres(pool: Pool): Promise<Genre[]> {
  const { rows } = await pool.query('SELECT id, slug, name FROM genres ORDER BY name');
  return rows;
}

/** All series, oldest first; optionally only one genre (by genre slug). */
export async function listSeries(
  pool: Pool, userId: number | null, genreSlug?: string,
): Promise<SeriesSummary[]> {
  const { rows } = genreSlug
    ? await pool.query(
        `SELECT q.* FROM (${SUMMARY_SQL}) q
           JOIN series s ON s.id = q.id
           JOIN genres g ON g.id = s.genre_id
          WHERE g.slug = $2 ORDER BY q.id`, [userId, genreSlug])
    : await pool.query(`SELECT q.* FROM (${SUMMARY_SQL}) q ORDER BY q.id`, [userId]);
  return rows.map(toSummary);
}

/** The episodes of a series in order, or null when the slug is unknown. */
export async function listEpisodes(
  pool: Pool, slug: string, userId: number | null,
): Promise<EpisodeItem[] | null> {
  const s = await pool.query('SELECT id FROM series WHERE slug = $1 AND is_published', [slug]);
  if (!s.rows.length) return null;
  const { rows } = await pool.query(
    `${EPISODE_SQL} WHERE e.series_id = $2 ORDER BY e.number`, [userId, s.rows[0].id]);
  return rows.map(toEpisode);
}

export async function getEpisode(
  pool: Pool, id: number, userId: number | null,
): Promise<EpisodeItem | null> {
  const { rows } = await pool.query(`${EPISODE_SQL} WHERE e.id = $2`, [userId, id]);
  return rows.length ? toEpisode(rows[0]) : null;
}

/**
 * The player's view of one episode: the episode, its series, every episode of
 * the series in order, and the viewer's saved position (null for a guest).
 * Null when there is no such episode.
 */
export async function getWatchPayload(
  pool: Pool, episodeId: number, userId: number | null,
): Promise<WatchPayload | null> {
  const ep = await pool.query(`${EPISODE_SQL} WHERE e.id = $2`, [userId, episodeId]);
  if (!ep.rows.length) return null;
  const seriesId = ep.rows[0].series_id;
  const s = await pool.query(`SELECT * FROM (${SUMMARY_SQL}) q WHERE id = $2`, [userId, seriesId]);
  const eps = await pool.query(
    `${EPISODE_SQL} WHERE e.series_id = $2 ORDER BY e.number`, [userId, seriesId]);
  let resume: WatchPayload['resume'] = null;
  if (userId !== null) {
    const w = await pool.query(
      'SELECT position_seconds, completed FROM watch_history WHERE user_id = $1 AND episode_id = $2',
      [userId, episodeId]);
    if (w.rows.length) resume = { positionSeconds: w.rows[0].position_seconds, completed: w.rows[0].completed };
  }
  const summary = toSummary(s.rows[0]);
  return {
    episode: toEpisode(ep.rows[0]),
    series: {
      slug: summary.slug, title: summary.title, genre: summary.genre,
      coverUrl: summary.coverUrl, coverTone: summary.coverTone, following: summary.following,
    },
    playlist: eps.rows.map(toEpisode),
    resume,
  };
}

/**
 * One series with its episodes, the viewer's progress on each and where
 * "Continue" goes, or null when the slug is unknown.
 */
export async function getSeries(
  pool: Pool, slug: string, userId: number | null,
): Promise<SeriesDetail | null> {
  const found = await pool.query(
    `SELECT * FROM (${SUMMARY_SQL}) q WHERE slug = $2`, [userId, slug]);
  if (!found.rows.length) return null;
  const r = found.rows[0];
  const eps = await pool.query(
    `SELECT q.*, w.position_seconds, w.completed, w.updated_at AS watched_at
       FROM (${EPISODE_SQL} WHERE e.series_id = $2) q
       LEFT JOIN watch_history w ON w.episode_id = q.id AND w.user_id = $1
      ORDER BY q.number`, [userId, r.id]);
  const episodes: EpisodeWithProgress[] = eps.rows.map((e) => ({
    ...toEpisode(e),
    positionSeconds: e.position_seconds ?? null,
    watched: e.completed === true,
  }));

  let continueEpisode: SeriesDetail['continueEpisode'] = null;
  let latest: any = null;
  for (const e of eps.rows) {
    if (e.watched_at && (!latest || e.watched_at > latest.watched_at)) latest = e;
  }
  if (latest && !latest.completed) {
    continueEpisode = { id: latest.id, number: latest.number, resume: true };
  } else if (latest) {
    const next = eps.rows.find((e) => e.number > latest.number);
    if (next) continueEpisode = { id: next.id, number: next.number, resume: false };
  }

  return {
    ...toSummary(r), synopsis: r.synopsis, viewCount: r.view_count, episodes, continueEpisode,
    bundle: await bundleQuote(pool, r.id, userId),
  };
}

/**
 * The price of unlocking every remaining paid episode of a series (the same
 * dtv_bundle_quote the unlock itself uses), or null with fewer than 2 left.
 */
export async function bundleQuote(
  pool: Pool, seriesId: number, userId: number | null,
): Promise<BundleQuote | null> {
  const { rows } = await pool.query(
    'SELECT episode_count, full_price, price FROM dtv_bundle_quote($1, $2)', [userId, seriesId]);
  const q = rows[0];
  if (!q || q.episode_count < 2) return null;
  return {
    episodeCount: q.episode_count, fullPrice: q.full_price, price: q.price,
    savings: q.full_price - q.price,
  };
}

/**
 * Other series to suggest beside one: the same genre first, then the rest,
 * oldest first. Null when the slug is unknown.
 */
export async function listRelated(
  pool: Pool, slug: string, userId: number | null, limit = 6,
): Promise<SeriesSummary[] | null> {
  const s = await pool.query('SELECT id, genre_id FROM series WHERE slug = $1 AND is_published', [slug]);
  if (!s.rows.length) return null;
  const { rows } = await pool.query(
    `SELECT q.* FROM (${SUMMARY_SQL}) q
       JOIN series s ON s.id = q.id
      WHERE q.id <> $2
      ORDER BY (s.genre_id IS NOT NULL AND s.genre_id = $3) DESC, q.id
      LIMIT $4`, [userId, s.rows[0].id, s.rows[0].genre_id, limit]);
  return rows.map(toSummary);
}

/** Follow or unfollow. Idempotent both ways. Returns the new state, or null if no such series. */
export async function setFollow(
  pool: Pool, slug: string, userId: number, follow: boolean,
): Promise<boolean | null> {
  const s = await pool.query('SELECT id FROM series WHERE slug = $1 AND is_published', [slug]);
  if (!s.rows.length) return null;
  const id = s.rows[0].id;
  if (follow) {
    await pool.query(
      'INSERT INTO follows (user_id, series_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, id]);
  } else {
    await pool.query('DELETE FROM follows WHERE user_id = $1 AND series_id = $2', [userId, id]);
  }
  return follow;
}
