// Idempotent schema for Dtv. Safe to run on every boot: every statement is
// CREATE ... IF NOT EXISTS or ADD COLUMN IF NOT EXISTS (or a guarded DO block
// for upgrading Phase 0 tables), and it all runs under one advisory lock so
// two containers booting together cannot race.
//
// Privacy ("Public vs private tables" in the platform conventions):
//   public  : genres, series, episodes, follows
//   private : profiles, watch_history, coin_transactions, unlocked_episodes,
//             analytics_events
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

  // Genres the person picked during onboarding (genre slugs), and when they
  // finished it. NULL onboarded_at means the onboarding screen is still due.
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS favorite_genres TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ`,

  // Admin access. role is 'user' or 'admin' (ADMIN_USERNAMES grants admin on
  // sign-in; admins can promote others). A banned person is refused by every
  // API route.
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
     CHECK (role IN ('user', 'admin'))`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE`,

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
  // How many times someone started an episode of this series for the first
  // time (one per person per episode; see saveProgress).
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0)`,

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

  // Drama catalogue fields. Nullable so rows from before them stay valid.
  //   country: where the drama is from. format: 'long' (16-40 episodes of
  //   45-70 min, landscape) or 'short' (40-100 episodes of 1-3 min, vertical
  //   9:16). genres: every genre label (genre / genre_id stay the primary one).
  //   rating: viewer score out of 10. total_episodes: planned episode count.
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS original_title TEXT`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS country TEXT CHECK (country IN ('china', 'korea'))`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS format TEXT CHECK (format IN ('long', 'short'))`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS genres TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS release_year SMALLINT CHECK (release_year BETWEEN 1900 AND 2100)`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('ongoing', 'completed'))`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS poster_url TEXT`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS banner_url TEXT`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS total_episodes INTEGER CHECK (total_episodes > 0)`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS rating NUMERIC(3,1) CHECK (rating BETWEEN 0 AND 10)`,
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE`,
  // Read-only aliases under the catalogue's names; write synopsis, number,
  // duration_seconds and coin_price, which the app already reads.
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS description TEXT GENERATED ALWAYS AS (synopsis) STORED`,
  `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS episode_number INTEGER GENERATED ALWAYS AS (number) STORED`,
  `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS duration_sec INTEGER GENERATED ALWAYS AS (duration_seconds) STORED`,
  `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_free BOOLEAN GENERATED ALWAYS AS (coin_price = 0) STORED`,
  // Languages with subtitles, as BCP-47 tags ('en', 'zh-Hans', 'ko').
  `ALTER TABLE episodes ADD COLUMN IF NOT EXISTS subtitle_langs TEXT[] NOT NULL DEFAULT '{}'`,
  `CREATE INDEX IF NOT EXISTS series_country_format_idx ON series (country, format)`,
  // Only published series show to viewers. Rows from before the series
  // manager stay published; a series an admin adds starts unpublished.
  `ALTER TABLE series ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE`,

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
    WHERE type NOT IN ('purchase', 'unlock', 'reward', 'ad', 'admin')`,
  // 'admin' (a balance adjustment made by an admin, its reason in note) came
  // later: drop an older check that does not allow it, so it is re-added below.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'coin_transactions_type_check'
                   AND conrelid = 'coin_transactions'::regclass
                   AND pg_get_constraintdef(oid) NOT LIKE '%admin%') THEN
       ALTER TABLE coin_transactions DROP CONSTRAINT coin_transactions_type_check;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'coin_transactions_type_check'
                       AND conrelid = 'coin_transactions'::regclass) THEN
       ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_type_check
         CHECK (type IN ('purchase', 'unlock', 'reward', 'ad', 'admin'));
     END IF;
   END $$`,
  // Which admin made an 'admin' adjustment.
  `ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS actor_id BIGINT`,
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

  // Product analytics (lib/analytics.ts): play, complete, unlock, purchase and
  // drop_off. Private, because each row says what one person watched.
  `CREATE TABLE IF NOT EXISTS analytics_events (
     id               BIGSERIAL PRIMARY KEY,
     user_id          BIGINT NOT NULL,
     name             TEXT NOT NULL CHECK (name IN ('play', 'complete', 'unlock', 'purchase', 'drop_off')),
     episode_id       INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
     series_id        INTEGER REFERENCES series(id) ON DELETE SET NULL,
     position_seconds INTEGER CHECK (position_seconds >= 0),
     props            JSONB NOT NULL DEFAULT '{}',
     created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS analytics_events_episode_idx ON analytics_events (episode_id, name)`,

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
  `COMMENT ON TABLE analytics_events IS 'staging:private'`,
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
