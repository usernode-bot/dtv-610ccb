// The coin store: packages, Stripe Checkout, and the purchase status the page
// polls after paying. Coins are only ever credited by dtv_credit_purchase, from
// the coin_purchases row written here (lib/coins.ts).

import express from 'express';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { requireUser, userId, wrap } from '../../lib/auth';
import { COIN_PACKAGES } from '../../lib/coin-config';
import { creditPurchase, getPurchase, recordPurchase } from '../../lib/coins';
import { ensureProfile } from '../../lib/me';
import { paymentsConfigured, type Payments } from '../../lib/stripe';

/** Marks Checkout Sessions as this app's, so the webhook can tell them from others on the same account. */
export const CHECKOUT_APP_TAG = 'dtv';

export interface StoreOptions {
  payments: Payments;
  /**
   * Where Stripe sends the person back to: an absolute URL that opens `path`
   * in this app (through the platform), or null to use this server's own address.
   */
  appUrl(path: string): string | null;
}

export function storeRouter(pool: Pool, opts: StoreOptions): express.Router {
  const router = express.Router();

  function returnUrl(req: Request, query: string): string {
    // {CHECKOUT_SESSION_ID} is filled in by Stripe, so it stays unencoded.
    const viaPlatform = opts.appUrl('/store?checkout=');
    if (viaPlatform) return viaPlatform + query;
    return `${req.protocol}://${req.get('host')}/store?checkout=${query}`;
  }

  // Guests may look: the packages and whether payments are set up.
  router.get('/store', (_req, res) => {
    res.json({ packages: COIN_PACKAGES, paymentsConfigured: paymentsConfigured(opts.payments) });
  });

  router.post('/store/checkout', requireUser, wrap(async (req, res) => {
    const pkg = COIN_PACKAGES.find((p) => p.id === req.body?.packageId);
    if (!pkg) return void res.status(400).json({ error: 'invalid_package' });
    const stripe = opts.payments.stripe();
    if (!stripe || !paymentsConfigured(opts.payments)) {
      return void res.status(503).json({ error: 'payments_not_configured' });
    }
    const me = userId(req)!;
    await ensureProfile(pool, me, String(req.user!.username));
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: pkg.currency,
          unit_amount: pkg.amountCents,
          product_data: { name: `${pkg.coins.toLocaleString('en-US')} coins` },
        },
      }],
      client_reference_id: String(me),
      metadata: { app: CHECKOUT_APP_TAG, userId: String(me), packageId: pkg.id },
      success_url: returnUrl(req, '{CHECKOUT_SESSION_ID}'),
      cancel_url: returnUrl(req, 'cancelled'),
    });
    await recordPurchase(pool, me, session.id, pkg);
    res.json({ url: session.url, sessionId: session.id });
  }));

  // Where a purchase stands. While it is pending, ask Stripe too, so coins
  // arrive even if the webhook is slow; crediting twice is impossible.
  router.get('/store/purchases/:sessionId', requireUser, wrap(async (req, res) => {
    const me = userId(req)!;
    const sessionId = String(req.params.sessionId);
    let purchase = await getPurchase(pool, me, sessionId);
    if (!purchase) return void res.status(404).json({ error: 'not_found' });
    const stripe = opts.payments.stripe();
    if (purchase.status === 'pending' && stripe) {
      const s = await stripe.checkout.sessions.retrieve(sessionId);
      if (s.payment_status === 'paid') {
        await creditPurchase(pool, sessionId, null, null, s.amount_total, s.currency);
        purchase = (await getPurchase(pool, me, sessionId))!;
      }
    }
    const bal = await pool.query('SELECT coin_balance FROM profiles WHERE id = $1', [me]);
    res.json({ status: purchase.status, coins: purchase.coins, coinBalance: bal.rows[0]?.coin_balance ?? 0 });
  }));

  return router;
}
