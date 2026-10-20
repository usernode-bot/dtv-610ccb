// Bundle unlocks and coin purchases. Every balance change happens inside a
// dtv_* function (lib/schema.ts) under a lock on the person's profiles row.

import type { Pool } from 'pg';
import type { BundleQuote, CoinPackage } from '../types';
import { bundleQuote } from './catalogue';

export type BundleResult =
  | { status: 'ok'; coinBalance: number; unlockedCount: number }
  | { status: 'price_changed'; bundle: BundleQuote | null }
  | { status: 'not_enough_coins' | 'nothing_to_unlock' | 'not_found' };

/** Unlock the rest of a series at the price the person was shown. The profile must exist. */
export async function unlockSeriesBundle(
  pool: Pool, userId: number, slug: string, expectedPrice: number,
): Promise<BundleResult> {
  const s = await pool.query('SELECT id FROM series WHERE slug = $1', [slug]);
  if (!s.rows.length) return { status: 'not_found' };
  const seriesId: number = s.rows[0].id;
  const { rows } = await pool.query(
    'SELECT result, balance, unlocked_count FROM dtv_unlock_series_bundle($1, $2, $3)',
    [userId, seriesId, expectedPrice]);
  const r = rows[0];
  if (r.result === 'ok') return { status: 'ok', coinBalance: r.balance, unlockedCount: r.unlocked_count };
  if (r.result === 'price_changed') {
    return { status: 'price_changed', bundle: await bundleQuote(pool, seriesId, userId) };
  }
  return { status: r.result };
}

/** Record a Checkout Session this server created, before anyone can pay it. */
export async function recordPurchase(
  pool: Pool, userId: number, sessionId: string, pkg: CoinPackage,
): Promise<void> {
  await pool.query(
    `INSERT INTO coin_purchases (user_id, stripe_session_id, package_id, coins, amount_cents, currency)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, sessionId, pkg.id, pkg.coins, pkg.amountCents, pkg.currency]);
}

export async function getPurchase(
  pool: Pool, userId: number, sessionId: string,
): Promise<{ status: 'pending' | 'credited'; coins: number; amountCents: number; currency: string } | null> {
  const { rows } = await pool.query(
    `SELECT status, coins, amount_cents, currency FROM coin_purchases
      WHERE stripe_session_id = $1 AND user_id = $2`, [sessionId, userId]);
  if (!rows.length) return null;
  const r = rows[0];
  return { status: r.status, coins: r.coins, amountCents: r.amount_cents, currency: r.currency };
}

export type CreditResult = 'credited' | 'duplicate' | 'unknown_session' | 'amount_mismatch';

/**
 * Credit a paid Checkout Session once (dtv_credit_purchase). eventId is the
 * webhook event's id, or null when the payment was confirmed by asking Stripe.
 */
export async function creditPurchase(
  pool: Pool, sessionId: string, eventId: string | null, eventType: string | null,
  amountCents: number | null, currency: string | null,
): Promise<{ result: CreditResult; coinBalance: number | null }> {
  const { rows } = await pool.query(
    'SELECT result, balance FROM dtv_credit_purchase($1, $2, $3, $4, $5)',
    [sessionId, eventId, eventType, amountCents, currency]);
  return { result: rows[0].result, coinBalance: rows[0].balance };
}
