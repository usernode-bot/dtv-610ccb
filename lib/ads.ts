// Rewarded ads. The page shows the ad through window.dtv.adProvider
// (public/js/app.js); the unlock is granted only here, on the server, by
// completing an ad_sessions row this server created.
//
// A real ad network plugs in as another AdProvider: its verify() checks the
// network's proof that the ad finished (a signed token in the payload, or a
// server-to-server callback it recorded). The once-only, minimum-length and
// daily-limit checks stay in dtv_unlock_episode_with_ad either way.

import type { Pool } from 'pg';

export interface AdSession {
  id: string;
  userId: number;
  episodeId: number;
  provider: string;
  startedAt: Date;
}

export interface AdProvider {
  name: string;
  /** Seconds the ad runs before it may be completed. */
  minSeconds: number;
  /** Whether the client's completion payload proves the ad was watched. */
  verify(session: AdSession, payload: unknown): Promise<boolean>;
}

/** Ad unlocks a person gets per UTC day. */
export const AD_DAILY_LIMIT = 5;

/** The stand-in ad: a 5-second countdown in the page. Elapsed time is checked by the database. */
export const mockAdProvider: AdProvider = {
  name: 'mock',
  minSeconds: 5,
  async verify() { return true; },
};

const PROVIDERS: Record<string, AdProvider> = { mock: mockAdProvider };

/** The provider named by AD_PROVIDER (default and fallback: mock). */
export function adProvider(): AdProvider {
  const name = process.env.AD_PROVIDER || 'mock';
  if (!PROVIDERS[name]) console.warn(`AD_PROVIDER "${name}" is unknown; using mock`);
  return PROVIDERS[name] || mockAdProvider;
}

/** Ad unlocks the person has left on `day` (YYYY-MM-DD, UTC). */
export async function adsRemaining(pool: Pool, userId: number, day: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ad_sessions
      WHERE user_id = $1 AND day = $2::date AND completed_at IS NOT NULL`, [userId, day]);
  return Math.max(AD_DAILY_LIMIT - rows[0].n, 0);
}

export async function startAdSession(
  pool: Pool, userId: number, episodeId: number, provider: string, day: string,
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO ad_sessions (user_id, episode_id, provider, day)
     VALUES ($1, $2, $3, $4::date) RETURNING id`, [userId, episodeId, provider, day]);
  return rows[0].id;
}

export async function getAdSession(pool: Pool, userId: number, id: string): Promise<AdSession | null> {
  const { rows } = await pool.query(
    'SELECT id, user_id, episode_id, provider, started_at FROM ad_sessions WHERE id = $1 AND user_id = $2',
    [id, userId]);
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, userId: Number(r.user_id), episodeId: r.episode_id, provider: r.provider, startedAt: r.started_at };
}

export type AdUnlockResult = 'ok' | 'already_unlocked' | 'too_early' | 'used' | 'daily_limit' | 'not_found';

/** Grant the unlock for a finished ad (dtv_unlock_episode_with_ad). */
export async function completeAdSession(
  pool: Pool, userId: number, id: string, minSeconds: number,
): Promise<{ result: AdUnlockResult; episodeId: number | null; remainingToday: number }> {
  const { rows } = await pool.query(
    'SELECT result, episode, remaining FROM dtv_unlock_episode_with_ad($1, $2::uuid, $3, $4)',
    [userId, id, minSeconds, AD_DAILY_LIMIT]);
  return { result: rows[0].result, episodeId: rows[0].episode, remainingToday: rows[0].remaining };
}
