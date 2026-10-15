// Phase 6 coin logic against a real Postgres: every balance change goes
// through a dtv_* function, so races charge or credit at most once.
//   DATABASE_URL=postgres://... npm test
import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import Stripe from 'stripe';
import { migrate } from '../lib/schema';
import { DEMO_SERIES, seedDemoCatalogue } from '../lib/seed';
import { getSeries, listEpisodes } from '../lib/catalogue';
import { claimCheckIn, ensureProfile, getCheckIn, listCoinTransactions, unlockEpisode } from '../lib/me';
import { unlockSeriesBundle, recordPurchase, creditPurchase } from '../lib/coins';
import { AD_DAILY_LIMIT, completeAdSession, startAdSession } from '../lib/ads';
import { COIN_PACKAGES } from '../lib/coin-config';
import type { Payments } from '../lib/stripe';
import { catalogueRouter } from '../app/routes/catalogue';
import { meRouter } from '../app/routes/me';
import { adsRouter } from '../app/routes/ads';
import { storeRouter } from '../app/routes/store';
import { stripeWebhook } from '../app/routes/stripe-webhook';

const url = process.env.DATABASE_URL;
const opts = { skip: url ? false : 'DATABASE_URL not set' };
const C = 987654331;
const D = 987654332;

async function freshPerson(pool: Pool, id: number, coins: number): Promise<void> {
  await pool.query('DELETE FROM coin_transactions WHERE user_id = $1', [id]);
  await pool.query('DELETE FROM profiles WHERE id = $1', [id]);
  await ensureProfile(pool, id, 'staging-test-' + id);
  await pool.query('UPDATE profiles SET coin_balance = $2 WHERE id = $1', [id, coins]);
}

async function balance(pool: Pool, id: number): Promise<number> {
  return (await pool.query('SELECT coin_balance FROM profiles WHERE id = $1', [id])).rows[0].coin_balance;
}

async function ledgerSum(pool: Pool, id: number): Promise<number> {
  return (await pool.query('SELECT COALESCE(SUM(amount), 0)::int AS s FROM coin_transactions WHERE user_id = $1', [id])).rows[0].s;
}

test('coin unlocks: parallel spends never overdraw, a double tap charges once', opts, async () => {
  const pool = new Pool({ connectionString: url, max: 12 });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    await freshPerson(pool, C, 10);
    const eps = (await listEpisodes(pool, DEMO_SERIES[0].slug, C))!;
    const [a, b] = [eps[3], eps[4]];
    assert.strictEqual(a.coinPrice, 10);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      unlockEpisode(pool, C, (i % 2 ? a : b).id)));
    const paid = await pool.query(`SELECT COUNT(*)::int AS n FROM coin_transactions WHERE user_id = $1`, [C]);
    assert.strictEqual(paid.rows[0].n, 1);
    assert.strictEqual(await balance(pool, C), 0);
    assert.strictEqual(await ledgerSum(pool, C), -10);
    assert.ok(results.some((r) => r === 'not_enough_coins'));

    await freshPerson(pool, C, 30);
    await pool.query('DELETE FROM unlocked_episodes WHERE user_id = $1', [C]);
    await Promise.all([unlockEpisode(pool, C, a.id), unlockEpisode(pool, C, a.id), unlockEpisode(pool, C, a.id)]);
    assert.strictEqual(await balance(pool, C), 20);
    const m = await pool.query('SELECT method FROM unlocked_episodes WHERE user_id = $1', [C]);
    assert.deepStrictEqual(m.rows, [{ method: 'coins' }]);
  } finally {
    await pool.end();
  }
});

test('bundle: 20% off the remaining paid episodes, refused at a stale price', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    const slug = DEMO_SERIES[0].slug; // 17 paid episodes at 10 coins
    await freshPerson(pool, C, 200);
    await pool.query('DELETE FROM unlocked_episodes WHERE user_id = $1', [C]);
    const eps = (await listEpisodes(pool, slug, C))!;
    assert.deepStrictEqual((await getSeries(pool, slug, null))!.bundle,
      { episodeCount: 17, fullPrice: 170, price: 136, savings: 34 });
    await unlockEpisode(pool, C, eps[3].id);
    const quote = (await getSeries(pool, slug, C))!.bundle!;
    assert.deepStrictEqual(quote, { episodeCount: 16, fullPrice: 160, price: 128, savings: 32 });

    const stale = await unlockSeriesBundle(pool, C, slug, 136);
    assert.strictEqual(stale.status, 'price_changed');
    assert.strictEqual(await balance(pool, C), 190);

    await pool.query('UPDATE profiles SET coin_balance = 100 WHERE id = $1', [C]);
    assert.strictEqual((await unlockSeriesBundle(pool, C, slug, 128)).status, 'not_enough_coins');
    await pool.query('UPDATE profiles SET coin_balance = 190 WHERE id = $1', [C]);

    const [r1, r2] = await Promise.all([unlockSeriesBundle(pool, C, slug, 128), unlockSeriesBundle(pool, C, slug, 128)]);
    assert.deepStrictEqual([r1.status, r2.status].sort(), ['nothing_to_unlock', 'ok']);
    assert.strictEqual(await balance(pool, C), 62);
    const rows = await pool.query(
      `SELECT method, COUNT(*)::int AS n FROM unlocked_episodes WHERE user_id = $1 GROUP BY method ORDER BY method`, [C]);
    assert.deepStrictEqual(rows.rows, [{ method: 'bundle', n: 16 }, { method: 'coins', n: 1 }]);
    assert.strictEqual((await getSeries(pool, slug, C))!.bundle, null);
    assert.ok((await listEpisodes(pool, slug, C))!.every((e) => e.state !== 'locked'));

    const page = await listCoinTransactions(pool, C);
    assert.strictEqual(page.transactions[0].label, `Unlocked 16 episodes of ${DEMO_SERIES[0].title}`);
    assert.strictEqual(page.transactions[1].label, `Unlocked ${DEMO_SERIES[0].title}, episode 4`);
    assert.strictEqual(await ledgerSum(pool, C), -128 - 10);
  } finally {
    await pool.end();
  }
});

test('daily check-in: once a day, a 7-day streak that resets on a gap', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await freshPerson(pool, C, 0);
    await pool.query('DELETE FROM daily_check_ins WHERE user_id = $1', [C]);

    assert.deepStrictEqual(await getCheckIn(pool, C, '2026-10-01'),
      { streakDay: 0, claimedToday: false, nextDay: 1, nextReward: 10, rewards: [10, 10, 15, 15, 20, 20, 50] });
    const same = await Promise.all([1, 2, 3].map(() => claimCheckIn(pool, C, '2026-10-01')));
    assert.strictEqual(same.filter((r) => r !== 'already_claimed').length, 1);
    assert.strictEqual(await balance(pool, C), 10);
    assert.strictEqual((await getCheckIn(pool, C, '2026-10-01')).claimedToday, true);

    const got: number[] = [];
    for (const d of ['02', '03', '04', '05', '06', '07', '08']) {
      const r = await claimCheckIn(pool, C, `2026-10-${d}`);
      assert.ok(typeof r === 'object');
      got.push(r.reward);
    }
    // Days 2..7, then day 8 starts the cycle again at day 1.
    assert.deepStrictEqual(got, [10, 15, 15, 20, 20, 50, 10]);
    const state = await getCheckIn(pool, C, '2026-10-09');
    assert.deepStrictEqual([state.streakDay, state.nextDay, state.nextReward], [1, 2, 10]);

    // A missed day starts again from day 1.
    assert.strictEqual((await getCheckIn(pool, C, '2026-10-11')).nextDay, 1);
    const reset = await claimCheckIn(pool, C, '2026-10-11');
    assert.ok(typeof reset === 'object' && reset.streakDay === 1 && reset.reward === 10);
    assert.strictEqual(await balance(pool, C), await ledgerSum(pool, C));
    const page = await listCoinTransactions(pool, C);
    assert.strictEqual(page.transactions[0].label, 'Daily check-in, day 1');
    assert.strictEqual(page.transactions[1].label, 'Daily check-in, day 1');
    assert.strictEqual(page.transactions[2].label, 'Daily check-in, day 7');

    // A reboot keeps the new ledger types (the boot-time type clean-up must know them).
    await migrate(pool);
    const types = await pool.query(`SELECT DISTINCT type FROM coin_transactions WHERE user_id = $1`, [C]);
    assert.deepStrictEqual(types.rows, [{ type: 'check_in' }]);
  } finally {
    await pool.end();
  }
});

test('rewarded ad: unlock only after the ad ran, once, and within the daily limit', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    await freshPerson(pool, C, 0);
    await freshPerson(pool, D, 0);
    await pool.query('DELETE FROM unlocked_episodes WHERE user_id = $1', [C]);
    const eps = (await listEpisodes(pool, DEMO_SERIES[2].slug, C))!.filter((e) => e.state === 'locked');
    const day = '2026-10-11';
    const back = (id: string) => pool.query(`UPDATE ad_sessions SET started_at = started_at - interval '6 seconds' WHERE id = $1`, [id]);

    const s1 = await startAdSession(pool, C, eps[0].id, 'mock', day);
    assert.strictEqual((await completeAdSession(pool, C, s1, 5)).result, 'too_early');
    assert.strictEqual((await completeAdSession(pool, D, s1, 5)).result, 'not_found');
    await back(s1);
    const ok = await completeAdSession(pool, C, s1, 5);
    assert.deepStrictEqual(ok, { result: 'ok', episodeId: eps[0].id, remainingToday: AD_DAILY_LIMIT - 1 });
    assert.strictEqual((await completeAdSession(pool, C, s1, 5)).result, 'used');
    assert.strictEqual((await listEpisodes(pool, DEMO_SERIES[2].slug, C))!.find((e) => e.id === eps[0].id)!.state, 'unlocked');
    // An ad costs no coins and leaves no ledger row.
    assert.strictEqual(await balance(pool, C), 0);
    assert.strictEqual((await listCoinTransactions(pool, C)).transactions.length, 0);

    for (let i = 1; i < AD_DAILY_LIMIT; i++) {
      const s = await startAdSession(pool, C, eps[i].id, 'mock', day);
      await back(s);
      assert.strictEqual((await completeAdSession(pool, C, s, 5)).result, 'ok');
    }
    const over = await startAdSession(pool, C, eps[AD_DAILY_LIMIT].id, 'mock', day);
    await back(over);
    assert.strictEqual((await completeAdSession(pool, C, over, 5)).result, 'daily_limit');
    // The next day counts afresh.
    const tomorrow = await startAdSession(pool, C, eps[AD_DAILY_LIMIT].id, 'mock', '2026-10-12');
    await back(tomorrow);
    assert.strictEqual((await completeAdSession(pool, C, tomorrow, 5)).result, 'ok');
  } finally {
    await pool.end();
  }
});

const WEBHOOK_SECRET = 'whsec_test_dtv';
const stripeForTests = new Stripe('sk_test_dtv_dummy');

function signed(payload: object): { body: string; sig: string } {
  const body = JSON.stringify(payload);
  return { body, sig: stripeForTests.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET }) };
}

function paidEvent(id: string, session: string, amount: number, type = 'checkout.session.completed') {
  return {
    id, object: 'event', type,
    data: { object: { id: session, object: 'checkout.session', payment_status: 'paid', amount_total: amount, currency: 'usd', metadata: { app: 'dtv' } } },
  };
}

test('stripe webhook: signature checked, each event and session credits once', opts, async () => {
  const pool = new Pool({ connectionString: url });
  const created: string[] = [];
  const fakeStripe = Object.assign(Object.create(stripeForTests), {
    checkout: {
      sessions: {
        async create(params: any) {
          const id = 'cs_test_' + Math.random().toString(36).slice(2);
          created.push(params.success_url);
          return { id, url: 'https://checkout.stripe.test/' + id };
        },
        async retrieve(id: string) { return { id, payment_status: 'unpaid', amount_total: 499, currency: 'usd' }; },
      },
    },
  });
  let configured = true;
  const payments: Payments = {
    stripe: () => (configured ? fakeStripe : null),
    webhookSecret: () => (configured ? WEBHOOK_SECRET : ''),
  };
  const app = express();
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook(pool, payments));
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), username: 'staging-test-' + id, usernode_pubkey: null, locale: null, pur: 'iframe' };
    req.now = new Date('2026-10-11T12:00:00Z');
    next();
  });
  app.use('/api', storeRouter(pool, { payments, appUrl: (p) => 'https://homeroom.test/app/dtv/full?path=' + encodeURIComponent(p) }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const hook = (body: string, sig: string) => fetch(base + '/api/stripe/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body,
  });
  try {
    await migrate(pool);
    await freshPerson(pool, C, 0);
    await freshPerson(pool, D, 0);
    await pool.query('DELETE FROM coin_purchases WHERE user_id IN ($1, $2)', [C, D]);

    const store = await (await fetch(base + '/api/store')).json() as any;
    assert.strictEqual(store.paymentsConfigured, true);
    assert.deepStrictEqual(store.packages.map((p: any) => p.coins), [100, 500, 1200, 3000]);

    const post = (p: string, user: number, body: unknown) => fetch(base + p, {
      method: 'POST', headers: { 'x-test-user': String(user), 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.strictEqual((await post('/api/store/checkout', C, { packageId: 'coins-7' })).status, 400);
    const co = await (await post('/api/store/checkout', C, { packageId: 'coins-500' })).json() as any;
    assert.ok(co.url.startsWith('https://checkout.stripe.test/'));
    assert.strictEqual(created[0], 'https://homeroom.test/app/dtv/full?path=%2Fstore%3Fcheckout%3D{CHECKOUT_SESSION_ID}');
    const sid: string = co.sessionId;

    // Someone else cannot read it; the owner sees it pending (Stripe says unpaid).
    assert.strictEqual((await fetch(`${base}/api/store/purchases/${sid}`, { headers: { 'x-test-user': String(D) } })).status, 404);
    const pending = await (await fetch(`${base}/api/store/purchases/${sid}`, { headers: { 'x-test-user': String(C) } })).json() as any;
    assert.deepStrictEqual(pending, { status: 'pending', coins: 500, coinBalance: 0 });

    // A forged or tampered request credits nothing.
    const ev = signed(paidEvent('evt_1', sid, 499));
    assert.strictEqual((await hook(ev.body, 't=1,v1=deadbeef')).status, 400);
    assert.strictEqual((await hook(ev.body.replace('499', '498'), ev.sig)).status, 400);
    assert.strictEqual(await balance(pool, C), 0);

    // The same event twice, and a second event for the same session: credited once.
    assert.strictEqual((await hook(ev.body, ev.sig)).status, 200);
    assert.strictEqual((await hook(ev.body, ev.sig)).status, 200);
    const ev2 = signed(paidEvent('evt_2', sid, 499, 'checkout.session.async_payment_succeeded'));
    assert.strictEqual((await hook(ev2.body, ev2.sig)).status, 200);
    assert.strictEqual(await balance(pool, C), 500);
    const page = await listCoinTransactions(pool, C);
    assert.deepStrictEqual(page.transactions.map((t) => [t.type, t.amount, t.label]), [['purchase', 500, 'Bought 500 coins']]);

    // Parallel retries of a fresh session still credit once.
    await recordPurchase(pool, D, 'cs_test_parallel', COIN_PACKAGES[2]);
    const evs = [1, 2, 3, 4].map((i) => signed(paidEvent('evt_p' + i, 'cs_test_parallel', 999)));
    await Promise.all(evs.map((e) => hook(e.body, e.sig)));
    assert.strictEqual(await balance(pool, D), 1200);
    // Polling Stripe after the webhook changes nothing.
    assert.strictEqual((await creditPurchase(pool, 'cs_test_parallel', null, null, 999, 'usd')).result, 'duplicate');

    // A paid amount that does not match the package credits nothing.
    await recordPurchase(pool, D, 'cs_test_wrong', COIN_PACKAGES[0]);
    const wrong = signed(paidEvent('evt_wrong', 'cs_test_wrong', 1));
    assert.strictEqual((await hook(wrong.body, wrong.sig)).status, 200);
    assert.strictEqual(await balance(pool, D), 1200);
    // Our own session not recorded yet: Stripe is asked to retry.
    const early = signed(paidEvent('evt_early', 'cs_test_unknown', 99));
    assert.strictEqual((await hook(early.body, early.sig)).status, 409);

    // Without the Stripe secrets: the store says so, checkout and webhook refuse.
    configured = false;
    assert.strictEqual(((await (await fetch(base + '/api/store')).json()) as any).paymentsConfigured, false);
    const off = await post('/api/store/checkout', C, { packageId: 'coins-100' });
    assert.strictEqual(off.status, 503);
    assert.strictEqual(((await off.json()) as any).error, 'payments_not_configured');
    assert.strictEqual((await hook(ev.body, ev.sig)).status, 503);
  } finally {
    server.close();
    await pool.end();
  }
});

test('routes: check-in, unlock-all and ads over HTTP; guests get account_required', opts, async () => {
  const pool = new Pool({ connectionString: url });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), username: 'staging-test-' + id, usernode_pubkey: null, locale: null, pur: 'iframe' };
    req.now = new Date(String(req.headers['x-test-now'] || '2026-10-11T12:00:00Z'));
    next();
  });
  app.use('/api/me', meRouter(pool));
  app.use('/api/ads', adsRouter(pool));
  app.use('/api', catalogueRouter(pool, { isStaging: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (p: string, method: string, user?: number, body?: unknown) => fetch(base + p, {
    method,
    headers: { ...(user ? { 'x-test-user': String(user) } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    await freshPerson(pool, C, 0);
    await pool.query('DELETE FROM daily_check_ins WHERE user_id = $1', [C]);
    await pool.query('DELETE FROM unlocked_episodes WHERE user_id = $1', [C]);
    await pool.query('DELETE FROM ad_sessions WHERE user_id = $1', [C]);
    const slug = DEMO_SERIES[0].slug;

    const claimed = await (await send('/api/me/check-in', 'POST', C)).json() as any;
    assert.deepStrictEqual([claimed.reward, claimed.coinBalance, claimed.checkIn.claimedToday], [10, 10, true]);
    assert.strictEqual((await send('/api/me/check-in', 'POST', C)).status, 409);

    const detail = await (await send(`/api/series/${slug}`, 'GET', C)).json() as any;
    assert.strictEqual(detail.series.bundle.price, 136);
    const short = await send(`/api/series/${slug}/unlock-all`, 'POST', C, { expectedPrice: 136 });
    assert.strictEqual(short.status, 402);
    const stale = await send(`/api/series/${slug}/unlock-all`, 'POST', C, { expectedPrice: 1 });
    assert.strictEqual(stale.status, 409);
    assert.strictEqual(((await stale.json()) as any).bundle.price, 136);

    const locked = detail.series.episodes.find((e: any) => e.state === 'locked');
    const quota = await (await send('/api/ads/quota', 'GET', C)).json() as any;
    assert.deepStrictEqual(quota, { remainingToday: 5, dailyLimit: 5 });
    const started = await (await send('/api/ads/sessions', 'POST', C, { episodeId: locked.id })).json() as any;
    assert.deepStrictEqual([started.provider, started.minSeconds], ['mock', 5]);
    const early = await send(`/api/ads/sessions/${started.sessionId}/complete`, 'POST', C, {});
    assert.strictEqual(early.status, 425);
    await pool.query(`UPDATE ad_sessions SET started_at = started_at - interval '6 seconds' WHERE id = $1`, [started.sessionId]);
    const done = await (await send(`/api/ads/sessions/${started.sessionId}/complete`, 'POST', C, {})).json() as any;
    assert.strictEqual(done.episode.state, 'unlocked');
    assert.strictEqual((await send('/api/ads/sessions', 'POST', C, { episodeId: locked.id })).status, 409);
    assert.strictEqual((await send('/api/ads/sessions/not-a-uuid/complete', 'POST', C, {})).status, 404);

    const hist = await (await send('/api/me/coin-transactions', 'GET', C)).json() as any;
    assert.deepStrictEqual(hist.transactions.map((t: any) => t.label), ['Daily check-in, day 1']);
    assert.strictEqual(hist.nextBefore, null);

    const guestCases: Array<[string, string, string]> = [
      [`/api/series/${slug}/unlock-all`, 'POST', 'unlock these episodes'],
      ['/api/ads/sessions', 'POST', 'unlock an episode'],
      ['/api/me/check-in', 'POST', 'check in'],
    ];
    for (const [p, method, action] of guestCases) {
      const r = await send(p, method, undefined, {});
      assert.strictEqual(r.status, 401, p);
      assert.deepStrictEqual(await r.json(), { error: 'account_required', action });
    }
  } finally {
    server.close();
    await pool.end();
  }
});

test('transaction history pages 50 at a time', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await freshPerson(pool, D, 0);
    await pool.query(
      `INSERT INTO coin_transactions (user_id, amount, type, note)
       SELECT $1, 1, 'reward', 'Staging test reward ' || g FROM generate_series(1, 60) g`, [D]);
    const first = await listCoinTransactions(pool, D);
    assert.strictEqual(first.transactions.length, 50);
    assert.strictEqual(first.transactions[0].label, 'Staging test reward 60');
    const second = await listCoinTransactions(pool, D, first.nextBefore!);
    assert.strictEqual(second.transactions.length, 10);
    assert.strictEqual(second.nextBefore, null);
    assert.strictEqual(second.transactions[9].label, 'Staging test reward 1');
  } finally {
    await pool.end();
  }
});

test('new monetization tables are private', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    const marks = await pool.query(
      `SELECT relname FROM pg_class WHERE obj_description(oid) = 'staging:private'`);
    for (const t of ['daily_check_ins', 'ad_sessions', 'coin_purchases', 'stripe_events']) {
      assert.ok(marks.rows.some((r) => r.relname === t), `${t} is private`);
    }
  } finally {
    await pool.end();
  }
});
