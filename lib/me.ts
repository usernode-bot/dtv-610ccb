// Personal queries. Every one takes the signed-in person's id and only ever
// reads or writes rows with that user_id.

import type { Pool } from 'pg';
import type {
  CoinTransaction, EpisodeItem, Profile, SeriesSummary, WatchHistoryItem,
} from '../types';

const PROFILE_COLUMNS = 'id, username, avatar_url, coin_balance, favorite_genres, onboarded_at, role, created_at';

function toProfile(r: any): Profile {
  return {
    id: Number(r.id),
    username: r.username,
    avatarUrl: r.avatar_url,
    coinBalance: r.coin_balance,
    favoriteGenres: r.favorite_genres,
    onboardedAt: r.onboarded_at ? r.onboarded_at.toISOString() : null,
    role: r.role,
    createdAt: r.created_at.toISOString(),
  };
}

/** The person's profile, created on first sight and kept in step with their handle. */
export async function ensureProfile(
  pool: Pool, userId: number, username: string,
): Promise<Profile> {
  const { rows } = await pool.query(
    `INSERT INTO profiles (id, username) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
     RETURNING ${PROFILE_COLUMNS}`,
    [userId, username]);
  return toProfile(rows[0]);
}

/**
 * How many genres onboarding asks for: 3, or every genre when there are fewer.
 * 0 means there is nothing to pick yet, so onboarding is skipped.
 */
export async function minFavoriteGenres(pool: Pool): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM genres');
  return Math.min(3, rows[0].n);
}

/**
 * Save the genres picked during onboarding and mark it done. Returns the
 * profile, or an error code: 'invalid_genres' for a slug that is not a genre
 * or a repeat, 'too_few_genres' for fewer than minFavoriteGenres.
 */
export async function saveFavoriteGenres(
  pool: Pool, userId: number, username: string, slugs: unknown,
): Promise<Profile | 'invalid_genres' | 'too_few_genres'> {
  if (!Array.isArray(slugs) || !slugs.every((g) => typeof g === 'string')) return 'invalid_genres';
  const unique = [...new Set(slugs as string[])];
  if (unique.length !== slugs.length || unique.length > 50) return 'invalid_genres';
  const known = await pool.query('SELECT slug FROM genres WHERE slug = ANY($1::text[])', [unique]);
  if (known.rows.length !== unique.length) return 'invalid_genres';
  if (unique.length < await minFavoriteGenres(pool)) return 'too_few_genres';
  await ensureProfile(pool, userId, username);
  const { rows } = await pool.query(
    `UPDATE profiles SET favorite_genres = $2::text[], onboarded_at = COALESCE(onboarded_at, NOW())
      WHERE id = $1 RETURNING ${PROFILE_COLUMNS}`, [userId, unique]);
  return toProfile(rows[0]);
}

/**
 * Spend coins to unlock a paid episode: one ledger row and one unlock, in a
 * single transaction. Unlocking a free or already unlocked episode costs
 * nothing (spent 0). The profile must exist (ensureProfile first).
 */
export async function unlockEpisode(
  pool: Pool, userId: number, episodeId: number,
): Promise<{ coinBalance: number; spent: number } | 'not_found' | 'not_enough_coins'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ep = await client.query(
      `SELECT e.coin_price FROM episodes e
         JOIN series s ON s.id = e.series_id AND s.is_published
        WHERE e.id = $1`, [episodeId]);
    if (!ep.rows.length) { await client.query('ROLLBACK'); return 'not_found'; }
    const price: number = ep.rows[0].coin_price;
    const me = await client.query(
      'SELECT coin_balance FROM profiles WHERE id = $1 FOR UPDATE', [userId]);
    const balance: number = me.rows[0].coin_balance;
    const have = await client.query(
      'SELECT 1 FROM unlocked_episodes WHERE user_id = $1 AND episode_id = $2', [userId, episodeId]);
    if (price === 0 || have.rows.length) { await client.query('COMMIT'); return { coinBalance: balance, spent: 0 }; }
    if (balance < price) { await client.query('ROLLBACK'); return 'not_enough_coins'; }
    const tx = await client.query(
      `INSERT INTO coin_transactions (user_id, amount, type, episode_id)
       VALUES ($1, $2, 'unlock', $3) RETURNING id`, [userId, -price, episodeId]);
    await client.query(
      `INSERT INTO unlocked_episodes (user_id, episode_id, coin_transaction_id) VALUES ($1, $2, $3)`,
      [userId, episodeId, tx.rows[0].id]);
    const upd = await client.query(
      'UPDATE profiles SET coin_balance = coin_balance - $2 WHERE id = $1 RETURNING coin_balance',
      [userId, price]);
    await client.query('COMMIT');
    return { coinBalance: upd.rows[0].coin_balance, spent: price };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Series this person follows, most recently followed first. */
export async function listFollowed(pool: Pool, userId: number): Promise<SeriesSummary[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.slug, s.title, s.genre, s.cover_url, s.cover_tone, s.is_demo,
            COUNT(e.id)::int AS episode_count,
            COUNT(e.id) FILTER (WHERE e.coin_price = 0)::int AS free_episode_count
       FROM follows f
       JOIN series s ON s.id = f.series_id AND s.is_published
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
 * when there is no such episode, else whether this save finished the episode
 * (it was not already marked watched).
 */
export async function saveProgress(
  pool: Pool, userId: number, episodeId: number, positionSeconds: number, completed: boolean,
): Promise<false | { newlyCompleted: boolean }> {
  const ep = await pool.query('SELECT 1 FROM episodes WHERE id = $1', [episodeId]);
  if (!ep.rows.length) return false;
  const prev = await pool.query(
    'SELECT completed FROM watch_history WHERE user_id = $1 AND episode_id = $2', [userId, episodeId]);
  const wasCompleted = prev.rows.length > 0 && prev.rows[0].completed === true;
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
  return { newlyCompleted: completed && !wasCompleted };
}

/**
 * Record that the person opened an episode to play it: a history row at
 * position 0 the first time, otherwise only moves it to the top of their
 * history (their saved position is kept). A locked episode they have not
 * unlocked is not recorded. The profile must exist (ensureProfile first).
 */
export async function recordPlay(
  pool: Pool, userId: number, episodeId: number,
): Promise<true | 'not_found' | 'locked'> {
  const ep = await pool.query(
    `SELECT e.coin_price,
            EXISTS (SELECT 1 FROM unlocked_episodes u
                     WHERE u.user_id = $2 AND u.episode_id = e.id) AS unlocked
       FROM episodes e WHERE e.id = $1`, [episodeId, userId]);
  if (!ep.rows.length) return 'not_found';
  if (ep.rows[0].coin_price > 0 && !ep.rows[0].unlocked) return 'locked';
  const { rows } = await pool.query(
    `INSERT INTO watch_history (user_id, episode_id, position_seconds, completed)
     VALUES ($1, $2, 0, false)
     ON CONFLICT (user_id, episode_id) DO UPDATE SET updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`, [userId, episodeId]);
  // Same rule as saveProgress: the first start counts as one view.
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
