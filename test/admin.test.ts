// Admin access against a real Postgres: ADMIN_USERNAMES, the role and ban
// guards, the dashboard numbers and user management.
//   DATABASE_URL=postgres://... npm test
// Skipped (not failed) when DATABASE_URL is unset.
import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { migrate } from '../lib/schema';
import { DEMO_ACCOUNTS, seedDemoAccounts, seedDemoCatalogue } from '../lib/seed';
import { adjustCoins, configuredAdmins, dashboardStats, setBanned, setRole } from '../lib/admin';
import { adminPageGuard, attachAccount, upsertProfileOnce } from '../lib/auth';
import { adminRouter } from '../app/routes/admin';
import { meRouter } from '../app/routes/me';

const url = process.env.DATABASE_URL;
const opts = { skip: url ? false : 'DATABASE_URL not set' };
const ADMIN = 987650001; // listed in ADMIN_USERNAMES below
const MEMBER = 987650002;
const OTHER = 987650003;
const NAMES: Record<number, string> = {
  [ADMIN]: 'Staging-Test-Admin', [MEMBER]: 'staging-test-member', [OTHER]: 'staging-test-other',
};

test('ADMIN_USERNAMES parsing', () => {
  assert.deepStrictEqual([...configuredAdmins(' @Alice, bob  carol,')], ['alice', 'bob', 'carol']);
  assert.strictEqual(configuredAdmins('').size, 0);
});

test('admin routes and pages are admin-only; banned people are refused', opts, async () => {
  const prev = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = 'staging-test-admin';
  const pool = new Pool({ connectionString: url });
  const app = express();
  app.use(express.json());
  // Stand-in for the platform token middleware: x-test-user picks the person.
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), username: NAMES[Number(id)], usernode_pubkey: null, locale: null, pur: 'iframe' };
    req.now = new Date();
    next();
  });
  app.use(upsertProfileOnce(pool));
  app.use(attachAccount(pool));
  app.use('/api/me', meRouter(pool));
  app.use('/api/admin', adminRouter(pool));
  app.get(/^\/admin(?:\/|$)/, adminPageGuard);
  app.get('*', (_req, res) => res.send('shell'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (p: string, user?: number, method = 'GET', body?: unknown) => fetch(base + p, {
    method, redirect: 'manual',
    headers: { ...(user ? { 'x-test-user': String(user) } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await migrate(pool);
    await pool.query('DELETE FROM coin_transactions WHERE user_id = ANY($1::bigint[])', [[ADMIN, MEMBER, OTHER]]);
    await pool.query('DELETE FROM profiles WHERE id = ANY($1::bigint[])', [[ADMIN, MEMBER, OTHER]]);

    // Signing in creates the profile; ADMIN_USERNAMES (case-insensitive) makes it an admin.
    const adminMe = await (await send('/api/me', ADMIN)).json() as any;
    assert.strictEqual(adminMe.profile.role, 'admin');
    const memberMe = await (await send('/api/me', MEMBER)).json() as any;
    assert.strictEqual(memberMe.profile.role, 'user');
    await send('/api/me', OTHER);

    // Non-admins and signed-out visitors get 403 from the API and are sent home from the pages.
    for (const who of [undefined, MEMBER]) {
      const r = await send('/api/admin/stats', who);
      assert.strictEqual(r.status, 403);
      assert.strictEqual(((await r.json()) as any).error, 'admin_only');
      assert.strictEqual((await send(`/api/admin/users/${OTHER}/coins`, who, 'POST', { amount: 5, reason: 'x' })).status, 403);
      const page = await send('/admin/users?token=t', who);
      assert.strictEqual(page.status, 302);
      assert.strictEqual(page.headers.get('location'), '/?token=t');
    }
    assert.strictEqual((await send('/admin', ADMIN)).status, 200);
    assert.strictEqual((await send('/administrator', MEMBER)).status, 200); // not an admin path
    const stats = await (await send('/api/admin/stats', ADMIN)).json() as any;
    assert.ok(stats.stats.totalUsers >= 3);

    // Search, and coins with a recorded reason.
    const found = await (await send('/api/admin/users?q=test-oth', ADMIN)).json() as any;
    assert.deepStrictEqual(found.users.map((u: any) => u.id), [OTHER]);
    assert.strictEqual((await send(`/api/admin/users/${OTHER}/coins`, ADMIN, 'POST', { amount: 25, reason: ' ' })).status, 400);
    const added = await (await send(`/api/admin/users/${OTHER}/coins`, ADMIN, 'POST', { amount: 25, reason: 'Refund for a stuck unlock' })).json() as any;
    assert.strictEqual(added.result.coinBalance, 25);
    const tooMuch = await send(`/api/admin/users/${OTHER}/coins`, ADMIN, 'POST', { amount: -30, reason: 'Correction' });
    assert.strictEqual(((await tooMuch.json()) as any).error, 'not_enough_coins');
    const detail = await (await send(`/api/admin/users/${OTHER}`, ADMIN)).json() as any;
    assert.deepStrictEqual(detail.transactions.map((t: any) => [t.amount, t.type, t.note]), [[25, 'admin', 'Refund for a stuck unlock']]);
    const actor = await pool.query('SELECT actor_id FROM coin_transactions WHERE user_id = $1', [OTHER]);
    assert.strictEqual(Number(actor.rows[0].actor_id), ADMIN);

    // Ban: the banned person's API calls are refused at once; unban restores them.
    const banned = await (await send(`/api/admin/users/${MEMBER}/ban`, ADMIN, 'PUT', { banned: true })).json() as any;
    assert.strictEqual(banned.user.banned, true);
    const refused = await send('/api/me', MEMBER);
    assert.strictEqual(refused.status, 403);
    assert.strictEqual(((await refused.json()) as any).error, 'banned');
    await send(`/api/admin/users/${MEMBER}/ban`, ADMIN, 'PUT', { banned: false });
    assert.strictEqual((await send('/api/me', MEMBER)).status, 200);

    // Promote and demote; the promoted person can open the admin API.
    await send(`/api/admin/users/${MEMBER}/role`, ADMIN, 'PUT', { role: 'admin' });
    assert.strictEqual((await send('/api/admin/stats', MEMBER)).status, 200);
    // Admins cannot be banned, nor can an ADMIN_USERNAMES admin be demoted, nor yourself.
    assert.strictEqual(await setBanned(pool, ADMIN, MEMBER, true), 'cannot_ban_admin');
    assert.strictEqual(await setRole(pool, MEMBER, ADMIN, 'user'), 'configured_admin');
    assert.strictEqual(await setRole(pool, ADMIN, ADMIN, 'user'), 'cannot_change_self');
    await send(`/api/admin/users/${MEMBER}/role`, MEMBER, 'PUT', { role: 'user' }).then((r) => assert.strictEqual(r.status, 400));
    await send(`/api/admin/users/${MEMBER}/role`, ADMIN, 'PUT', { role: 'user' });
    assert.strictEqual((await send('/api/admin/stats', MEMBER)).status, 403);
  } finally {
    server.close();
    await pool.end();
    if (prev === undefined) delete process.env.ADMIN_USERNAMES; else process.env.ADMIN_USERNAMES = prev;
  }
});

test('dashboard numbers come from the ledger, watch history and profiles', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    await seedDemoAccounts(pool);
    await seedDemoAccounts(pool); // idempotent
    const ids = DEMO_ACCOUNTS.map((a) => a.id);
    const ledger = await pool.query(
      `SELECT type, SUM(amount)::int AS total FROM coin_transactions WHERE user_id = ANY($1::bigint[]) GROUP BY type`, [ids]);
    const byType = Object.fromEntries(ledger.rows.map((r) => [r.type, r.total]));
    assert.strictEqual(byType.purchase, 380);
    assert.ok(byType.unlock < 0);

    const before = await dashboardStats(pool, new Date());
    assert.ok(before.totalUsers >= DEMO_ACCOUNTS.length);
    assert.ok(before.revenueCoins >= 380);
    assert.ok(before.coinsSpent >= -byType.unlock);
    assert.ok(before.topSeries.length > 0 && before.topSeries.length <= 5);

    // A purchase today counts towards today's revenue and daily actives; one
    // dated yesterday counts only towards the total.
    const U = 987650010;
    await pool.query('DELETE FROM coin_transactions WHERE user_id = $1', [U]);
    await pool.query('DELETE FROM profiles WHERE id = $1', [U]);
    await pool.query(`INSERT INTO profiles (id, username, created_at) VALUES ($1, 'staging-test-buyer', NOW() - INTERVAL '3 days')`, [U]);
    const mid = await dashboardStats(pool, new Date());
    await pool.query(`INSERT INTO coin_transactions (user_id, amount, type, created_at) VALUES ($1, 40, 'purchase', NOW() - INTERVAL '2 days')`, [U]);
    const old = await dashboardStats(pool, new Date());
    assert.strictEqual(old.revenueCoins, mid.revenueCoins + 40);
    assert.strictEqual(old.revenueCoinsToday, mid.revenueCoinsToday);
    assert.strictEqual(old.dailyActiveUsers, mid.dailyActiveUsers);
    await pool.query(`INSERT INTO coin_transactions (user_id, amount, type) VALUES ($1, 10, 'purchase')`, [U]);
    const now = await dashboardStats(pool, new Date());
    assert.strictEqual(now.revenueCoinsToday, mid.revenueCoinsToday + 10);
    assert.strictEqual(now.dailyActiveUsers, mid.dailyActiveUsers + 1);

    // An admin adjustment is recorded with its type and does not count as revenue.
    assert.deepStrictEqual(await adjustCoins(pool, 1, U, 5, 'Goodwill'), { coinBalance: 5 });
    assert.strictEqual((await dashboardStats(pool, new Date())).revenueCoins, now.revenueCoins);
    assert.strictEqual(await adjustCoins(pool, 1, U, 1.5, 'x'), 'invalid_amount');
  } finally {
    await pool.end();
  }
});
