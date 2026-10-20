// POST /api/stripe/webhook: Stripe tells us a Checkout Session was paid.
// Mounted in app/server.ts BEFORE express.json(), with express.raw(), because
// the signature is over the exact bytes Stripe sent. Open without a platform
// token (PUBLIC_API_PATHS); the signature is the authentication.

import type { Request, Response } from 'express';
import type Stripe from 'stripe';
import type { Pool } from 'pg';
import { wrap } from '../../lib/auth';
import { creditPurchase } from '../../lib/coins';
import { paymentsConfigured, type Payments } from '../../lib/stripe';
import { CHECKOUT_APP_TAG } from './store';

const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

export function stripeWebhook(pool: Pool, payments: Payments) {
  return wrap(async (req: Request, res: Response) => {
    const stripe = payments.stripe();
    // 503 so Stripe retries once the secrets are set.
    if (!stripe || !paymentsConfigured(payments)) return void res.status(503).json({ error: 'payments_not_configured' });
    let event: Stripe.Event;
    try {
      if (!Buffer.isBuffer(req.body)) throw new Error('no raw body');
      event = stripe.webhooks.constructEvent(
        req.body, String(req.headers['stripe-signature'] || ''), payments.webhookSecret());
    } catch {
      console.warn('stripe webhook: signature check failed');
      return void res.status(400).json({ error: 'invalid_signature' });
    }
    if (!PAID_EVENTS.has(event.type)) return void res.json({ received: true });
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== 'paid') return void res.json({ received: true });

    const r = await creditPurchase(
      pool, session.id, event.id, event.type, session.amount_total, session.currency);
    if (r.result === 'unknown_session') {
      // Ours but not recorded yet: fail so Stripe retries. Someone else's: ignore.
      if (session.metadata?.app === CHECKOUT_APP_TAG) return void res.status(409).json({ error: 'unknown_session' });
      return void res.json({ received: true });
    }
    if (r.result === 'amount_mismatch') console.error(`stripe webhook: amount mismatch for ${session.id}`);
    res.json({ received: true, result: r.result });
  });
}
