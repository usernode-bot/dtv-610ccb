// Runs the schema, seed and series queries against a real Postgres.
//   DATABASE_URL=postgres://... npm test
// Skipped (not failed) when DATABASE_URL is unset.
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { migrate } = require('../db/schema');
const { seedDemoCatalogue, DEMO_SERIES } = require('../db/seed');
const { listSeries, getSeries, setFollow } = require('../db/series');

const url = process.env.DATABASE_URL;
const opts = { skip: url ? false : 'DATABASE_URL not set' };

test('series schema, seed, browse, detail and follow', opts, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
    await migrate(pool); // idempotent
    await seedDemoCatalogue(pool);
    await seedDemoCatalogue(pool); // idempotent

    const uid = 987654321;
    await pool.query('DELETE FROM series_follows WHERE user_id = $1', [uid]);
    await pool.query('DELETE FROM episode_unlocks WHERE user_id = $1', [uid]);

    const list = await listSeries(pool, uid);
    assert.strictEqual(list.length, DEMO_SERIES.length);
    const bakery = list.find((s) => s.slug === 'bakery-on-maple-street');
    assert.strictEqual(bakery.episodeCount, 8);
    assert.strictEqual(bakery.freeEpisodeCount, 3);
    assert.strictEqual(bakery.following, false);

    // Follow state is per user and idempotent.
    await setFollow(pool, bakery.slug, uid, true);
    await setFollow(pool, bakery.slug, uid, true);
    assert.strictEqual((await getSeries(pool, bakery.slug, uid)).following, true);
    assert.strictEqual((await getSeries(pool, bakery.slug, null)).following, false);
    assert.strictEqual(await setFollow(pool, 'no-such-series', uid, true), null);

    // Free vs locked, then a purchased unlock shows as unlocked.
    let d = await getSeries(pool, bakery.slug, uid);
    assert.deepStrictEqual(d.episodes.slice(0, 4).map((e) => e.state), ['free', 'free', 'free', 'locked']);
    await pool.query('INSERT INTO episode_unlocks (user_id, episode_id) VALUES ($1, $2)', [uid, d.episodes[3].id]);
    d = await getSeries(pool, bakery.slug, uid);
    assert.strictEqual(d.episodes[3].state, 'unlocked');
    assert.strictEqual(d.episodes[4].state, 'locked');

    await setFollow(pool, bakery.slug, uid, false);
    await pool.query('DELETE FROM episode_unlocks WHERE user_id = $1', [uid]);
    assert.strictEqual(await getSeries(pool, 'no-such-series', uid), null);
  } finally {
    await pool.end();
  }
});
