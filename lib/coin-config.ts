// Monetization constants, in one place. The check-in rewards are also written
// into dtv_claim_check_in (lib/schema.ts) when the schema runs, so the function
// and the screen always agree.

import type { CoinPackage } from '../types';

/** Coins for each day of the 7-day check-in streak (day 1 first). */
export const CHECK_IN_REWARDS = [10, 10, 15, 15, 20, 20, 50];

/** What the coin store sells. Prices are charged in Stripe Checkout as written here. */
export const COIN_PACKAGES: CoinPackage[] = [
  { id: 'coins-100', coins: 100, amountCents: 99, currency: 'usd' },
  { id: 'coins-500', coins: 500, amountCents: 499, currency: 'usd' },
  { id: 'coins-1200', coins: 1200, amountCents: 999, currency: 'usd' },
  { id: 'coins-3000', coins: 3000, amountCents: 1999, currency: 'usd' },
];
