# Dtv

Watch movies and dramas together with the group. Express + TypeScript server
with Postgres. The catalogue: a series browse screen (`/`) and a series detail
page (`/series/<slug>`: cover, genre, expandable description, episode and view
counts, Watch now / Continue, follow, share, a 5-per-row episode grid and related
series), and My List (`/my-list`: the series you follow, and `/my-list/history`: episodes you
opened, most recent first), plain JS in `public/`. Episodes link to `/watch/<episodeId>`, a
placeholder until the player lands. A locked episode opens the unlock sheet: spend
coins, watch a (sample) rewarded ad, or unlock the rest of the series at 20% off.
`/store` (Coins) has the daily check-in streak and the Stripe coin store; `/history`
lists every coin earned or spent.

## Coins

Every balance change happens in one Postgres function under a lock on the
person's `profiles` row (`lib/schema.ts`): `dtv_unlock_episode`,
`dtv_unlock_series_bundle`, `dtv_unlock_episode_with_ad`, `dtv_claim_check_in` and
`dtv_credit_purchase`. The page only asks for an action. Prices, rewards and coin
amounts are read on the server (`lib/coin-config.ts`, `episodes.coin_price`).

- **Check-in:** 10, 10, 15, 15, 20, 20, 50 coins for days 1 to 7 of a streak, then
  day 1 again; a missed day starts over. A day is a UTC day of `req.now`.
- **Rewarded ads:** `window.dtv.adProvider` plays the ad in the page (a 5-second
  sample by default); the server grants the unlock when the `ad_sessions` row it
  created is completed at least 5 seconds later, once, and 5 times a day at most.
  A real ad network adds an `AdProvider` in `lib/ads.ts` (picked by `AD_PROVIDER`).
- **Coin store:** Stripe Checkout in a new tab. Set `STRIPE_SECRET_KEY` and
  `STRIPE_WEBHOOK_SECRET` (Secrets), and point a Stripe webhook at
  `https://<app address>/api/stripe/webhook` for `checkout.session.completed` and
  `checkout.session.async_payment_succeeded`. Until both are set the store says
  "Payments are not set up yet" (staging always does: they are private secrets).
  Coins are credited once per session, from the `coin_purchases` row this server
  wrote, whether the signed webhook or the page's status check gets there first.

## Layout

- `app/`: the Express server (`server.ts`: platform auth, boot, graceful shutdown) and `app/routes/`.
- `lib/`: the pg pool (`db.ts`), schema (`schema.ts`), queries (`catalogue.ts`, `me.ts`), demo seed (`seed.ts`, `seed-cli.ts`).
- `types/`: shared API types and the Express request augmentation.
- `components/`, `hooks/`: reserved for the UI; empty for now.
- `public/`: the current browse and detail screens. `styles/` and `tailwind.config.js`: Tailwind.

## Schema

Applied on every start by `lib/schema.ts` (all `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
Private tables (also listed in `dapp.json`) are marked `staging:private`: their schema is copied to staging, their rows are not.

| Table | Visibility | Columns |
|---|---|---|
| `profiles` | private | `id` (Homeroom user id), `username`, `avatar_url`, `coin_balance` (>= 0), `created_at` |
| `genres` | public | `id`, `slug`, `name`, `created_at` |
| `series` | public | `id`, `slug`, `title`, `synopsis`, `genre` (text label), `genre_id` -> genres, `cover_url`, `cover_tone`, `is_demo`, `view_count` (+1 the first time a person starts one of its episodes), `created_at` |
| `episodes` | public | `id`, `series_id` -> series, `number`, `title`, `duration_seconds`, `coin_price` (0 = free), `video_url` (HLS), `created_at`; unique `(series_id, number)` |
| `follows` | public | `user_id`, `series_id` -> series, `created_at`; primary key `(user_id, series_id)` |
| `watch_history` | private | `user_id` -> profiles, `episode_id` -> episodes, `position_seconds`, `completed`, `updated_at` |
| `coin_transactions` | private | `id`, `user_id`, `amount` (+ earns, - spends), `type` (`purchase` / `unlock` / `bundle` / `check_in` / `reward` / `ad`), `episode_id`, `series_id` (bundle), `coin_purchase_id`, `note`, `created_at` |
| `unlocked_episodes` | private | `user_id` -> profiles, `episode_id` -> episodes, `coin_transaction_id`, `method` (`coins` / `bundle` / `ad`), `unlocked_at` |
| `daily_check_ins` | private | `user_id` -> profiles, `day`, `streak_day`, `coin_transaction_id`; primary key `(user_id, day)`. `profiles.check_in_streak` / `last_check_in_day` hold the streak |
| `ad_sessions` | private | `id` (uuid), `user_id`, `episode_id`, `provider`, `day`, `started_at`, `completed_at` |
| `coin_purchases` | private | `id`, `user_id`, `stripe_session_id` (unique), `package_id`, `coins`, `amount_cents`, `currency`, `status` (`pending` / `credited`), `coin_transaction_id`, `created_at`, `credited_at` |
| `stripe_events` | private | `event_id` (primary key), `type`, `stripe_session_id`, `received_at` |

The Phase 0 tables `series_follows`, `coin_balances` and `episode_unlocks` are left in place but no longer read.
Existing follows are copied into `follows` and the ledger column `kind` becomes `type`.

## API

Public (guests may read): `GET /api/genres`, `GET /api/series[?genre=<slug>]`, `GET /api/series/:slug`
(with `viewCount`, the viewer's own progress per episode and `continueEpisode`), `GET /api/series/:slug/related`,
`GET /api/series/:slug/episodes`, `GET /api/episodes/:id`. A locked episode's `videoUrl` is `null`.

Needs the platform token (signed-in only, own rows only): `PUT|DELETE /api/series/:slug/follow`,
`GET /api/me`, `GET /api/me/follows`, `GET|PUT /api/me/watch-history[/:episodeId]`,
`POST /api/me/watch-history/:episodeId/play` (the watch screen records an opened free or unlocked episode),
`GET /api/me/unlocked`, `GET /api/me/coin-transactions[?before=<id>]` (50 a page, with a `label`),
`GET|POST /api/me/check-in`, `POST /api/episodes/:id/unlock`, `POST /api/series/:slug/unlock-all`
(`{ expectedPrice }`), `GET /api/ads/quota`, `POST /api/ads/sessions`, `POST /api/ads/sessions/:id/complete`,
`POST /api/store/checkout`, `GET /api/store/purchases/:sessionId`. `GET /api/store` is public;
`POST /api/stripe/webhook` takes no token and is authenticated by Stripe's signature.

## Demo data and the seed

`lib/seed.ts` adds 5 demo series x 20 episodes (series flagged `is_demo`, placeholder tinted covers,
Apple's public HLS test streams, the first few episodes free). It is idempotent. It runs automatically
on every **staging** start and never in production. To run it by hand:

```sh
npm run build
DATABASE_URL=postgres://... npm run seed   # refuses when USERNODE_ENV=production
```

## Run and test

```sh
npm ci --include=dev
npm run build                      # public/tailwind.css and dist/
USERNODE_ENV=staging DATABASE_URL=postgres://... npm start
DATABASE_URL=postgres://... npm test   # schema, seed, queries and routes against a real Postgres
```

The app needs a platform-issued token for its API, so open it inside Homeroom.
