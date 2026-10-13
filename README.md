# Dtv

Watch movies and dramas together with the group. Express + TypeScript server
with Postgres. The catalogue: a series browse screen (`/`: featured hero, shelves for New
releases, Trending, Chinese short dramas and Korean long dramas, country and format chips,
search on title and original title, a genre filter, and a 2/4/6-column poster grid; filters
live in the address as `?country=cn|kr&format=long|short&genre=<slug>&q=<text>`) and a series detail
page (`/series/<slug>`: cover, genre, expandable description, episode and view
counts, Watch now / Continue, follow, share, a 5-per-row episode grid and related
series), and My List (`/my-list`: the series you follow, and `/my-list/history`: episodes you
opened, most recent first), plain JS in `public/`. Episodes link to `/watch/<episodeId>`, which plays the
episode's HLS stream (natively where the browser can, else with hls.js from `/vendor/hls.min.js`)
and saves progress; locked episodes call `window.dtv.openUnlockSheet`
(a stub until the unlock sheet lands). There is no payment or ad support yet.

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
| `series` | public | `id`, `slug`, `title`, `original_title`, `synopsis`, `genre` (text label), `genre_id` -> genres, `country` (ISO code, e.g. `CN`, `KR`), `format` (`long` / `short`), `rating` (0-10), `is_featured`, `released_on`, `cover_url`, `cover_tone`, `is_demo`, `view_count` (+1 the first time a person starts one of its episodes), `created_at` |
| `episodes` | public | `id`, `series_id` -> series, `number`, `title`, `duration_seconds`, `coin_price` (0 = free), `video_url` (HLS), `created_at`; unique `(series_id, number)` |
| `follows` | public | `user_id`, `series_id` -> series, `created_at`; primary key `(user_id, series_id)` |
| `watch_history` | private | `user_id` -> profiles, `episode_id` -> episodes, `position_seconds`, `completed`, `updated_at` |
| `coin_transactions` | private | `id`, `user_id`, `amount` (+ earns, - spends), `type` (`purchase` / `unlock` / `reward` / `ad`), `episode_id`, `note`, `created_at` |
| `unlocked_episodes` | private | `user_id` -> profiles, `episode_id` -> episodes, `coin_transaction_id`, `unlocked_at` |

The Phase 0 tables `series_follows`, `coin_balances` and `episode_unlocks` are left in place but no longer read.
Existing follows are copied into `follows` and the ledger column `kind` becomes `type`.

## API

Public (guests may read): `GET /api/genres`, `GET /api/series[?genre=<slug>]`, `GET /api/series/:slug`
(with `viewCount`, the viewer's own progress per episode and `continueEpisode`), `GET /api/series/:slug/related`,
`GET /api/series/:slug/episodes`, `GET /api/episodes/:id`. A locked episode's `videoUrl` is `null`.

Needs the platform token (signed-in only, own rows only): `PUT|DELETE /api/series/:slug/follow`,
`GET /api/me`, `GET /api/me/follows`, `GET|PUT /api/me/watch-history[/:episodeId]`,
`POST /api/me/watch-history/:episodeId/play` (the watch screen records an opened free or unlocked episode),
`GET /api/me/unlocked`, `GET /api/me/coin-transactions`.

## Demo data and the seed

`lib/seed.ts` adds 11 demo series (Chinese and Korean, long and short, three featured) x 20 episodes (series flagged `is_demo`, placeholder tinted covers,
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
