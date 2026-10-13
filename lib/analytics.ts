// Product analytics: one row per event in analytics_events (private: rows
// carry who did what). The server records play, complete, unlock and purchase
// where they happen; the page reports drop_off (leaving an episode before the
// end), which only it can see. Reports read aggregates only, never people.

import type { Pool } from 'pg';
import type { EpisodeDropOff } from '../types';

export const EVENT_NAMES = ['play', 'complete', 'unlock', 'purchase', 'drop_off'] as const;
export type EventName = typeof EVENT_NAMES[number];

/** Events the page may send itself (POST /api/events). The rest are server-side only. */
export const CLIENT_EVENT_NAMES: ReadonlySet<string> = new Set(['drop_off']);

export interface AnalyticsEvent {
  userId: number;
  name: EventName;
  episodeId?: number | null;
  positionSeconds?: number | null;
  props?: Record<string, unknown>;
}

/** Record one event. Never throws: analytics must not break the action it describes. */
export async function trackEvent(pool: Pool, e: AnalyticsEvent): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO analytics_events (user_id, name, episode_id, series_id, position_seconds, props)
       VALUES ($1, $2, $3, (SELECT series_id FROM episodes WHERE id = $3), $4, $5)`,
      [e.userId, e.name, e.episodeId ?? null, e.positionSeconds ?? null, JSON.stringify(e.props || {})]);
  } catch (err) {
    console.error('analytics: could not record ' + e.name + ': ' + (err as Error).message);
  }
}

/**
 * Per-episode drop-off for one series, in episode order: how many people
 * played each episode, how many finished it, how many left it early (and
 * where, on average), and how many of the people who played episode 1 got to
 * this one. Null when the slug is unknown.
 */
export async function episodeDropOff(pool: Pool, slug: string): Promise<EpisodeDropOff[] | null> {
  const s = await pool.query('SELECT id FROM series WHERE slug = $1', [slug]);
  if (!s.rows.length) return null;
  const { rows } = await pool.query(
    `SELECT e.id, e.number,
            COUNT(DISTINCT a.user_id) FILTER (WHERE a.name = 'play')::int AS viewers,
            COUNT(DISTINCT a.user_id) FILTER (WHERE a.name = 'complete')::int AS completed,
            COUNT(DISTINCT a.user_id) FILTER (WHERE a.name = 'drop_off')::int AS dropped,
            ROUND(AVG(a.position_seconds) FILTER (WHERE a.name = 'drop_off'))::int AS avg_drop_position
       FROM episodes e
       LEFT JOIN analytics_events a ON a.episode_id = e.id
      WHERE e.series_id = $1
      GROUP BY e.id
      ORDER BY e.number`, [s.rows[0].id]);
  const first = rows.length ? rows[0].viewers : 0;
  return rows.map((r) => ({
    episodeId: r.id,
    number: r.number,
    viewers: r.viewers,
    completed: r.completed,
    dropped: r.dropped,
    dropOffRate: r.viewers ? Math.min(1, Math.round((r.dropped / r.viewers) * 1000) / 1000) : 0,
    averageDropPositionSeconds: r.avg_drop_position,
    retentionFromFirst: first ? Math.round((r.viewers / first) * 1000) / 1000 : 0,
  }));
}
