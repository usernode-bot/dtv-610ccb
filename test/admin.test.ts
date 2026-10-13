// The series manager against a real Postgres, in its own schema so it cannot
// change the counts the other tests assert.
//   DATABASE_URL=postgres://... npm test
// Skipped (not failed) when DATABASE_URL is unset.
import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { migrate } from '../lib/schema';
import { getEpisode, getSeries, listEpisodes, listSeries, setFollow } from '../lib/catalogue';
import { ensureProfile, listFollowed } from '../lib/me';
import { parseDuration, validateEpisodes, validateSeries } from '../lib/admin';
import { adminRouter } from '../app/routes/admin';
import { catalogueRouter } from '../app/routes/catalogue';

const url = process.env.DATABASE_URL;
const opts = { skip: url ? false : 'DATABASE_URL not set' };
const SCHEMA = 'admin_series_test';

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
    if (name) req.user = { id: 4242, username: String(name), usernode_pubkey: null, locale: null, pur: 'iframe' };
    next();
  });
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

    // Guests are asked for an account; members who are not admins are refused.
    assert.strictEqual((await send('/api/admin/series', 'GET')).status, 401);
    assert.deepStrictEqual(await (await send('/api/admin/series', 'POST', 'someone', FORM)).json(), { error: 'admin_required' });
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
