// Idempotent schema for Dtv. Safe to run on every boot: every statement is
// CREATE ... IF NOT EXISTS or ADD COLUMN IF NOT EXISTS (or a guarded DO block
// for upgrading Phase 0 tables), and it all runs under one advisory lock so
// two containers booting together cannot race.
//
// Privacy ("Public vs private tables" in the platform conventions):
//   public  : genres, series, episodes, follows
//   private : profiles, watch_history, coin_transactions, unlocked_episodes,
//             daily_check_ins, ad_sessions, coin_purchases, stripe_events
//             analytics_events
//             (copied schema-only to staging; also marked in dapp.json notes
//             by the COMMENT statements below). Private tables may point at
//             public ones; no public table points at a private one, which is
//             why follows.user_id has no foreign key to profiles.

import type { Pool } from 'pg';
import { CHECK_IN_REWARDS } from './coin-config';

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
  // Runs on every boot, so this list must always name every type in use:
  // a type missing here would be rewritten to 'reward'.
  `UPDATE coin_transactions SET type = 'reward'
    WHERE type NOT IN ('purchase', 'unlock', 'bundle', 'check_in', 'reward', 'ad')`,
  // Phase 6 widened the types (bundle, check_in): swap a narrower check.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'coin_transactions_type_check'
                   AND conrelid = 'coin_transactions'::regclass
                   AND pg_get_constraintdef(oid) NOT LIKE '%check_in%') THEN
       ALTER TABLE coin_transactions DROP CONSTRAINT coin_transactions_type_check;
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'coin_transactions_type_check'
                       AND conrelid = 'coin_transactions'::regclass) THEN
       ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_type_check
         CHECK (type IN ('purchase', 'unlock', 'bundle', 'check_in', 'reward', 'ad'));
     END IF;
   END $$`,
  // The series a bundle unlocked, and the purchase a 'purchase' row paid in.
  `ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS series_id INTEGER REFERENCES series(id) ON DELETE SET NULL`,
  `ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS coin_purchase_id BIGINT`,
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
  // How it was unlocked. An ad unlock has no ledger row.
  `ALTER TABLE unlocked_episodes ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'coins'
     CHECK (method IN ('coins', 'bundle', 'ad'))`,

  // ── Phase 6: monetization ───────────────────────────────────────────
  // Every coin change goes through one of the dtv_* functions below. Each
  // locks the person's profiles row first, so all coin operations for one
  // person run one at a time and can never deadlock with each other.

  // Daily check-in streak: the streak day last claimed (1..7) and its date.
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS check_in_streak SMALLINT NOT NULL DEFAULT 0`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_check_in_day DATE`,
  `CREATE TABLE IF NOT EXISTS daily_check_ins (
     user_id             BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
     day                 DATE NOT NULL,
     streak_day          SMALLINT NOT NULL CHECK (streak_day BETWEEN 1 AND 7),
     coin_transaction_id BIGINT REFERENCES coin_transactions(id) ON DELETE SET NULL,
     created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, day)
   )`,

  // A rewarded ad someone started. The unlock is granted only by completing
  // the row on the server (dtv_unlock_episode_with_ad). day is the UTC day it
  // counts against for the daily limit.
  `CREATE TABLE IF NOT EXISTS ad_sessions (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id      BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
     episode_id   INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
     provider     TEXT NOT NULL,
     day          DATE NOT NULL,
     started_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
     completed_at TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS ad_sessions_user_day_idx ON ad_sessions (user_id, day)`,

  // A Stripe Checkout Session this server created, credited at most once.
  `CREATE TABLE IF NOT EXISTS coin_purchases (
     id                  BIGSERIAL PRIMARY KEY,
     user_id             BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
     stripe_session_id   TEXT NOT NULL UNIQUE,
     package_id          TEXT NOT NULL,
     coins               INTEGER NOT NULL CHECK (coins > 0),
     amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
     currency            TEXT NOT NULL,
     status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited')),
     coin_transaction_id BIGINT REFERENCES coin_transactions(id) ON DELETE SET NULL,
     created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     credited_at         TIMESTAMPTZ
   )`,
  // Stripe webhook events already handled, so a retried event does nothing.
  `CREATE TABLE IF NOT EXISTS stripe_events (
     event_id          TEXT PRIMARY KEY,
     type              TEXT NOT NULL,
     stripe_session_id TEXT,
     received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // What unlocking the rest of a series costs: every paid episode the person
  // has not unlocked, at 20% off rounded down. p_user NULL (a guest) counts
  // every paid episode.
  `CREATE OR REPLACE FUNCTION dtv_bundle_quote(p_user BIGINT, p_series INTEGER)
   RETURNS TABLE (episode_count INTEGER, full_price INTEGER, price INTEGER)
   LANGUAGE sql STABLE AS $$
     SELECT COUNT(*)::int, COALESCE(SUM(e.coin_price), 0)::int,
            (COALESCE(SUM(e.coin_price), 0) * 4 / 5)::int
       FROM episodes e
      WHERE e.series_id = p_series AND e.coin_price > 0
        AND NOT EXISTS (SELECT 1 FROM unlocked_episodes u
                         WHERE u.episode_id = e.id AND u.user_id = p_user)
   $$`,

  // Spend coins on one episode. Free or already unlocked costs nothing.
  `CREATE OR REPLACE FUNCTION dtv_unlock_episode(p_user BIGINT, p_episode INTEGER)
   RETURNS TABLE (result TEXT, balance INTEGER)
   LANGUAGE plpgsql AS $$
   DECLARE v_bal INTEGER; v_price INTEGER; v_tx BIGINT;
   BEGIN
     SELECT p.coin_balance INTO v_bal FROM profiles p WHERE p.id = p_user FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'no profile for user %', p_user; END IF;
     SELECT e.coin_price INTO v_price FROM episodes e
       JOIN series s ON s.id = e.series_id AND s.is_published WHERE e.id = p_episode;
     IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, v_bal; RETURN; END IF;
     IF v_price = 0 OR EXISTS (SELECT 1 FROM unlocked_episodes u
                                WHERE u.user_id = p_user AND u.episode_id = p_episode) THEN
       RETURN QUERY SELECT 'already_unlocked'::text, v_bal; RETURN;
     END IF;
     IF v_bal < v_price THEN RETURN QUERY SELECT 'not_enough_coins'::text, v_bal; RETURN; END IF;
     INSERT INTO coin_transactions (user_id, amount, type, episode_id)
       VALUES (p_user, -v_price, 'unlock', p_episode) RETURNING id INTO v_tx;
     INSERT INTO unlocked_episodes (user_id, episode_id, coin_transaction_id, method)
       VALUES (p_user, p_episode, v_tx, 'coins');
     UPDATE profiles p SET coin_balance = p.coin_balance - v_price
      WHERE p.id = p_user RETURNING p.coin_balance INTO v_bal;
     RETURN QUERY SELECT 'ok'::text, v_bal;
   END $$`,

  // Unlock every remaining paid episode of a series at the bundle price. The
  // caller passes the price it showed; a different price now is refused.
  `CREATE OR REPLACE FUNCTION dtv_unlock_series_bundle(p_user BIGINT, p_series INTEGER, p_expected_price INTEGER)
   RETURNS TABLE (result TEXT, balance INTEGER, unlocked_count INTEGER, bundle_price INTEGER)
   LANGUAGE plpgsql AS $$
   DECLARE v_bal INTEGER; v_count INTEGER; v_full INTEGER; v_price INTEGER; v_tx BIGINT;
   BEGIN
     SELECT p.coin_balance INTO v_bal FROM profiles p WHERE p.id = p_user FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'no profile for user %', p_user; END IF;
     IF NOT EXISTS (SELECT 1 FROM series s WHERE s.id = p_series) THEN
       RETURN QUERY SELECT 'not_found'::text, v_bal, 0, 0; RETURN;
     END IF;
     SELECT q.episode_count, q.full_price, q.price INTO v_count, v_full, v_price
       FROM dtv_bundle_quote(p_user, p_series) q;
     IF v_count = 0 THEN RETURN QUERY SELECT 'nothing_to_unlock'::text, v_bal, 0, 0; RETURN; END IF;
     IF v_price <> p_expected_price THEN
       RETURN QUERY SELECT 'price_changed'::text, v_bal, v_count, v_price; RETURN;
     END IF;
     IF v_bal < v_price THEN
       RETURN QUERY SELECT 'not_enough_coins'::text, v_bal, v_count, v_price; RETURN;
     END IF;
     IF v_price > 0 THEN
       INSERT INTO coin_transactions (user_id, amount, type, series_id, note)
         VALUES (p_user, -v_price, 'bundle', p_series, v_count || ' episodes') RETURNING id INTO v_tx;
     END IF;
     INSERT INTO unlocked_episodes (user_id, episode_id, coin_transaction_id, method)
       SELECT p_user, e.id, v_tx, 'bundle' FROM episodes e
        WHERE e.series_id = p_series AND e.coin_price > 0
       ON CONFLICT DO NOTHING;
     UPDATE profiles p SET coin_balance = p.coin_balance - v_price
      WHERE p.id = p_user RETURNING p.coin_balance INTO v_bal;
     RETURN QUERY SELECT 'ok'::text, v_bal, v_count, v_price;
   END $$`,

  // Grant the unlock for a rewarded ad: once per session, only after it has
  // run at least p_min_seconds on the database's own clock, and at most
  // p_daily_limit times a day. Costs no coins.
  `CREATE OR REPLACE FUNCTION dtv_unlock_episode_with_ad(
     p_user BIGINT, p_session UUID, p_min_seconds INTEGER, p_daily_limit INTEGER)
   RETURNS TABLE (result TEXT, episode INTEGER, remaining INTEGER)
   LANGUAGE plpgsql AS $$
   DECLARE v_s ad_sessions%ROWTYPE; v_used INTEGER;
   BEGIN
     PERFORM 1 FROM profiles p WHERE p.id = p_user FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'no profile for user %', p_user; END IF;
     SELECT * INTO v_s FROM ad_sessions s WHERE s.id = p_session AND s.user_id = p_user FOR UPDATE;
     IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::int, 0; RETURN; END IF;
     SELECT COUNT(*)::int INTO v_used FROM ad_sessions s
      WHERE s.user_id = p_user AND s.day = v_s.day AND s.completed_at IS NOT NULL;
     IF v_s.completed_at IS NOT NULL THEN
       RETURN QUERY SELECT 'used'::text, v_s.episode_id, GREATEST(p_daily_limit - v_used, 0); RETURN;
     END IF;
     IF clock_timestamp() - v_s.started_at < make_interval(secs => p_min_seconds) THEN
       RETURN QUERY SELECT 'too_early'::text, v_s.episode_id, GREATEST(p_daily_limit - v_used, 0); RETURN;
     END IF;
     IF EXISTS (SELECT 1 FROM episodes e WHERE e.id = v_s.episode_id AND e.coin_price = 0)
        OR EXISTS (SELECT 1 FROM unlocked_episodes u
                    WHERE u.user_id = p_user AND u.episode_id = v_s.episode_id) THEN
       RETURN QUERY SELECT 'already_unlocked'::text, v_s.episode_id, GREATEST(p_daily_limit - v_used, 0); RETURN;
     END IF;
     IF v_used >= p_daily_limit THEN
       RETURN QUERY SELECT 'daily_limit'::text, v_s.episode_id, 0; RETURN;
     END IF;
     UPDATE ad_sessions s SET completed_at = clock_timestamp() WHERE s.id = p_session;
     INSERT INTO unlocked_episodes (user_id, episode_id, method)
       VALUES (p_user, v_s.episode_id, 'ad') ON CONFLICT DO NOTHING;
     RETURN QUERY SELECT 'ok'::text, v_s.episode_id, p_daily_limit - v_used - 1;
   END $$`,

  // Claim the daily check-in for p_day (the UTC day of the request). The day
  // after the last claim continues the streak; any gap starts it at day 1.
  `CREATE OR REPLACE FUNCTION dtv_claim_check_in(p_user BIGINT, p_day DATE)
   RETURNS TABLE (result TEXT, balance INTEGER, reward INTEGER, day_number INTEGER)
   LANGUAGE plpgsql AS $$
   DECLARE v_bal INTEGER; v_streak INTEGER; v_last DATE; v_n INTEGER; v_reward INTEGER; v_tx BIGINT;
   BEGIN
     SELECT p.coin_balance, p.check_in_streak, p.last_check_in_day INTO v_bal, v_streak, v_last
       FROM profiles p WHERE p.id = p_user FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'no profile for user %', p_user; END IF;
     IF v_last IS NOT NULL AND v_last >= p_day THEN
       RETURN QUERY SELECT 'already_claimed'::text, v_bal, 0, v_streak; RETURN;
     END IF;
     v_n := CASE WHEN v_last = p_day - 1 THEN (v_streak % 7) + 1 ELSE 1 END;
     v_reward := (ARRAY[${CHECK_IN_REWARDS.join(', ')}])[v_n];
     INSERT INTO coin_transactions (user_id, amount, type, note)
       VALUES (p_user, v_reward, 'check_in', 'Daily check-in, day ' || v_n) RETURNING id INTO v_tx;
     INSERT INTO daily_check_ins (user_id, day, streak_day, coin_transaction_id)
       VALUES (p_user, p_day, v_n, v_tx);
     UPDATE profiles p SET coin_balance = p.coin_balance + v_reward,
                           check_in_streak = v_n, last_check_in_day = p_day
      WHERE p.id = p_user RETURNING p.coin_balance INTO v_bal;
     RETURN QUERY SELECT 'ok'::text, v_bal, v_reward, v_n;
   END $$`,

  // Credit a paid Stripe Checkout Session, once. p_event is the webhook
  // event id (NULL when the payment is confirmed by polling Stripe): an event
  // already seen, or a session already credited, is a duplicate. Coins come
  // from the coin_purchases row this server wrote, never from Stripe's data,
  // which is only checked against it.
  `CREATE OR REPLACE FUNCTION dtv_credit_purchase(
     p_session TEXT, p_event TEXT, p_event_type TEXT, p_amount_cents INTEGER, p_currency TEXT)
   RETURNS TABLE (result TEXT, balance INTEGER, credited_coins INTEGER, buyer BIGINT)
   LANGUAGE plpgsql AS $$
   DECLARE v_p coin_purchases%ROWTYPE; v_bal INTEGER; v_tx BIGINT;
   BEGIN
     SELECT * INTO v_p FROM coin_purchases cp WHERE cp.stripe_session_id = p_session;
     IF NOT FOUND THEN RETURN QUERY SELECT 'unknown_session'::text, NULL::int, 0, NULL::bigint; RETURN; END IF;
     SELECT p.coin_balance INTO v_bal FROM profiles p WHERE p.id = v_p.user_id FOR UPDATE;
     SELECT * INTO v_p FROM coin_purchases cp WHERE cp.id = v_p.id FOR UPDATE;
     IF p_event IS NOT NULL THEN
       INSERT INTO stripe_events (event_id, type, stripe_session_id)
         VALUES (p_event, COALESCE(p_event_type, ''), p_session) ON CONFLICT DO NOTHING;
       IF NOT FOUND THEN
         RETURN QUERY SELECT 'duplicate'::text, v_bal, v_p.coins, v_p.user_id; RETURN;
       END IF;
     END IF;
     IF v_p.status = 'credited' THEN
       RETURN QUERY SELECT 'duplicate'::text, v_bal, v_p.coins, v_p.user_id; RETURN;
     END IF;
     IF p_amount_cents IS DISTINCT FROM v_p.amount_cents OR lower(p_currency) IS DISTINCT FROM v_p.currency THEN
       RETURN QUERY SELECT 'amount_mismatch'::text, v_bal, 0, v_p.user_id; RETURN;
     END IF;
     INSERT INTO coin_transactions (user_id, amount, type, note, coin_purchase_id)
       VALUES (v_p.user_id, v_p.coins, 'purchase', 'Bought ' || to_char(v_p.coins, 'FM999,999,999') || ' coins', v_p.id)
       RETURNING id INTO v_tx;
     UPDATE profiles p SET coin_balance = p.coin_balance + v_p.coins
      WHERE p.id = v_p.user_id RETURNING p.coin_balance INTO v_bal;
     UPDATE coin_purchases cp SET status = 'credited', credited_at = NOW(), coin_transaction_id = v_tx
      WHERE cp.id = v_p.id;
     RETURN QUERY SELECT 'credited'::text, v_bal, v_p.coins, v_p.user_id;
   END $$`,

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
  `COMMENT ON TABLE daily_check_ins IS 'staging:private'`,
  `COMMENT ON TABLE ad_sessions IS 'staging:private'`,
  `COMMENT ON TABLE coin_purchases IS 'staging:private'`,
  `COMMENT ON TABLE stripe_events IS 'staging:private'`,
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
