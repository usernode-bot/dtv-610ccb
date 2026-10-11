// Idempotent schema for Dtv. Safe to run on every boot: every statement is
// CREATE ... IF NOT EXISTS or ADD COLUMN IF NOT EXISTS, and the whole thing
// runs under one advisory lock so two containers booting together cannot race.
//
// Privacy ("Public vs private tables" in the platform conventions):
//   public  : series, episodes, series_follows (catalogue and who follows what)
//   private : coin_balances, coin_transactions, episode_unlocks (money and
//             purchases). Copied schema-only to staging. Private tables may
//             point at public ones; no public table points at a private one.

const SCHEMA_LOCK_KEY = 610001; // arbitrary app-wide constant

/**
 * @typedef {import('pg').Pool} Pool
 */

const STATEMENTS = [
  // A show. cover_url is optional artwork; cover_tone (0..4) picks a neutral
  // tint for the placeholder cover when there is no image yet.
  `CREATE TABLE IF NOT EXISTS series (
     id          SERIAL PRIMARY KEY,
     slug        TEXT NOT NULL UNIQUE,
     title       TEXT NOT NULL,
     synopsis    TEXT NOT NULL DEFAULT '',
     genre       TEXT NOT NULL DEFAULT '',
     cover_url   TEXT,
     cover_tone  SMALLINT NOT NULL DEFAULT 0,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // One episode of a series. coin_price 0 means free; above 0 it is locked
  // until the viewer has an episode_unlocks row for it.
  `CREATE TABLE IF NOT EXISTS episodes (
     id               SERIAL PRIMARY KEY,
     series_id        INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
     number           INTEGER NOT NULL CHECK (number > 0),
     title            TEXT NOT NULL,
     duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
     coin_price       INTEGER NOT NULL DEFAULT 0 CHECK (coin_price >= 0),
     created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (series_id, number)
   )`,

  // Who follows which series. user_id is the platform user id from the token.
  `CREATE TABLE IF NOT EXISTS series_follows (
     user_id    BIGINT NOT NULL,
     series_id  INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, series_id)
   )`,

  // One row per user: their current coin balance (never negative).
  `CREATE TABLE IF NOT EXISTS coin_balances (
     user_id    BIGINT PRIMARY KEY,
     balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // Append-only ledger. amount > 0 adds coins, amount < 0 spends them.
  // kind is a short label such as 'grant' or 'unlock'.
  `CREATE TABLE IF NOT EXISTS coin_transactions (
     id         BIGSERIAL PRIMARY KEY,
     user_id    BIGINT NOT NULL,
     amount     INTEGER NOT NULL CHECK (amount <> 0),
     kind       TEXT NOT NULL,
     episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
     note       TEXT NOT NULL DEFAULT '',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS coin_transactions_user_idx
     ON coin_transactions (user_id, created_at DESC)`,

  // An episode a user has unlocked; optionally tied to the ledger row that
  // paid for it.
  `CREATE TABLE IF NOT EXISTS episode_unlocks (
     user_id             BIGINT NOT NULL,
     episode_id          INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
     coin_transaction_id BIGINT REFERENCES coin_transactions(id) ON DELETE SET NULL,
     unlocked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, episode_id)
   )`,

  `COMMENT ON TABLE coin_balances IS 'staging:private'`,
  `COMMENT ON TABLE coin_transactions IS 'staging:private'`,
  `COMMENT ON TABLE episode_unlocks IS 'staging:private'`,
];

/**
 * Create or upgrade every table. Idempotent.
 * @param {Pool} pool
 * @returns {Promise<void>}
 */
async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_KEY]);
    for (const sql of STATEMENTS) await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { migrate };
