// Runs the schema, seed, queries and routes against a real Postgres.
//   DATABASE_URL=postgres://... npm test
// Skipped (not failed) when DATABASE_URL is unset.
import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { migrate } from '../lib/schema';
import { DEMO_SERIES, DEMO_SUBTITLES, EPISODES_PER_SERIES, seedDemoCatalogue } from '../lib/seed';
import {
  getSeries, getWatchPayload, listEpisodes, listGenres, listRelated, listSeries, setFollow,
} from '../lib/catalogue';
import {
  ensureProfile, listFollowed, listWatchHistory, minFavoriteGenres, recordPlay, saveFavoriteGenres, saveProgress,
  unlockEpisode,
} from '../lib/me';
import { upsertProfileOnce } from '../lib/auth';
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

    assert.deepStrictEqual(await saveProgress(pool, A, eps[0].id, 42, false), { newlyCompleted: false });
    assert.deepStrictEqual(await saveProgress(pool, A, eps[0].id, 90, true), { newlyCompleted: true });
    assert.deepStrictEqual(await saveProgress(pool, A, eps[0].id, 90, true), { newlyCompleted: false });
    assert.strictEqual(await saveProgress(pool, A, 999999999, 1, false), false);
    const h = await listWatchHistory(pool, A);
    assert.strictEqual(h.length, 1);
    assert.strictEqual(h[0].positionSeconds, 90);
    assert.strictEqual((await listWatchHistory(pool, B)).length, 0);
  } finally {
    await pool.end();
  }
});

test('series detail: progress, continue target, view count and related series', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    await pool.query('DELETE FROM watch_history WHERE user_id IN ($1, $2)', [A, B]);
    await ensureProfile(pool, A, 'staging-test-a');
    const slug = DEMO_SERIES[1].slug;

    const fresh = (await getSeries(pool, slug, A))!;
    assert.strictEqual(fresh.continueEpisode, null);
    assert.ok(fresh.episodes.every((e) => e.positionSeconds === null && !e.watched));
    const views = fresh.viewCount;
    assert.ok(views > 0, 'staging seed gives demo series a view count');

    // Starting episode 1 counts one view; saving progress again does not.
    const [e1, e2] = fresh.episodes;
    await saveProgress(pool, A, e1.id, 30, false);
    await saveProgress(pool, A, e1.id, 60, false);
    let s = (await getSeries(pool, slug, A))!;
    assert.strictEqual(s.viewCount, views + 1);
    assert.deepStrictEqual(s.continueEpisode, { id: e1.id, number: 1, resume: true });
    assert.strictEqual(s.episodes[0].positionSeconds, 60);

    // Finishing it moves Continue on to the next episode.
    await saveProgress(pool, A, e1.id, 150, true);
    s = (await getSeries(pool, slug, A))!;
    assert.strictEqual(s.episodes[0].watched, true);
    assert.deepStrictEqual(s.continueEpisode, { id: e2.id, number: 2, resume: false });

    // Someone else's history never shows.
    assert.strictEqual((await getSeries(pool, slug, B))!.continueEpisode, null);
    assert.strictEqual((await getSeries(pool, slug, null))!.episodes[0].watched, false);

    const related = (await listRelated(pool, slug, null))!;
    assert.ok(related.length >= 4);
    assert.ok(related.every((r) => r.slug !== slug));
    assert.strictEqual(await listRelated(pool, 'no-such-series', null), null);
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
    const related = await (await get(`/api/series/${DEMO_SERIES[0].slug}/related`)).json() as any;
    assert.ok(related.series.length >= 4);
    assert.strictEqual((await get('/api/series/no-such-series/related')).status, 404);

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

test('onboarding: favourite genres are validated and saved; unlock spends coins once', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    await pool.query('DELETE FROM unlocked_episodes WHERE user_id = $1', [A]);
    await pool.query('DELETE FROM coin_transactions WHERE user_id = $1', [A]);
    await pool.query('DELETE FROM profiles WHERE id = $1', [A]);

    const fresh = await ensureProfile(pool, A, 'staging-test-a');
    assert.deepStrictEqual(fresh.favoriteGenres, []);
    assert.strictEqual(fresh.onboardedAt, null);
    assert.strictEqual(fresh.coinBalance, 0);
    assert.strictEqual(await minFavoriteGenres(pool), 3);

    assert.strictEqual(await saveFavoriteGenres(pool, A, 'staging-test-a', ['comedy', 'animation']), 'too_few_genres');
    assert.strictEqual(await saveFavoriteGenres(pool, A, 'staging-test-a', ['comedy', 'animation', 'nope']), 'invalid_genres');
    assert.strictEqual(await saveFavoriteGenres(pool, A, 'staging-test-a', ['comedy', 'comedy', 'animation']), 'invalid_genres');
    assert.strictEqual(await saveFavoriteGenres(pool, A, 'staging-test-a', 'comedy'), 'invalid_genres');
    const saved = await saveFavoriteGenres(pool, A, 'staging-test-a', ['comedy', 'animation', 'documentary']);
    assert.ok(typeof saved === 'object');
    assert.deepStrictEqual(saved.favoriteGenres, ['comedy', 'animation', 'documentary']);
    assert.ok(saved.onboardedAt);
    // A later handle refresh keeps the picks.
    assert.deepStrictEqual((await ensureProfile(pool, A, 'staging-test-a2')).favoriteGenres, saved.favoriteGenres);

    const eps = (await listEpisodes(pool, DEMO_SERIES[0].slug, A))!;
    const locked = eps[3];
    assert.strictEqual(await unlockEpisode(pool, A, locked.id), 'not_enough_coins');
    assert.strictEqual(await unlockEpisode(pool, A, 999999999), 'not_found');
    await pool.query('UPDATE profiles SET coin_balance = 25 WHERE id = $1', [A]);
    assert.deepStrictEqual(await unlockEpisode(pool, A, locked.id), { coinBalance: 25 - locked.coinPrice, spent: locked.coinPrice });
    assert.deepStrictEqual(await unlockEpisode(pool, A, locked.id), { coinBalance: 25 - locked.coinPrice, spent: 0 });
    assert.deepStrictEqual(await unlockEpisode(pool, A, eps[0].id), { coinBalance: 25 - locked.coinPrice, spent: 0 });
    assert.strictEqual((await listEpisodes(pool, DEMO_SERIES[0].slug, A))![3].state, 'unlocked');
    const ledger = await pool.query('SELECT amount, type FROM coin_transactions WHERE user_id = $1', [A]);
    assert.deepStrictEqual(ledger.rows, [{ amount: -locked.coinPrice, type: 'unlock' }]);
  } finally {
    await pool.end();
  }
});

test('routes: profile is created on first request; guests get account_required with an action', opts, async () => {
  const pool = new Pool({ connectionString: url });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), username: 'staging-test-' + id, usernode_pubkey: null, locale: null, pur: 'iframe' };
    next();
  });
  app.use(upsertProfileOnce(pool));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  app.use('/api/me', meRouter(pool));
  app.use('/api', catalogueRouter(pool, { isStaging: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    await pool.query('DELETE FROM profiles WHERE id = $1', [B]);
    const send = (p: string, method: string, user?: number, body?: unknown) => fetch(base + p, {
      method,
      headers: { ...(user ? { 'x-test-user': String(user) } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    await send('/ping', 'GET', B);
    const row = await pool.query('SELECT username, coin_balance FROM profiles WHERE id = $1', [B]);
    assert.deepStrictEqual(row.rows, [{ username: 'staging-test-' + B, coin_balance: 0 }]);

    const me = await (await send('/api/me', 'GET', B)).json() as any;
    assert.deepStrictEqual(me.onboarding, { required: true, minGenres: 3 });
    assert.strictEqual((await send('/api/me/genres', 'POST', B, { genres: ['comedy'] })).status, 400);
    const ok = await send('/api/me/genres', 'POST', B, { genres: ['comedy', 'animation', 'musical'] });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(((await (await send('/api/me', 'GET', B)).json()) as any).onboarding.required, false);

    const eps = await (await send(`/api/series/${DEMO_SERIES[0].slug}/episodes`, 'GET')).json() as any;
    const guestCases: Array<[string, string, string]> = [
      [`/api/series/${DEMO_SERIES[0].slug}/follow`, 'PUT', 'follow a series'],
      [`/api/episodes/${eps.episodes[3].id}/unlock`, 'POST', 'unlock an episode'],
      ['/api/me/genres', 'POST', 'save your favourite genres'],
    ];
    for (const [p, method, action] of guestCases) {
      const r = await send(p, method);
      assert.strictEqual(r.status, 401, p);
      assert.deepStrictEqual(await r.json(), { error: 'account_required', action });
    }
    const poor = await send(`/api/episodes/${eps.episodes[3].id}/unlock`, 'POST', B);
    assert.strictEqual(poor.status, 402);
    // Free episodes stay playable for guests.
    const freeEp = await (await send(`/api/episodes/${eps.episodes[0].id}`, 'GET')).json() as any;
    assert.ok(freeEp.episode.videoUrl);
  } finally {
    server.close();
    await pool.end();
  }
});

test('player: /api/watch gives the series as a feed, hides locked streams and resumes per person', opts, async () => {
  const pool = new Pool({ connectionString: url });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
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
    const bakery = DEMO_SERIES[0];
    // Its own two people, removed again at the end, so other tests keep fresh profiles.
    await pool.query('DELETE FROM profiles WHERE id IN ($1, $2)', [C, D]);

    // A real subtitles value survives a re-seed; demo rows get the demo file.
    const third = await pool.query(
      `SELECT e.id FROM episodes e JOIN series s ON s.id = e.series_id WHERE s.slug = $1 AND e.number = 3`, [bakery.slug]);
    await pool.query(`UPDATE episodes SET subtitles_url = '/demo/kept.vtt' WHERE id = $1`, [third.rows[0].id]);
    await seedDemoCatalogue(pool);
    const kept = await pool.query('SELECT subtitles_url FROM episodes WHERE id = $1', [third.rows[0].id]);
    assert.strictEqual(kept.rows[0].subtitles_url, '/demo/kept.vtt');
    await pool.query('UPDATE episodes SET subtitles_url = $2 WHERE id = $1', [third.rows[0].id, DEMO_SUBTITLES]);

    const eps = (await listEpisodes(pool, bakery.slug, null))!;
    const first = eps[0];
    const locked = eps[bakery.freeCount];
    const get = (p: string, user?: number) =>
      fetch(base + p, { headers: user ? { 'x-test-user': String(user) } : {} });

    // Guest: the whole series in order, locked items without stream or subtitles, no resume.
    const guest = await get(`/api/watch/${eps[1].id}`);
    assert.strictEqual(guest.status, 200);
    const g = await guest.json() as any;
    assert.strictEqual(g.episode.id, eps[1].id);
    assert.strictEqual(g.series.slug, bakery.slug);
    assert.strictEqual(g.series.title, bakery.title);
    assert.deepStrictEqual(g.playlist.map((e: any) => e.number), eps.map((e) => e.number));
    assert.ok(g.playlist.every((e: any) => e.seriesId === first.seriesId));
    assert.strictEqual(g.playlist[0].subtitlesUrl, DEMO_SUBTITLES);
    for (const e of g.playlist.filter((x: any) => x.state === 'locked')) {
      assert.strictEqual(e.videoUrl, null);
      assert.strictEqual(e.subtitlesUrl, null);
    }
    assert.strictEqual(g.playlist[bakery.freeCount].state, 'locked');
    assert.strictEqual(g.resume, null);

    // Signed in: own position only.
    const put = (user: number, id: number, positionSeconds: number, completed = false) =>
      fetch(`${base}/api/me/watch-history/${id}`, {
        method: 'PUT', headers: { 'x-test-user': String(user), 'content-type': 'application/json' },
        body: JSON.stringify({ positionSeconds, completed }),
      });
    assert.strictEqual((await get(`/api/watch/${first.id}`, C).then((r) => r.json()) as any).resume, null);
    assert.strictEqual((await put(C, first.id, 83)).status, 200);
    const a = await get(`/api/watch/${first.id}`, C).then((r) => r.json()) as any;
    assert.deepStrictEqual(a.resume, { positionSeconds: 83, completed: false });
    const b = await get(`/api/watch/${first.id}`, D).then((r) => r.json()) as any;
    assert.strictEqual(b.resume, null);
    await put(C, first.id, 140, true);
    assert.deepStrictEqual((await getWatchPayload(pool, first.id, C))!.resume, { positionSeconds: 140, completed: true });

    // Unlocking reveals the stream and subtitles to that person only.
    await pool.query('UPDATE profiles SET coin_balance = 100 WHERE id = $1', [C]);
    const unlock = await fetch(`${base}/api/episodes/${locked.id}/unlock`, { method: 'POST', headers: { 'x-test-user': String(C) } });
    assert.strictEqual(unlock.status, 200);
    const after = (await getWatchPayload(pool, locked.id, C))!;
    assert.strictEqual(after.episode.state, 'unlocked');
    assert.ok(after.episode.videoUrl);
    assert.strictEqual(after.episode.subtitlesUrl, DEMO_SUBTITLES);
    assert.strictEqual((await getWatchPayload(pool, locked.id, D))!.episode.subtitlesUrl, null);

    assert.strictEqual((await get('/api/watch/0')).status, 404);
    assert.strictEqual((await get('/api/watch/abc')).status, 404);
  } finally {
    await pool.query('DELETE FROM profiles WHERE id IN ($1, $2)', [C, D]).catch(() => {});
    server.close();
    await pool.end();
  }
});

test('my list: playing an episode records it in watch history, newest first, keeping progress', opts, async () => {
  const pool = new Pool({ connectionString: url });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), username: 'staging-test-' + id, usernode_pubkey: null, locale: null, pur: 'iframe' };
    next();
  });
  app.use('/api/me', meRouter(pool));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    await pool.query('DELETE FROM watch_history WHERE user_id IN ($1, $2)', [A, B]);
    await pool.query('DELETE FROM unlocked_episodes WHERE user_id = $1', [A]);
    await ensureProfile(pool, A, 'staging-test-a');
    const first = (await listEpisodes(pool, DEMO_SERIES[0].slug, A))!;
    const other = (await listEpisodes(pool, DEMO_SERIES[1].slug, A))!;
    const views = async () => (await getSeries(pool, DEMO_SERIES[0].slug, null))!.viewCount;

    const before = await views();
    assert.strictEqual(await recordPlay(pool, A, first[0].id), true);
    assert.strictEqual(await views(), before + 1);
    assert.strictEqual(await recordPlay(pool, A, other[0].id), true);
    assert.strictEqual(await recordPlay(pool, A, first[3].id), 'locked');
    assert.strictEqual(await recordPlay(pool, A, 999999999), 'not_found');
    let history = await listWatchHistory(pool, A);
    assert.deepStrictEqual(history.map((h) => h.episodeId), [other[0].id, first[0].id]);

    // Playing again moves it to the top, keeps the saved position and adds no view.
    await saveProgress(pool, A, first[0].id, 42, false);
    await saveProgress(pool, A, other[0].id, 10, false);
    assert.strictEqual(await recordPlay(pool, A, first[0].id), true);
    assert.strictEqual(await views(), before + 1);
    history = await listWatchHistory(pool, A);
    assert.deepStrictEqual(history.map((h) => h.episodeId), [first[0].id, other[0].id]);
    assert.strictEqual(history[0].positionSeconds, 42);
    assert.strictEqual(history[0].seriesSlug, DEMO_SERIES[0].slug);

    // Over HTTP: own history only; guests are asked to make an account.
    const post = (p: string, user?: number) =>
      fetch(base + p, { method: 'POST', headers: user ? { 'x-test-user': String(user) } : {} });
    assert.strictEqual((await post(`/api/me/watch-history/${other[1].id}/play`, B)).status, 200);
    assert.strictEqual((await post(`/api/me/watch-history/${first[3].id}/play`, B)).status, 403);
    assert.strictEqual((await post('/api/me/watch-history/999999999/play', B)).status, 404);
    const guest = await post(`/api/me/watch-history/${other[1].id}/play`);
    assert.deepStrictEqual(await guest.json(), { error: 'account_required', action: 'keep a watch history' });
    const mine = await (await fetch(base + '/api/me/watch-history', { headers: { 'x-test-user': String(B) } })).json() as any;
    assert.deepStrictEqual(mine.history.map((h: any) => h.episodeId), [other[1].id]);
    assert.strictEqual((await listWatchHistory(pool, A)).length, 2);
  } finally {
    server.close();
    await pool.end();
  }
});
