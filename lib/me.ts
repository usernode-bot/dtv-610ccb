// Personal queries. Every one takes the signed-in person's id and only ever
// reads or writes rows with that user_id.

import type { Pool } from 'pg';
import type {
  CoinTransaction, EpisodeItem, Profile, SeriesSummary, WatchHistoryItem,
} from '../types';

/** The person's profile, created on first sight and kept in step with their handle. */
export async function ensureProfile(
  pool: Pool, userId: number, username: string,
): Promise<Profile> {
  const { rows } = await pool.query(
    `INSERT INTO profiles (id, username) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, username, avatar_url, coin_balance, created_at`,
    [userId, username]);
  const r = rows[0];
  return {
    id: Number(r.id),
    username: r.username,
    avatarUrl: r.avatar_url,
    coinBalance: r.coin_balance,
    createdAt: r.created_at.toISOString(),
  };
}

/** Series this person follows, most recently followed first. */
export async function listFollowed(pool: Pool, userId: number): Promise<SeriesSummary[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.slug, s.title, s.genre, s.cover_url, s.cover_tone, s.is_demo,
            COUNT(e.id)::int AS episode_count,
            COUNT(e.id) FILTER (WHERE e.coin_price = 0)::int AS free_episode_count
       FROM follows f
       JOIN series s ON s.id = f.series_id
       LEFT JOIN episodes e ON e.series_id = s.id
      WHERE f.user_id = $1
      GROUP BY s.id, f.created_at
      ORDER BY f.created_at DESC`, [userId]);
  return rows.map((r) => ({
    id: r.id, slug: r.slug, title: r.title, genre: r.genre, coverUrl: r.cover_url,
    coverTone: r.cover_tone, isDemo: r.is_demo, episodeCount: r.episode_count,
    freeEpisodeCount: r.free_episode_count, following: true,
  }));
}

export async function listWatchHistory(pool: Pool, userId: number): Promise<WatchHistoryItem[]> {
  const { rows } = await pool.query(
    `SELECT w.episode_id, w.position_seconds, w.completed, w.updated_at,
            e.number, e.title AS episode_title, s.slug, s.title AS series_title
       FROM watch_history w
       JOIN episodes e ON e.id = w.episode_id
       JOIN series s ON s.id = e.series_id
      WHERE w.user_id = $1
      ORDER BY w.updated_at DESC
      LIMIT 100`, [userId]);
  return rows.map((r) => ({
    episodeId: r.episode_id,
    seriesSlug: r.slug,
    seriesTitle: r.series_title,
    episodeNumber: r.number,
    episodeTitle: r.episode_title,
    positionSeconds: r.position_seconds,
    completed: r.completed,
    updatedAt: r.updated_at.toISOString(),
  }));
}

/**
 * Record progress. The profile must exist (ensureProfile first). Returns false
 * when there is no such episode.
 */
export async function saveProgress(
  pool: Pool, userId: number, episodeId: number, positionSeconds: number, completed: boolean,
): Promise<boolean> {
  const ep = await pool.query('SELECT 1 FROM episodes WHERE id = $1', [episodeId]);
  if (!ep.rows.length) return false;
  const { rows } = await pool.query(
    `INSERT INTO watch_history (user_id, episode_id, position_seconds, completed)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, episode_id) DO UPDATE
       SET position_seconds = EXCLUDED.position_seconds,
           completed = EXCLUDED.completed,
           updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [userId, episodeId, positionSeconds, completed]);
  // The first time a person starts an episode counts as one view of its series.
  if (rows[0].inserted) {
    await pool.query(
      `UPDATE series SET view_count = view_count + 1
        WHERE id = (SELECT series_id FROM episodes WHERE id = $1)`, [episodeId]);
  }
  return true;
}

export async function listUnlocked(pool: Pool, userId: number): Promise<EpisodeItem[]> {
  const { rows } = await pool.query(
    `SELECT e.id, e.series_id, e.number, e.title, e.duration_seconds, e.coin_price, e.video_url
       FROM unlocked_episodes u
       JOIN episodes e ON e.id = u.episode_id
      WHERE u.user_id = $1
      ORDER BY u.unlocked_at DESC`, [userId]);
  return rows.map((e) => ({
    id: e.id, seriesId: e.series_id, number: e.number, title: e.title,
    durationSeconds: e.duration_seconds, coinPrice: e.coin_price,
    state: 'unlocked' as const, videoUrl: e.video_url,
  }));
}

export async function listCoinTransactions(pool: Pool, userId: number): Promise<CoinTransaction[]> {
  const { rows } = await pool.query(
    `SELECT id, amount, type, episode_id, note, created_at
       FROM coin_transactions WHERE user_id = $1
      ORDER BY created_at DESC, id DESC LIMIT 100`, [userId]);
  return rows.map((r) => ({
    id: Number(r.id), amount: r.amount, type: r.type, episodeId: r.episode_id,
    note: r.note, createdAt: r.created_at.toISOString(),
  }));
}
