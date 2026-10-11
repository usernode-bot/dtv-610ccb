# Dtv

Watch movies and dramas together with the group. Express + TypeScript server
with Postgres. The front end (plain JS in `public/`) has four tabs: Home (hero carousel of
featured series, Continue watching, Trending now, New releases and one row per top genre),
Discover (debounced title search and genre chips), My list (followed series) and Profile
(coins and recently watched), plus the series detail screen. There is no player, payment or
ad support yet.

## Layout

- `app/`: the Express server (`server.ts`: platform auth, boot, graceful shutdown) and `app/routes/`.
- `lib/`: the pg pool (`db.ts`), schema (`schema.ts`), queries (`catalogue.ts`, `home.ts`, `me.ts`), demo seed (`seed.ts`, `seed-cli.ts`).
- `types/`: shared API types and the Express request augmentation.
- `components/`, `hooks/`: reserved for the UI; empty for now.
- `public/`: the tabs and the detail screen (`js/app.js`, hash routes `#/`, `#/discover?q=&genre=`, `#/my-list`, `#/profile`, `#/series/<slug>`). `styles/` and `tailwind.config.js`: Tailwind.

## Schema

Applied on every start by `lib/schema.ts` (all `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
Private tables (also listed in `dapp.json`) are marked `staging:private`: their schema is copied to staging, their rows are not.

| Table | Visibility | Columns |
|---|---|---|
| `profiles` | private | `id` (Homeroom user id), `username`, `avatar_url`, `coin_balance` (>= 0), `created_at` |
| `genres` | public | `id`, `slug`, `name`, `created_at` |
| `series` | public | `id`, `slug`, `title`, `synopsis`, `genre` (text label), `genre_id` -> genres, `cover_url`, `cover_tone`, `is_demo`, `featured_rank` (hero order, NULL = not featured), `created_at` |
| `episodes` | public | `id`, `series_id` -> series, `number`, `title`, `duration_seconds`, `coin_price` (0 = free), `video_url` (HLS), `created_at`; unique `(series_id, number)` |
| `follows` | public | `user_id`, `series_id` -> series, `created_at`; primary key `(user_id, series_id)` |
| `watch_history` | private | `user_id` -> profiles, `episode_id` -> episodes, `position_seconds`, `completed`, `updated_at` |
| `coin_transactions` | private | `id`, `user_id`, `amount` (+ earns, - spends), `type` (`purchase` / `unlock` / `reward` / `ad`), `episode_id`, `note`, `created_at` |
| `unlocked_episodes` | private | `user_id` -> profiles, `episode_id` -> episodes, `coin_transaction_id`, `unlocked_at` |

The Phase 0 tables `series_follows`, `coin_balances` and `episode_unlocks` are left in place but no longer read.
Existing follows are copied into `follows` and the ledger column `kind` becomes `type`.

## API

Public (guests may read): `GET /api/viewer` (signed in or not, and coins), `GET /api/home` (everything
Home shows; `continueWatching` is null for a guest), `GET /api/genres`,
`GET /api/series[?genre=<slug>][&q=<title text>]`, `GET /api/series/:slug`,
`GET /api/series/:slug/episodes`, `GET /api/episodes/:id`. A locked episode's `videoUrl` is `null`.

Needs the platform token (signed-in only, own rows only): `PUT|DELETE /api/series/:slug/follow`,
`GET /api/me`, `GET /api/me/follows`, `GET|PUT /api/me/watch-history[/:episodeId]`,
`GET /api/me/unlocked`, `GET /api/me/coin-transactions`.

Home's rankings: the hero is `featured_rank` order, topped up from trending to 5. Trending is follows
plus plays in the last 7 days (as of the request's `req.now`), ties to the oldest series. New releases
is newest `series.created_at` first. Genre rows are the 3 genres with the most series.

## Demo data and the seed

`lib/seed.ts` adds 5 demo series x 20 episodes (series flagged `is_demo`, placeholder tinted covers,
Apple's public HLS test streams, the first few episodes free, all featured in seed order). It is idempotent. It runs automatically
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
