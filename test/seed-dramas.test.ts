// The drama catalogue seed against a real Postgres, in its own schema so it
// cannot change the counts catalogue.test.ts asserts.
//   DATABASE_URL=postgres://... npm test
// Skipped (not failed) when DATABASE_URL is unset.
import test from 'node:test';
import assert from 'node:assert';
import { Pool } from 'pg';
import { migrate } from '../lib/schema';
import { DRAMA_SERIES, seedDramaCatalogue } from '../lib/seed-dramas';
import { listEpisodes, listSeries } from '../lib/catalogue';

const url = process.env.DATABASE_URL;
const opts = { skip: url ? false : 'DATABASE_URL not set' };
const SCHEMA = 'drama_seed_test';

test('drama seed: 16 series, 4 per country and format, episodes up to total_episodes, idempotent', opts, async () => {
  const admin = new Pool({ connectionString: url });
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();
  const pool = new Pool({ connectionString: url, options: `-c search_path=${SCHEMA}` });
  try {
    await migrate(pool);
    await seedDramaCatalogue(pool);
    const before = await pool.query('SELECT id, slug FROM series ORDER BY id');
    const episodesBefore = await pool.query('SELECT COUNT(*)::int AS n FROM episodes');
    await migrate(pool);
    await seedDramaCatalogue(pool);
    assert.deepStrictEqual((await pool.query('SELECT id, slug FROM series ORDER BY id')).rows, before.rows);
    assert.strictEqual(
      (await pool.query('SELECT COUNT(*)::int AS n FROM episodes')).rows[0].n, episodesBefore.rows[0].n);

    const groups = await pool.query(
      `SELECT country, format, COUNT(*)::int AS n FROM series WHERE is_demo GROUP BY 1, 2 ORDER BY 1, 2`);
    assert.deepStrictEqual(groups.rows, [
      { country: 'china', format: 'long', n: 4 }, { country: 'china', format: 'short', n: 4 },
      { country: 'korea', format: 'long', n: 4 }, { country: 'korea', format: 'short', n: 4 },
    ]);

    const series = await pool.query(
      `SELECT s.*, COUNT(e.id)::int AS episode_count,
              MIN(e.duration_sec) AS min_dur, MAX(e.duration_sec) AS max_dur
         FROM series s JOIN episodes e ON e.series_id = s.id GROUP BY s.id`);
    assert.strictEqual(series.rows.length, 16);
    for (const s of series.rows) {
      assert.strictEqual(s.episode_count, s.total_episodes, s.slug);
      assert.ok(s.genres.length >= 2 && s.genres.length <= 3, s.slug);
      assert.strictEqual(s.genre, s.genres[0]);
      assert.ok(s.genre_id);
      assert.strictEqual(s.description, s.synopsis);
      assert.ok(s.original_title && s.release_year && s.status && Number(s.rating) > 0, s.slug);
      assert.match(s.poster_url, /^data:image\/svg\+xml/);
      assert.match(s.banner_url, /^data:image\/svg\+xml/);
      if (s.format === 'long') {
        assert.ok(s.total_episodes >= 16 && s.total_episodes <= 40, s.slug);
        assert.ok(s.min_dur >= 45 * 60 && s.max_dur <= 70 * 60, s.slug);
      } else {
        assert.ok(s.total_episodes >= 40 && s.total_episodes <= 100, s.slug);
        assert.ok(s.min_dur >= 60 && s.max_dur <= 180, s.slug);
      }
    }

    // Hand-written titles first, generated after; aliases follow the source columns.
    const d = DRAMA_SERIES.find((x) => x.slug === 'love-in-aisle-seven')!;
    const eps = await pool.query(
      `SELECT e.* FROM episodes e JOIN series s ON s.id = e.series_id
        WHERE s.slug = $1 ORDER BY e.number`, [d.slug]);
    assert.deepStrictEqual(eps.rows.slice(0, 5).map((e) => e.title), d.episodeTitles);
    assert.strictEqual(eps.rows[5].title, 'Episode 6');
    for (const e of eps.rows) {
      assert.strictEqual(e.episode_number, e.number);
      assert.strictEqual(e.is_free, e.coin_price === 0);
      assert.deepStrictEqual(e.subtitle_langs, ['ko', 'en', 'id']);
      assert.match(e.video_url, /^https:\/\/.+\.m3u8$/);
    }
    await assert.rejects(pool.query(`UPDATE series SET country = 'japan' WHERE slug = $1`, [d.slug]));

    // The app's own queries see the new series.
    assert.strictEqual((await listSeries(pool, null)).length, 16);
    const listed = (await listEpisodes(pool, d.slug, null))!;
    assert.deepStrictEqual(listed.slice(0, 4).map((e) => e.state), ['free', 'free', 'free', 'locked']);

    // Leftover episodes past a lowered total_episodes are removed on the next run.
    await pool.query(
      `INSERT INTO episodes (series_id, number, title) SELECT id, 99, 'Extra' FROM series WHERE slug = $1`, [d.slug]);
    await seedDramaCatalogue(pool);
    assert.strictEqual((await listEpisodes(pool, d.slug, null))!.length, d.totalEpisodes);

    // A real series that owns a seeded slug is never overwritten.
    await pool.query(`UPDATE series SET is_demo = FALSE, title = 'Real title' WHERE slug = $1`, [d.slug]);
    await seedDramaCatalogue(pool);
    const kept = await pool.query('SELECT title FROM series WHERE slug = $1', [d.slug]);
    assert.strictEqual(kept.rows[0].title, 'Real title');
  } finally {
    await pool.end();
  }
});
