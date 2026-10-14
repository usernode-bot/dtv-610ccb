// Stripe, for the coin store. Payments are "configured" only when both the
// secret key and the webhook signing secret are set (dapp.json secrets);
// otherwise the store says so and nothing calls Stripe.

import Stripe from 'stripe';

/** What the store needs from Stripe; tests pass their own. */
export interface Payments {
  /** The Stripe client, or null when STRIPE_SECRET_KEY is not set. */
  stripe(): Stripe | null;
  /** STRIPE_WEBHOOK_SECRET, or '' when it is not set. */
  webhookSecret(): string;
}

let client: Stripe | null = null;
let clientKey = '';

export const livePayments: Payments = {
  stripe() {
    const key = process.env.STRIPE_SECRET_KEY || '';
    if (!key) return null;
    if (!client || clientKey !== key) {
      client = new Stripe(key);
      clientKey = key;
    }
    return client;
  },
  webhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET || '';
  },
};

export function paymentsConfigured(p: Payments): boolean {
  return !!(p.webhookSecret() && p.stripe());
}
