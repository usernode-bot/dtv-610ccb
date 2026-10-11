// Runs the schema, seed, queries and routes against a real Postgres.
//   DATABASE_URL=postgres://... npm test
// Skipped (not failed) when DATABASE_URL is unset.
import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { migrate } from '../lib/schema';
import { DEMO_SERIES, EPISODES_PER_SERIES, seedDemoCatalogue } from '../lib/seed';
import { getSeries, listEpisodes, listGenres, listSeries, setFollow } from '../lib/catalogue';
import { ensureProfile, listFollowed, listWatchHistory, saveProgress } from '../lib/me';
import { getHomeFeed, listContinueWatching, listTrending } from '../lib/home';
import { catalogueRouter } from '../app/routes/catalogue';
import { meRouter } from '../app/routes/me';

const url = process.env.DATABASE_URL;
const opts = { skip: url ? false : 'DATABASE_URL not set' };
const A = 987654321;
const B = 987654322;
const C = 987654323;
const D = 987654324;

test('schema is re-runnable and the seed is idempotent: 5 demo series x 20 episodes', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await migrate(pool);
    await seedDemoCatalogue(pool);
    await seedDemoCatalogue(pool);

    const list = await listSeries(pool, null);
    const demo = list.filter((s) => s.isDemo);
    assert.strictEqual(demo.length, 5);
    for (const s of demo) assert.strictEqual(s.episodeCount, EPISODES_PER_SERIES);
    assert.strictEqual(demo.find((s) => s.slug === 'bakery-on-maple-street')!.freeEpisodeCount, 3);
    assert.ok((await listGenres(pool)).length >= 5);
    const ep = await pool.query(
      `SELECT video_url FROM episodes WHERE video_url IS NULL OR video_url NOT LIKE 'https://%.m3u8'`);
    assert.strictEqual(ep.rows.length, 0);

    // Private tables carry the marker; the ledger type is limited.
    const marks = await pool.query(
      `SELECT relname FROM pg_class WHERE obj_description(oid) = 'staging:private' ORDER BY relname`);
    for (const t of ['coin_transactions', 'profiles', 'unlocked_episodes', 'watch_history']) {
      assert.ok(marks.rows.some((r) => r.relname === t), `${t} is private`);
    }
    await assert.rejects(pool.query(
      `INSERT INTO coin_transactions (user_id, amount, type) VALUES (1, 5, 'gift')`));
  } finally {
    await pool.end();
  }
});

test('follows, unlocks and watch history are per person; locked streams stay hidden', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    for (const t of ['follows', 'watch_history', 'unlocked_episodes']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id IN ($1, $2)`, [A, B]);
    }
    await ensureProfile(pool, A, 'staging-test-a');
    await ensureProfile(pool, B, 'staging-test-b');

    const slug = DEMO_SERIES[0].slug;
    await setFollow(pool, slug, A, true);
    await setFollow(pool, slug, A, true);
    assert.strictEqual((await getSeries(pool, slug, A))!.following, true);
    assert.strictEqual((await getSeries(pool, slug, B))!.following, false);
    assert.strictEqual((await listFollowed(pool, A)).length, 1);
    assert.strictEqual((await listFollowed(pool, B)).length, 0);
    assert.strictEqual(await setFollow(pool, 'no-such-series', A, true), null);

    const eps = (await listEpisodes(pool, slug, A))!;
    assert.deepStrictEqual(eps.slice(0, 4).map((e) => e.state), ['free', 'free', 'free', 'locked']);
    assert.ok(eps[0].videoUrl);
    assert.strictEqual(eps[3].videoUrl, null);
    await pool.query('INSERT INTO unlocked_episodes (user_id, episode_id) VALUES ($1, $2)', [A, eps[3].id]);
    assert.strictEqual((await listEpisodes(pool, slug, A))![3].state, 'unlocked');
    assert.ok((await listEpisodes(pool, slug, A))![3].videoUrl);
    assert.strictEqual((await listEpisodes(pool, slug, B))![3].state, 'locked');

    assert.strictEqual(await saveProgress(pool, A, eps[0].id, 42, false), true);
    assert.strictEqual(await saveProgress(pool, A, eps[0].id, 90, true), true);
    assert.strictEqual(await saveProgress(pool, A, 999999999, 1, false), false);
    const h = await listWatchHistory(pool, A);
    assert.strictEqual(h.length, 1);
    assert.strictEqual(h[0].positionSeconds, 90);
    assert.strictEqual((await listWatchHistory(pool, B)).length, 0);
  } finally {
    await pool.end();
  }
});

test('routes: catalogue is public, /api/me needs a signed-in person', opts, async () => {
  const pool = new Pool({ connectionString: url });
  const app = express();
  app.use(express.json());
  // Stand-in for the platform token middleware: x-test-user picks the person.
  app.use((req, _res, next) => {
    req.now = new Date();
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), username: 'staging-test-' + id, usernode_pubkey: null, locale: null, pur: 'iframe' };
    next();
  });
  app.use('/api/me', meRouter(pool));
  app.use('/api', catalogueRouter(pool, { isStaging: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    const get = (p: string, user?: number) =>
      fetch(base + p, { headers: user ? { 'x-test-user': String(user) } : {} });

    assert.strictEqual((await get('/api/genres')).status, 200);
    const series = await (await get('/api/series')).json() as any;
    assert.ok(series.series.length >= 5);
    assert.strictEqual((await get('/api/series?genre=comedy').then((r) => r.json()) as any).series.length, 1);
    const eps = await (await get(`/api/series/${DEMO_SERIES[0].slug}/episodes`)).json() as any;
    assert.strictEqual(eps.episodes.length, EPISODES_PER_SERIES);
    assert.strictEqual((await get(`/api/episodes/${eps.episodes[0].id}`)).status, 200);
    assert.strictEqual((await get('/api/episodes/0')).status, 404);

    for (const p of ['/api/me', '/api/me/follows', '/api/me/watch-history', '/api/me/unlocked', '/api/me/coin-transactions']) {
      const r = await get(p);
      assert.strictEqual(r.status, 401, p);
      assert.strictEqual(((await r.json()) as any).error, 'account_required');
    }
    const me = await (await get('/api/me', A)).json() as any;
    assert.strictEqual(me.profile.id, A);
    assert.strictEqual(me.profile.coinBalance, 0);
    const bad = await fetch(base + '/api/me/watch-history/1', {
      method: 'PUT', headers: { 'x-test-user': String(A), 'content-type': 'application/json' },
      body: JSON.stringify({ positionSeconds: -1 }),
    });
    assert.strictEqual(bad.status, 400);
    const noAuthFollow = await fetch(`${base}/api/series/${DEMO_SERIES[0].slug}/follow`, { method: 'PUT' });
    assert.strictEqual(noAuthFollow.status, 401);
  } finally {
    server.close();
    await pool.end();
  }
});

test('home feed: hero, trending, continue watching and search', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    for (const t of ['follows', 'watch_history']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id IN ($1, $2)`, [C, D]);
    }
    await ensureProfile(pool, D, 'staging-test-d');
    const now = new Date();

    // A guest gets no "Continue watching" row; the hero is the demo series in seed order.
    const guest = await getHomeFeed(pool, null, now);
    assert.strictEqual(guest.continueWatching, null);
    assert.deepStrictEqual(guest.featured.map((s) => s.slug), DEMO_SERIES.map((s) => s.slug));
    assert.ok(guest.genreRows.length > 0 && guest.genreRows.length <= 3);
    for (const row of guest.genreRows) {
      assert.ok(row.series.length > 0);
      for (const s of row.series) assert.strictEqual(s.genre, row.genre.name);
    }

    // Follows and a play this week make a series trend; a month later they no longer count.
    const hot = DEMO_SERIES[3].slug;
    await setFollow(pool, hot, C, true);
    await setFollow(pool, hot, D, true);
    const eps = (await listEpisodes(pool, hot, D))!;
    await saveProgress(pool, D, eps[1].id, 30, false);
    assert.strictEqual((await listTrending(pool, null, now))[0].slug, hot);
    const later = new Date(now.getTime() + 30 * 86400_000);
    assert.notStrictEqual((await listTrending(pool, null, later))[0].slug, hot);

    // Continue watching is the viewer's own, and shows where they got to.
    const cw = await listContinueWatching(pool, D);
    assert.strictEqual(cw.length, 1);
    assert.strictEqual(cw[0].slug, hot);
    assert.strictEqual(cw[0].episodeNumber, 2);
    assert.strictEqual(cw[0].positionSeconds, 30);
    assert.deepStrictEqual(await listContinueWatching(pool, C), []);
    // Finishing the last episode takes the series out of the row.
    await saveProgress(pool, D, eps[eps.length - 1].id, 10, true);
    assert.deepStrictEqual(await listContinueWatching(pool, D), []);

    // Search: case-insensitive title match, combinable with a genre; % is literal.
    assert.deepStrictEqual((await listSeries(pool, null, undefined, 'ROBOT')).map((s) => s.slug), ['little-robot-cooks']);
    assert.strictEqual((await listSeries(pool, null, 'comedy', 'robot')).length, 0);
    assert.strictEqual((await listSeries(pool, null, undefined, '%')).length, 0);
    assert.ok((await listSeries(pool, null, undefined, '  ')).length >= 5);
  } finally {
    await pool.end();
  }
});

test('routes: /api/home, /api/viewer and /api/series?q=', opts, async () => {
  const pool = new Pool({ connectionString: url });
  const app = express();
  app.use((req, _res, next) => {
    req.now = new Date();
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), username: 'staging-test-' + id, usernode_pubkey: null, locale: null, pur: 'iframe' };
    next();
  });
  app.use('/api', catalogueRouter(pool, { isStaging: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    const guest = await (await fetch(base + '/api/home')).json() as any;
    assert.strictEqual(guest.demo, true);
    assert.strictEqual(guest.featured.length, 5);
    assert.strictEqual(guest.continueWatching, null);
    assert.ok(guest.trending.length >= 5 && guest.newReleases.length >= 5);
    const signedIn = await (await fetch(base + '/api/home', { headers: { 'x-test-user': String(C) } })).json() as any;
    assert.ok(Array.isArray(signedIn.continueWatching));
    assert.deepStrictEqual(await (await fetch(base + '/api/viewer')).json(), { signedIn: false });
    const viewer = await (await fetch(base + '/api/viewer', { headers: { 'x-test-user': String(D) } })).json() as any;
    assert.deepStrictEqual(viewer, { signedIn: true, username: 'staging-test-' + D, coinBalance: 0 });
    const found = await (await fetch(base + '/api/series?q=garden')).json() as any;
    assert.deepStrictEqual(found.series.map((s: any) => s.slug), ['garden-club-mysteries']);
  } finally {
    server.close();
    await pool.end();
  }
});
