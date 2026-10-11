// Idempotent schema for Dtv. Safe to run on every boot: every statement is
// CREATE ... IF NOT EXISTS or ADD COLUMN IF NOT EXISTS (or a guarded DO block
// for upgrading Phase 0 tables), and it all runs under one advisory lock so
// two containers booting together cannot race.
//
// Privacy ("Public vs private tables" in the platform conventions):
//   public  : genres, series, episodes, follows
//   private : profiles, watch_history, coin_transactions, unlocked_episodes
//             (copied schema-only to staging; also marked in dapp.json notes
//             by the COMMENT statements below). Private tables may point at
//             public ones; no public table points at a private one, which is
//             why follows.user_id has no foreign key to profiles.

import type { Pool } from 'pg';

const SCHEMA_LOCK_KEY = 610001; // arbitrary app-wide constant

const STATEMENTS: string[] = [
  // One row per signed-in person; id is the Homeroom user id from the token.
  `CREATE TABLE IF NOT EXISTS profiles (
     id           BIGINT PRIMARY KEY,
     username     TEXT NOT NULL,
     avatar_url   TEXT,
     coin_balance INTEGER NOT NULL DEFAULT 0 CHECK (coin_balance >= 0),
     created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS genres (
     id         SERIAL PRIMARY KEY,
     slug       TEXT NOT NULL UNIQUE,
     name       TEXT NOT NULL UNIQUE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

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
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS genre_id INTEGER REFERENCES genres(id) ON DELETE SET NULL`,
  // True for rows the staging seed made, so demo content is never mistaken for real.
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE`,
  // Position in the home screen's hero carousel (1 first); NULL is not featured.
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS featured_rank SMALLINT`,

  // One episode of a series. coin_price 0 means free; above 0 it is locked
  // until the viewer has an unlocked_episodes row for it.
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
  `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS video_url TEXT`,
  `CREATE INDEX IF NOT EXISTS series_genre_idx ON series (genre_id)`,

  // Who follows which series. user_id is the platform user id from the token.
  `CREATE TABLE IF NOT EXISTS follows (
     user_id    BIGINT NOT NULL,
     series_id  INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, series_id)
   )`,

  // Where a person got to in an episode.
  `CREATE TABLE IF NOT EXISTS watch_history (
     user_id          BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
     episode_id       INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
     position_seconds INTEGER NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
     completed        BOOLEAN NOT NULL DEFAULT FALSE,
     updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, episode_id)
   )`,

  // Append-only ledger. amount > 0 adds coins, amount < 0 spends them.
  `CREATE TABLE IF NOT EXISTS coin_transactions (
     id         BIGSERIAL PRIMARY KEY,
     user_id    BIGINT NOT NULL,
     amount     INTEGER NOT NULL CHECK (amount <> 0),
     type       TEXT NOT NULL,
     episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
     note       TEXT NOT NULL DEFAULT '',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // The Phase 0 ledger called this column "kind". Nothing wrote to it, but
  // carry any rows over rather than assume.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema()
                   AND table_name = 'coin_transactions' AND column_name = 'kind')
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema()
                   AND table_name = 'coin_transactions' AND column_name = 'type') THEN
       ALTER TABLE coin_transactions RENAME COLUMN kind TO type;
     END IF;
   END $$`,
  `UPDATE coin_transactions SET type = 'reward'
    WHERE type NOT IN ('purchase', 'unlock', 'reward', 'ad')`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'coin_transactions_type_check'
                       AND conrelid = 'coin_transactions'::regclass) THEN
       ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_type_check
         CHECK (type IN ('purchase', 'unlock', 'reward', 'ad'));
     END IF;
   END $$`,
  `CREATE INDEX IF NOT EXISTS coin_transactions_user_idx
     ON coin_transactions (user_id, created_at DESC)`,

  // An episode a person has unlocked; optionally tied to the ledger row that paid for it.
  `CREATE TABLE IF NOT EXISTS unlocked_episodes (
     user_id             BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
     episode_id          INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
     coin_transaction_id BIGINT REFERENCES coin_transactions(id) ON DELETE SET NULL,
     unlocked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, episode_id)
   )`,

  // Carry Phase 0 follows over. The old tables (series_follows, coin_balances,
  // episode_unlocks) are left in place and no longer read.
  `DO $$ BEGIN
     IF to_regclass('series_follows') IS NOT NULL THEN
       INSERT INTO follows (user_id, series_id, created_at)
         SELECT user_id, series_id, created_at FROM series_follows
         ON CONFLICT DO NOTHING;
     END IF;
   END $$`,

  `COMMENT ON TABLE profiles IS 'staging:private'`,
  `COMMENT ON TABLE watch_history IS 'staging:private'`,
  `COMMENT ON TABLE coin_transactions IS 'staging:private'`,
  `COMMENT ON TABLE unlocked_episodes IS 'staging:private'`,
];

/** Create or upgrade every table. Idempotent. */
export async function migrate(pool: Pool): Promise<void> {
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
