// Public catalogue queries: genres, series, episodes, and follow state.
// Every function takes the pool first and returns plain camelCase objects.
// `userId` is the signed-in person's id, or null for a guest.

import type { Pool } from 'pg';
import type { EpisodeItem, Genre, SeriesDetail, SeriesSummary } from '../types';

const SUMMARY_SQL = `
  SELECT s.id, s.slug, s.title, s.synopsis, s.genre, s.cover_url, s.cover_tone, s.is_demo,
         COUNT(e.id)::int AS episode_count,
         COUNT(e.id) FILTER (WHERE e.coin_price = 0)::int AS free_episode_count,
         EXISTS (SELECT 1 FROM follows f
                  WHERE f.series_id = s.id AND f.user_id = $1) AS following
    FROM series s
    LEFT JOIN episodes e ON e.series_id = s.id
   GROUP BY s.id`;

const EPISODE_SQL = `
  SELECT e.id, e.series_id, e.number, e.title, e.duration_seconds, e.coin_price, e.video_url,
         EXISTS (SELECT 1 FROM unlocked_episodes u
                  WHERE u.episode_id = e.id AND u.user_id = $1) AS unlocked
    FROM episodes e`;

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
  const s = await pool.query('SELECT id FROM series WHERE slug = $1', [slug]);
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

/** One series with its episodes, or null when the slug is unknown. */
export async function getSeries(
  pool: Pool, slug: string, userId: number | null,
): Promise<SeriesDetail | null> {
  const found = await pool.query(
    `SELECT * FROM (${SUMMARY_SQL}) q WHERE slug = $2`, [userId, slug]);
  if (!found.rows.length) return null;
  const r = found.rows[0];
  const eps = await pool.query(
    `${EPISODE_SQL} WHERE e.series_id = $2 ORDER BY e.number`, [userId, r.id]);
  return { ...toSummary(r), synopsis: r.synopsis, episodes: eps.rows.map(toEpisode) };
}

/** Follow or unfollow. Idempotent both ways. Returns the new state, or null if no such series. */
export async function setFollow(
  pool: Pool, slug: string, userId: number, follow: boolean,
): Promise<boolean | null> {
  const s = await pool.query('SELECT id FROM series WHERE slug = $1', [slug]);
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
