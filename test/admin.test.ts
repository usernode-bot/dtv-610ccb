// Admin access against a real Postgres: ADMIN_USERNAMES, the role and ban
// guards, the dashboard numbers and user management, and the series manager
// (in its own schema so it cannot change the counts the other tests assert).
//   DATABASE_URL=postgres://... npm test
// Skipped (not failed) when DATABASE_URL is unset.
import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { migrate } from '../lib/schema';
import { DEMO_ACCOUNTS, seedDemoAccounts, seedDemoCatalogue } from '../lib/seed';
import { getEpisode, getSeries, listEpisodes, listSeries, setFollow } from '../lib/catalogue';
import { ensureProfile, listFollowed } from '../lib/me';
import {
  adjustCoins, configuredAdmins, dashboardStats, parseDuration, setBanned, setRole, validateEpisodes,
  validateSeries,
} from '../lib/admin';
import { adminPageGuard, attachAccount, upsertProfileOnce } from '../lib/auth';
import { adminRouter } from '../app/routes/admin';
import { catalogueRouter } from '../app/routes/catalogue';
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

const SCHEMA = 'admin_series_test';
// One id per test person, so each gets their own profile (and role from ADMIN_USERNAMES).
const SERIES_USERS: Record<string, number> = { boss: 4301, other: 4302, someone: 4303 };

const FORM = {
  title: 'Staging demo licensed drama', originalTitle: '测试', country: 'china', format: 'long',
  genres: ['romance', 'office'], year: '2025', description: 'A made-up series for testing.',
  posterUrl: 'https://example.com/poster.jpg', bannerUrl: null, totalEpisodes: '3',
};
const ROW = { videoUrl: 'https://example.com/1.m3u8', duration: '45:00', subtitleLang: 'id', free: true };

test('validation names every failing field with a message', () => {
  const empty = validateSeries({}, ['romance']);
  assert.ok('fields' in empty);
  assert.deepStrictEqual(Object.keys(empty.fields).sort(),
    ['country', 'description', 'format', 'genres', 'title', 'totalEpisodes', 'year']);
  assert.strictEqual(empty.fields.title, 'Enter a title.');

  const bad = validateSeries({ ...FORM, year: '1800', genres: ['nope'], posterUrl: 'javascript:x', totalEpisodes: '2' },
    ['romance', 'office'], 5);
  assert.ok('fields' in bad);
  assert.strictEqual(bad.fields.year, 'Enter a year from 1900 to 2100.');
  assert.strictEqual(bad.fields.genres, 'Pick genres from the list.');
  assert.ok(bad.fields.posterUrl);
  assert.strictEqual(bad.fields.totalEpisodes, 'This series already has 5 episodes. Enter 5 or more.');

  const ok = validateSeries(FORM, ['romance', 'office']);
  assert.ok('value' in ok);
  assert.strictEqual(ok.value.year, 2025);
  assert.strictEqual(ok.value.bannerUrl, null);

  assert.strictEqual(parseDuration('45:00'), 2700);
  assert.strictEqual(parseDuration('1:02:03'), 3723);
  assert.strictEqual(parseDuration('2'), 120);
  assert.ok(Number.isNaN(parseDuration('45 min')));

  const rows = validateEpisodes({ episodes: [ROW, { videoUrl: 'http://x', duration: '', subtitleLang: 'fr' }] });
  assert.ok('fields' in rows);
  assert.deepStrictEqual(rows.fields, {
    'episodes.1.videoUrl': 'Enter a full link starting with https://.',
    'episodes.1.duration': 'Enter the duration.',
    'episodes.1.subtitleLang': 'Choose a subtitle language.',
  });
});

test('series manager: admins only; added series stay hidden until published; edit, episodes, delete', opts, async () => {
  const setup = new Pool({ connectionString: url });
  await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await setup.query(`CREATE SCHEMA ${SCHEMA}`);
  await setup.end();
  const pool = new Pool({ connectionString: url, options: `-c search_path=${SCHEMA}` });
  const prevAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = 'Boss, @other';

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const name = req.headers['x-test-user'];
    if (name) req.user = { id: SERIES_USERS[String(name).toLowerCase()], username: String(name), usernode_pubkey: null, locale: null, pur: 'iframe' };
    next();
  });
  app.use(upsertProfileOnce(pool));
  app.use(attachAccount(pool));
  app.use('/api/admin', adminRouter(pool));
  app.use('/api', catalogueRouter(pool, { isStaging: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (p: string, method: string, user?: string, body?: unknown) => fetch(base + p, {
    method,
    headers: { ...(user ? { 'x-test-user': user } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  try {
    await migrate(pool);
    await migrate(pool);
    await pool.query(`INSERT INTO genres (slug, name) VALUES ('romance', 'Romance'), ('office', 'Office')`);
    // A series from before the manager stays published.
    await pool.query(`INSERT INTO series (slug, title) VALUES ('older-series', 'Older series')`);
    assert.deepStrictEqual((await listSeries(pool, null)).map((s) => s.slug), ['older-series']);

    // Guests and members who are not admins are refused.
    assert.strictEqual((await send('/api/admin/series', 'GET')).status, 403);
    assert.deepStrictEqual(await (await send('/api/admin/series', 'POST', 'someone', FORM)).json(), { error: 'admin_only' });
    assert.strictEqual((await send('/api/admin/series', 'GET', 'boss')).status, 200);

    // Bad input answers per field.
    const invalid = await send('/api/admin/series', 'POST', 'BOSS', { ...FORM, title: ' ', year: 'soon' });
    assert.strictEqual(invalid.status, 400);
    assert.deepStrictEqual(((await invalid.json()) as any).fields,
      { title: 'Enter a title.', year: 'Enter a year from 1900 to 2100.' });

    const created = await send('/api/admin/series', 'POST', 'other', FORM);
    assert.strictEqual(created.status, 201);
    const s = ((await created.json()) as any).series;
    assert.strictEqual(s.isPublished, false);
    assert.deepStrictEqual(s.genres, ['romance', 'office']);
    const row = (await pool.query('SELECT slug, genre, genres, synopsis, release_year, poster_url FROM series WHERE id = $1', [s.id])).rows[0];
    assert.deepStrictEqual(row, {
      slug: 'staging-demo-licensed-drama', genre: 'Romance', genres: ['Romance', 'Office'],
      synopsis: FORM.description, release_year: 2025, poster_url: FORM.posterUrl,
    });

    // Unpublished: not in browse, detail, episodes or related for anyone.
    assert.strictEqual((await listSeries(pool, null)).some((x) => x.id === s.id), false);
    assert.strictEqual(await getSeries(pool, row.slug, null), null);
    assert.strictEqual((await send(`/api/series/${row.slug}`, 'GET')).status, 404);

    // Publishing needs an episode.
    const early = await send(`/api/admin/series/${s.id}/published`, 'PUT', 'boss', { published: true });
    assert.strictEqual(early.status, 400);
    assert.deepStrictEqual(((await early.json()) as any).fields, { published: 'Add at least one episode before publishing.' });

    // Bulk episodes: numbered on, priced by format, capped at total_episodes.
    const tooMany = await send(`/api/admin/series/${s.id}/episodes`, 'POST', 'boss', { episodes: [ROW, ROW, ROW, ROW] });
    assert.strictEqual(tooMany.status, 400);
    assert.match(((await tooMany.json()) as any).fields.episodes, /room for 3 more/);
    const added = await send(`/api/admin/series/${s.id}/episodes`, 'POST', 'boss',
      { episodes: [ROW, { ...ROW, duration: '50:30', subtitleLang: 'ko', free: false }] });
    assert.strictEqual(added.status, 201);
    const eps = (await pool.query(
      'SELECT number, title, duration_seconds, coin_price, subtitle_langs FROM episodes WHERE series_id = $1 ORDER BY number', [s.id])).rows;
    assert.deepStrictEqual(eps, [
      { number: 1, title: 'Episode 1', duration_seconds: 2700, coin_price: 0, subtitle_langs: ['id'] },
      { number: 2, title: 'Episode 2', duration_seconds: 3030, coin_price: 15, subtitle_langs: ['ko'] },
    ]);

    // Edit: total cannot drop below the episodes already added; the slug stays.
    const shrink = await send(`/api/admin/series/${s.id}`, 'PUT', 'boss', { ...FORM, totalEpisodes: '1' });
    assert.strictEqual(shrink.status, 400);
    const edited = await send(`/api/admin/series/${s.id}`, 'PUT', 'boss', { ...FORM, title: 'Renamed demo', format: 'short', totalEpisodes: 10 });
    assert.strictEqual(edited.status, 200);
    assert.strictEqual(((await edited.json()) as any).series.title, 'Renamed demo');
    assert.strictEqual((await pool.query('SELECT slug FROM series WHERE id = $1', [s.id])).rows[0].slug, row.slug);

    // Published: visible, with its episodes.
    const pub = await send(`/api/admin/series/${s.id}/published`, 'PUT', 'boss', { published: true });
    assert.deepStrictEqual(await pub.json(), { published: true });
    assert.strictEqual((await getSeries(pool, row.slug, null))!.title, 'Renamed demo');
    const visible = (await listEpisodes(pool, row.slug, null))!;
    assert.strictEqual(visible.length, 2);

    // Unpublished again: gone from the viewer side, follows included.
    await ensureProfile(pool, 4242, 'staging-test');
    await setFollow(pool, row.slug, 4242, true);
    await send(`/api/admin/series/${s.id}/published`, 'PUT', 'boss', { published: false });
    assert.strictEqual(await listEpisodes(pool, row.slug, null), null);
    assert.strictEqual(await getEpisode(pool, visible[0].id, null), null);
    assert.deepStrictEqual(await listFollowed(pool, 4242), []);
    const list = ((await (await send('/api/admin/series', 'GET', 'boss')).json()) as any).series;
    assert.deepStrictEqual(list.map((x: any) => [x.title, x.isPublished, x.episodeCount]),
      [['Renamed demo', false, 2], ['Older series', true, 0]]);

    // Delete an episode, then the series with what is left.
    assert.strictEqual((await send(`/api/admin/episodes/${visible[1].id}`, 'DELETE', 'boss')).status, 200);
    assert.strictEqual((await send(`/api/admin/series/${s.id}`, 'DELETE', 'boss')).status, 200);
    assert.strictEqual((await pool.query('SELECT COUNT(*)::int AS n FROM episodes')).rows[0].n, 0);
    assert.strictEqual((await send(`/api/admin/series/${s.id}`, 'GET', 'boss')).status, 404);
  } finally {
    if (prevAdmins === undefined) delete process.env.ADMIN_USERNAMES; else process.env.ADMIN_USERNAMES = prevAdmins;
    server.close();
    await pool.end();
  }
});
