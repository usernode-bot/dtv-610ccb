// Analytics, rate limiting, caching, SEO and error monitoring.
//   DATABASE_URL=postgres://... npm test
// The database tests are skipped (not failed) when DATABASE_URL is unset.
import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { migrate } from '../lib/schema';
import { DEMO_SERIES, seedDemoCatalogue } from '../lib/seed';
import { listEpisodes } from '../lib/catalogue';
import { ensureProfile } from '../lib/me';
import { episodeDropOff } from '../lib/analytics';
import { rateLimit } from '../lib/rate-limit';
import { SwrCache } from '../lib/cache';
import { injectHead, metaForPath, renderHead, robotsTxt, sitemapXml } from '../lib/seo';
import { buildEvent, createMonitor, parseDsn, parseStack } from '../lib/monitoring';
import { catalogueRouter } from '../app/routes/catalogue';
import { meRouter } from '../app/routes/me';

const url = process.env.DATABASE_URL;
const opts = { skip: url ? false : 'DATABASE_URL not set' };
const C = 987654331;
const D = 987654332;

function testApp(pool: Pool, cacheMs?: number) {
  const app = express();
  app.use(express.json());
  // Stand-in for the platform token middleware: x-test-user picks the person.
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), username: 'staging-test-' + id, usernode_pubkey: null, locale: null, pur: 'iframe' };
    next();
  });
  app.use('/api/me', meRouter(pool));
  app.use('/api', catalogueRouter(pool, { isStaging: true, cacheMs }));
  return app;
}

function listen(app: express.Express) {
  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

test('analytics: play, complete, unlock and drop_off are recorded and add up per episode', opts, async () => {
  const pool = new Pool({ connectionString: url });
  const { server, base } = listen(testApp(pool));
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    const slug = DEMO_SERIES[2].slug;
    const eps = (await listEpisodes(pool, slug, null))!;
    await pool.query('DELETE FROM analytics_events WHERE episode_id = ANY($1::int[])', [eps.map((e) => e.id)]);
    for (const t of ['watch_history', 'unlocked_episodes', 'coin_transactions']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id IN ($1, $2)`, [C, D]);
    }
    await ensureProfile(pool, C, 'staging-test-c');
    await ensureProfile(pool, D, 'staging-test-d');
    const send = (p: string, method: string, user?: number, body?: unknown) => fetch(base + p, {
      method,
      headers: { ...(user ? { 'x-test-user': String(user) } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Both play episode 1; C finishes it, D leaves at 40s. Only C plays episode 2.
    assert.strictEqual((await send(`/api/me/watch-history/${eps[0].id}/play`, 'POST', C)).status, 200);
    assert.strictEqual((await send(`/api/me/watch-history/${eps[0].id}/play`, 'POST', D)).status, 200);
    assert.strictEqual((await send(`/api/me/watch-history/${eps[0].id}`, 'PUT', C, { positionSeconds: 120, completed: true })).status, 200);
    // Saving "finished" again is not a second completion.
    await send(`/api/me/watch-history/${eps[0].id}`, 'PUT', C, { positionSeconds: 120, completed: true });
    assert.strictEqual((await send('/api/events', 'POST', D, { name: 'drop_off', episodeId: eps[0].id, positionSeconds: 40 })).status, 202);
    await send(`/api/me/watch-history/${eps[1].id}/play`, 'POST', C);

    const report = (await episodeDropOff(pool, slug))!;
    assert.strictEqual(report.length, eps.length);
    assert.deepStrictEqual(report[0], {
      episodeId: eps[0].id, number: 1, viewers: 2, completed: 1, dropped: 1,
      dropOffRate: 0.5, averageDropPositionSeconds: 40, retentionFromFirst: 1,
    });
    assert.strictEqual(report[1].viewers, 1);
    assert.strictEqual(report[1].retentionFromFirst, 0.5);
    assert.strictEqual(report[5].viewers, 0);
    assert.strictEqual(report[5].dropOffRate, 0);
    const overHttp = await (await send(`/api/series/${slug}/drop-off`, 'GET')).json() as any;
    assert.deepStrictEqual(overHttp.episodes[0], report[0]);
    assert.strictEqual((await send('/api/series/no-such-series/drop-off', 'GET')).status, 404);
    assert.strictEqual(await episodeDropOff(pool, 'no-such-series'), null);

    // The page may only send drop_off, for a real episode, and only signed in.
    assert.strictEqual((await send('/api/events', 'POST', C, { name: 'play', episodeId: eps[0].id })).status, 400);
    assert.strictEqual((await send('/api/events', 'POST', C, { name: 'drop_off', episodeId: eps[0].id, positionSeconds: -3 })).status, 400);
    assert.strictEqual((await send('/api/events', 'POST', C, { name: 'drop_off', episodeId: 999999999 })).status, 404);
    const guest = await send('/api/events', 'POST', undefined, { name: 'drop_off', episodeId: eps[0].id });
    assert.strictEqual(guest.status, 401);
    assert.strictEqual(((await guest.json()) as any).error, 'account_required');

    // An unlock that spends coins is one unlock event; a repeat is none.
    const locked = eps.find((e) => e.state === 'locked')!;
    await pool.query('UPDATE profiles SET coin_balance = 100 WHERE id = $1', [C]);
    assert.strictEqual((await send(`/api/episodes/${locked.id}/unlock`, 'POST', C)).status, 200);
    assert.strictEqual((await send(`/api/episodes/${locked.id}/unlock`, 'POST', C)).status, 200);
    const unlocks = await pool.query(
      `SELECT user_id, series_id, props FROM analytics_events WHERE name = 'unlock' AND episode_id = $1`, [locked.id]);
    assert.deepStrictEqual(unlocks.rows.map((r) => [Number(r.user_id), r.series_id, r.props]),
      [[C, locked.seriesId, { coins: locked.coinPrice }]]);

    const marks = await pool.query(
      `SELECT 1 FROM pg_class WHERE relname = 'analytics_events' AND obj_description(oid) = 'staging:private'`);
    assert.strictEqual(marks.rows.length, 1);
    await assert.rejects(pool.query(`INSERT INTO analytics_events (user_id, name) VALUES (1, 'clicked')`));
  } finally {
    server.close();
    await pool.end();
  }
});

test('guest catalogue answers are cached and refreshed; signed-in answers never are', opts, async () => {
  const pool = new Pool({ connectionString: url });
  const { server, base } = listen(testApp(pool, 150));
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    const slug = DEMO_SERIES[3].slug;
    const original = (await pool.query('SELECT title FROM series WHERE slug = $1', [slug])).rows[0].title;
    const title = async (user?: number) => ((await (await fetch(`${base}/api/series/${slug}`,
      { headers: user ? { 'x-test-user': String(user) } : {} })).json()) as any).series.title;
    try {
      assert.strictEqual(await title(), original);
      await pool.query('UPDATE series SET title = $2 WHERE slug = $1', [slug, original + ' (renamed)']);
      assert.strictEqual(await title(), original, 'fresh guest answer comes from memory');
      assert.strictEqual(await title(C), original + ' (renamed)', 'signed-in answer is live');
      await new Promise((r) => setTimeout(r, 200));
      assert.strictEqual(await title(), original, 'stale answer is served while it refreshes');
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(await title(), original + ' (renamed)');
    } finally {
      await pool.query('UPDATE series SET title = $2 WHERE slug = $1', [slug, original]);
    }
  } finally {
    server.close();
    await pool.end();
  }
});

test('SwrCache: fresh hits skip the loader, stale hits refresh once in the background', async () => {
  const cache = new SwrCache<number>(40, 1000);
  let calls = 0;
  const load = async () => ++calls;
  assert.strictEqual(await cache.get('k', load), 1);
  assert.strictEqual(await cache.get('k', load), 1);
  await new Promise((r) => setTimeout(r, 60));
  // Stale: answered from memory at once, while one refresh runs.
  const [a, b] = await Promise.all([cache.get('k', load), cache.get('k', load)]);
  assert.deepStrictEqual([a, b], [1, 1]);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(calls, 2);
  assert.strictEqual(await cache.get('k', load), 2);
  const old = new SwrCache<number>(10, 20);
  await old.get('k', load);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(await old.get('k', load), 4, 'too old to serve: waits for the load');
});

test('rate limit: reads and writes have their own budgets per person or address', async () => {
  const app = express();
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), username: 'u', usernode_pubkey: null, locale: null, pur: 'iframe' };
    next();
  });
  app.use('/api', rateLimit({ windowMs: 60_000, maxReads: 2, maxWrites: 1 }));
  app.all('/api/x', (_req, res) => res.json({ ok: true }));
  const { server, base } = listen(app);
  try {
    const call = (method: string, user?: string, ip?: string) => fetch(base + '/api/x', {
      method, headers: { ...(user ? { 'x-test-user': user } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) },
    });
    assert.strictEqual((await call('GET', '1')).status, 200);
    assert.strictEqual((await call('GET', '1')).status, 200);
    const limited = await call('GET', '1');
    assert.strictEqual(limited.status, 429);
    assert.deepStrictEqual(await limited.json(), { error: 'rate_limited' });
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.strictEqual((await call('POST', '1')).status, 200, 'writes count separately');
    assert.strictEqual((await call('POST', '1')).status, 429);
    assert.strictEqual((await call('GET', '2')).status, 200, 'another person has their own budget');
    assert.strictEqual((await call('GET', undefined, '203.0.113.5')).status, 200);
    assert.strictEqual((await call('GET', undefined, '203.0.113.5')).status, 200);
    assert.strictEqual((await call('GET', undefined, '203.0.113.5')).status, 429);
    assert.strictEqual((await call('GET', undefined, '203.0.113.6')).status, 200);
  } finally {
    server.close();
  }
});

test('seo: sitemap lists every series page; robots points at it', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    const xml = await sitemapXml(pool, 'https://dtv.example');
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    assert.ok(xml.includes('<loc>https://dtv.example/</loc>'));
    for (const s of DEMO_SERIES) {
      assert.match(xml, new RegExp(`<loc>https://dtv\\.example/series/${s.slug}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
    }
    assert.ok(robotsTxt('https://dtv.example').includes('Sitemap: https://dtv.example/sitemap.xml'));
    assert.ok(robotsTxt('https://dtv.example').includes('Disallow: /api/'));
  } finally {
    await pool.end();
  }
});

test('seo: each page gets its own escaped head tags', () => {
  const series = { slug: 'tea & "toast"', title: 'Tea <b>& Toast</b>', synopsis: 'A café story. '.repeat(30), genre: 'Comedy', coverUrl: null };
  const meta = metaForPath('/series/x', series);
  assert.strictEqual(meta.title, 'Tea <b>& Toast</b> | Dtv');
  assert.ok(meta.description.length <= 160 && meta.description.endsWith('…'));
  const head = renderHead(meta, 'https://dtv.example');
  assert.ok(head.includes('<title>Tea &lt;b&gt;&amp; Toast&lt;/b&gt; | Dtv</title>'));
  assert.ok(head.includes('<meta property="og:title" content="Tea &lt;b&gt;&amp; Toast&lt;/b&gt; | Dtv">'));
  assert.ok(head.includes('<link rel="canonical" href="https://dtv.example/series/tea%20%26%20%22toast%22">'));
  assert.ok(head.includes('<meta property="og:image" content="https://dtv.example/icons/icon-512.png">'));
  assert.ok(head.includes('<meta property="og:type" content="video.tv_show">'));
  assert.strictEqual(metaForPath('/my-list/history', null).title, 'My List | Dtv');
  assert.strictEqual(metaForPath('/', null).title, 'Dtv');

  const html = '<head>\n  <!-- dtv:head -->\n  <title>Dtv</title>\n  <!-- /dtv:head -->\n</head>';
  const out = injectHead(html, renderHead(metaForPath('/', null), null));
  assert.strictEqual((out.match(/<title>/g) || []).length, 1);
  assert.ok(out.includes('<meta property="og:site_name" content="Dtv">'));
});

test('monitoring: DSN parsing, events, and envelopes sent to Sentry', async () => {
  assert.deepStrictEqual(parseDsn('https://abc123@o1.ingest.sentry.io/42'), {
    endpoint: 'https://o1.ingest.sentry.io/api/42/envelope/', publicKey: 'abc123',
    dsn: 'https://abc123@o1.ingest.sentry.io/42',
  });
  assert.strictEqual(parseDsn('https://k@sentry.example/proxy/7')!.endpoint, 'https://sentry.example/proxy/api/7/envelope/');
  assert.strictEqual(parseDsn('not a dsn'), null);
  assert.strictEqual(parseDsn('https://o1.ingest.sentry.io/42'), null);

  const frames = parseStack('Error: boom\n    at inner (/app/a.js:10:5)\n    at /app/b.js:2:3');
  assert.deepStrictEqual(frames, [
    { function: '?', filename: '/app/b.js', lineno: 2, colno: 3 },
    { function: 'inner', filename: '/app/a.js', lineno: 10, colno: 5 },
  ]);
  const event = buildEvent(new TypeError('bad'), { userId: 5, method: 'GET', url: '/api/series/:slug' }, 'staging');
  assert.strictEqual(event.environment, 'staging');
  assert.strictEqual(event.exception.values[0].type, 'TypeError');
  assert.deepStrictEqual(event.user, { id: '5' });
  assert.match(event.event_id, /^[0-9a-f]{32}$/);

  // A stand-in Sentry: receives one envelope.
  let resolveGot: (v: { url: string; auth: string; body: string }) => void = () => {};
  const got = new Promise<{ url: string; auth: string; body: string }>((resolve) => { resolveGot = resolve; });
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.end('{}');
      resolveGot({ url: String(req.url), auth: String(req.headers['x-sentry-auth']), body });
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, resolve));
  const port = (fake.address() as AddressInfo).port;
  const monitor = createMonitor(`http://pubkey@127.0.0.1:${port}/42`, 'production');
  assert.strictEqual(monitor.enabled, true);
  monitor.captureException(new Error('kaboom'), { platform: 'javascript', userId: 9, url: '/series/x' });
  const r = await got;
  fake.close();
  assert.strictEqual(r.url, '/api/42/envelope/');
  assert.ok(r.auth.includes('sentry_key=pubkey'));
  const [header, item, payload] = r.body.split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(item.type, 'event');
  assert.strictEqual(header.event_id, payload.event_id);
  assert.strictEqual(payload.exception.values[0].value, 'kaboom');
  assert.strictEqual(payload.platform, 'javascript');
  assert.strictEqual(payload.environment, 'production');

  assert.strictEqual(createMonitor(undefined, 'staging').enabled, false);
});
