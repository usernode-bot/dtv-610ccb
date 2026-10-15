// Personal queries. Every one takes the signed-in person's id and only ever
// reads or writes rows with that user_id.

import type { Pool } from 'pg';
import type {
  CheckInState, CoinTransaction, EpisodeItem, Profile, SeriesSummary, WatchHistoryItem,
} from '../types';
import { toSummary } from './catalogue';
import { CHECK_IN_REWARDS } from './coin-config';

const PROFILE_COLUMNS = 'id, username, avatar_url, coin_balance, favorite_genres, onboarded_at, created_at';

function toProfile(r: any): Profile {
  return {
    id: Number(r.id),
    username: r.username,
    avatarUrl: r.avatar_url,
    coinBalance: r.coin_balance,
    favoriteGenres: r.favorite_genres,
    onboardedAt: r.onboarded_at ? r.onboarded_at.toISOString() : null,
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
 * Spend coins to unlock a paid episode (dtv_unlock_episode: one ledger row
 * and one unlock under a lock on the profile). Unlocking a free or already
 * unlocked episode costs nothing (spent 0). The profile must exist (ensureProfile first).
 */
export async function unlockEpisode(
  pool: Pool, userId: number, episodeId: number,
): Promise<{ coinBalance: number; spent: number } | 'not_found' | 'not_enough_coins'> {
  const { rows } = await pool.query(
    'SELECT result, balance FROM dtv_unlock_episode($1, $2)', [userId, episodeId]);
  const r = rows[0];
  if (r.result === 'not_found' || r.result === 'not_enough_coins') return r.result;
  if (r.result !== 'ok') return { coinBalance: r.balance, spent: 0 };
  const price = await pool.query('SELECT coin_price FROM episodes WHERE id = $1', [episodeId]);
  return { coinBalance: r.balance, spent: price.rows[0].coin_price };
}

/** The day "now" falls on in UTC, as YYYY-MM-DD: check-ins and ad limits count by it. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The person's daily check-in as of `day` (YYYY-MM-DD, UTC). */
export async function getCheckIn(pool: Pool, userId: number, day: string): Promise<CheckInState> {
  const { rows } = await pool.query(
    `SELECT check_in_streak, ($2::date - last_check_in_day) AS gap
       FROM profiles WHERE id = $1`, [userId, day]);
  const streak: number = rows[0]?.check_in_streak ?? 0;
  const gap: number | null = rows[0]?.gap ?? null;
  const claimedToday = gap !== null && gap <= 0;
  // A streak carries on only from yesterday's (or today's) claim.
  const current = gap !== null && gap <= 1 ? streak : 0;
  const nextDay = (current % 7) + 1;
  return {
    streakDay: claimedToday || nextDay > 1 ? current : 0,
    claimedToday,
    nextDay,
    nextReward: CHECK_IN_REWARDS[nextDay - 1],
    rewards: CHECK_IN_REWARDS,
  };
}

/** Claim today's check-in (dtv_claim_check_in). The profile must exist. */
export async function claimCheckIn(
  pool: Pool, userId: number, day: string,
): Promise<{ reward: number; streakDay: number; coinBalance: number } | 'already_claimed'> {
  const { rows } = await pool.query(
    'SELECT result, balance, reward, day_number FROM dtv_claim_check_in($1, $2::date)', [userId, day]);
  const r = rows[0];
  if (r.result !== 'ok') return 'already_claimed';
  return { reward: r.reward, streakDay: r.day_number, coinBalance: r.balance };
}

/** Series this person follows, most recently followed first. */
export async function listFollowed(pool: Pool, userId: number): Promise<SeriesSummary[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.slug, s.title, s.synopsis, s.genre, s.cover_url, s.cover_tone, s.is_demo,
            s.view_count, s.original_title, s.country, s.format, s.rating::float8 AS rating,
            s.is_featured, to_char(s.released_on, 'YYYY-MM-DD') AS released_on,
            (SELECT g.slug FROM genres g WHERE g.id = s.genre_id) AS genre_slug,
            TRUE AS following,
            COUNT(e.id)::int AS episode_count,
            COUNT(e.id) FILTER (WHERE e.coin_price = 0)::int AS free_episode_count
       FROM follows f
       JOIN series s ON s.id = f.series_id AND s.is_published
       LEFT JOIN episodes e ON e.series_id = s.id
      WHERE f.user_id = $1
      GROUP BY s.id, f.created_at
      ORDER BY f.created_at DESC`, [userId]);
  return rows.map(toSummary);
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

export const TRANSACTIONS_PAGE = 50;

function transactionLabel(r: any): string {
  switch (r.type) {
    case 'unlock':
      return r.series_title
        ? `Unlocked ${r.series_title}, episode ${r.episode_number}` : 'Unlocked an episode';
    case 'bundle':
      return `Unlocked ${r.note || 'episodes'}${r.bundle_series_title ? ' of ' + r.bundle_series_title : ''}`;
    case 'purchase':
      return r.note || 'Bought coins';
    case 'check_in':
      return r.note || 'Daily check-in';
    default:
      return r.note || (r.amount > 0 ? 'Coins added' : 'Coins spent');
  }
}

/** The person's ledger, newest first, 50 at a time; `before` is the last id of the previous page. */
export async function listCoinTransactions(
  pool: Pool, userId: number, before?: number,
): Promise<{ transactions: CoinTransaction[]; nextBefore: number | null }> {
  const { rows } = await pool.query(
    `SELECT t.id, t.amount, t.type, t.episode_id, t.series_id, t.note, t.created_at,
            e.number AS episode_number, es.title AS series_title, bs.title AS bundle_series_title
       FROM coin_transactions t
       LEFT JOIN episodes e ON e.id = t.episode_id
       LEFT JOIN series es ON es.id = e.series_id
       LEFT JOIN series bs ON bs.id = t.series_id
      WHERE t.user_id = $1 AND ($2::bigint IS NULL OR t.id < $2)
      ORDER BY t.id DESC LIMIT $3`, [userId, before ?? null, TRANSACTIONS_PAGE + 1]);
  const page = rows.slice(0, TRANSACTIONS_PAGE);
  return {
    transactions: page.map((r) => ({
      id: Number(r.id), amount: r.amount, type: r.type, episodeId: r.episode_id,
      seriesId: r.series_id, note: r.note, label: transactionLabel(r),
      createdAt: r.created_at.toISOString(),
    })),
    nextBefore: rows.length > TRANSACTIONS_PAGE ? Number(page[page.length - 1].id) : null,
  };
}
