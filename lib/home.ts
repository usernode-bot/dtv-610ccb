// Home screen queries: the hero carousel, the ranked rows, the genre rows and
// the viewer's own "Continue watching" row. Same row shape as lib/catalogue.ts.

import type { Pool } from 'pg';
import type { ContinueWatchingItem, GenreRow, HomeFeed, SeriesSummary } from '../types';
import { SUMMARY_SQL, toSummary } from './catalogue';

export const HERO_SIZE = 5;
export const ROW_SIZE = 12;
export const GENRE_ROWS = 3;
/** How far back follows and plays count towards "Trending now". */
export const TRENDING_DAYS = 7;

// Recent follows plus recent plays per series, as of $2. Plays come from the
// private watch_history table but only as a count, never who watched.
const TRENDING_SQL = `
  SELECT q.*,
         (SELECT COUNT(*) FROM follows f
           WHERE f.series_id = q.id AND f.created_at > $2::timestamptz - make_interval(days => ${TRENDING_DAYS}))
       + (SELECT COUNT(*) FROM watch_history w JOIN episodes e ON e.id = w.episode_id
           WHERE e.series_id = q.id AND w.updated_at > $2::timestamptz - make_interval(days => ${TRENDING_DAYS}))
         AS score
    FROM (${SUMMARY_SQL}) q`;

/** Most followed and watched series in the last week; ties go to the oldest series. */
export async function listTrending(
  pool: Pool, userId: number | null, now: Date, limit = ROW_SIZE,
): Promise<SeriesSummary[]> {
  const { rows } = await pool.query(
    `SELECT * FROM (${TRENDING_SQL}) t ORDER BY score DESC, id LIMIT $3`, [userId, now, limit]);
  return rows.map(toSummary);
}

/** Newest series first. */
export async function listNewReleases(
  pool: Pool, userId: number | null, limit = ROW_SIZE,
): Promise<SeriesSummary[]> {
  const { rows } = await pool.query(
    `SELECT q.* FROM (${SUMMARY_SQL}) q JOIN series s ON s.id = q.id
      ORDER BY s.created_at DESC, q.id DESC LIMIT $2`, [userId, limit]);
  return rows.map(toSummary);
}

/** The hero carousel: featured series by rank, topped up from trending to HERO_SIZE. */
export async function listFeatured(
  pool: Pool, userId: number | null, now: Date,
): Promise<SeriesSummary[]> {
  const { rows } = await pool.query(
    `SELECT t.* FROM (${TRENDING_SQL}) t JOIN series s USING (id)
      ORDER BY s.featured_rank NULLS LAST, t.score DESC, t.id LIMIT $3`,
    [userId, now, HERO_SIZE]);
  return rows.map(toSummary);
}

/**
 * One row per genre for the genres with the most series (then by name), each
 * ranked like "Trending now". Genres with no series are left out.
 */
export async function listGenreRows(
  pool: Pool, userId: number | null, now: Date,
): Promise<GenreRow[]> {
  const genres = await pool.query(
    `SELECT g.id, g.slug, g.name FROM genres g JOIN series s ON s.genre_id = g.id
      GROUP BY g.id ORDER BY COUNT(s.id) DESC, g.name LIMIT $1`, [GENRE_ROWS]);
  const out: GenreRow[] = [];
  for (const g of genres.rows) {
    const { rows } = await pool.query(
      `SELECT t.* FROM (${TRENDING_SQL}) t JOIN series s USING (id)
        WHERE s.genre_id = $4 ORDER BY t.score DESC, t.id LIMIT $3`,
      [userId, now, ROW_SIZE, g.id]);
    out.push({ genre: g, series: rows.map(toSummary) });
  }
  return out;
}

/**
 * The viewer's series in progress: the episode they played last in each
 * series, most recent first. A series whose last episode they finished is done
 * and left out.
 */
export async function listContinueWatching(
  pool: Pool, userId: number, limit = ROW_SIZE,
): Promise<ContinueWatchingItem[]> {
  const { rows } = await pool.query(
    `SELECT q.*, l.number AS episode_number, l.position_seconds, l.duration_seconds, l.updated_at
       FROM (SELECT DISTINCT ON (e.series_id) e.series_id, e.number, e.duration_seconds,
                    w.position_seconds, w.completed, w.updated_at
               FROM watch_history w JOIN episodes e ON e.id = w.episode_id
              WHERE w.user_id = $1
              ORDER BY e.series_id, w.updated_at DESC) l
       JOIN (${SUMMARY_SQL}) q ON q.id = l.series_id
      WHERE NOT (l.completed AND l.number >= q.episode_count)
      ORDER BY l.updated_at DESC LIMIT $2`, [userId, limit]);
  return rows.map((r) => ({
    ...toSummary(r),
    episodeNumber: r.episode_number,
    positionSeconds: r.position_seconds,
    durationSeconds: r.duration_seconds,
  }));
}

export async function getHomeFeed(
  pool: Pool, userId: number | null, now: Date,
): Promise<HomeFeed> {
  const [featured, continueWatching, trending, newReleases, genreRows] = await Promise.all([
    listFeatured(pool, userId, now),
    userId === null ? Promise.resolve(null) : listContinueWatching(pool, userId),
    listTrending(pool, userId, now),
    listNewReleases(pool, userId),
    listGenreRows(pool, userId, now),
  ]);
  return { featured, continueWatching, trending, newReleases, genreRows };
}
