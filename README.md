# Dtv

Watch movies and dramas together with the group. Express + TypeScript server
with Postgres. The catalogue: a series browse screen (`/`) and a series detail
page (`/series/<slug>`: cover, genre, expandable description, episode and view
counts, Watch now / Continue, follow, share, a 5-per-row episode grid and related
series), and My List (`/my-list`: the series you follow, and `/my-list/history`: episodes you
opened, most recent first), plain JS in `public/`, plus the genre onboarding and a full-screen
vertical player at `#/watch/<episodeId>` (or `#/watch/<series-slug>/<number>`). There is no payment or ad support yet.

## Player

`public/js/player.js`, opened by the router in `public/js/app.js`. Swipe up or down (arrow keys
or the wheel on a computer) to move through the series; tap to pause, double-tap the left or right
third to jump 10 s, press and hold for 2x. Streams play through hls.js (served from the npm package at
`/vendor/hls.light.min.js`) with adaptive bitrate, or the browser's own HLS where hls.js cannot run.
It keeps three slides (previous, current, next, the next one preloading) and destroys each stream
as it leaves that window. Signed-in viewers' progress is saved every 5 s and on pause, swipe and
leave, and resumed. Episodes end with a 5 s countdown to the next one. Locked episodes show a lock
card whose `openUnlockSheet` is the hook for the Phase 6 unlock sheet. Mute and the WebVTT
subtitles toggle (`episodes.subtitles_url`) last for the visit.

## Layout

- `app/`: the Express server (`server.ts`: platform auth, boot, graceful shutdown) and `app/routes/`.
- `lib/`: the pg pool (`db.ts`), schema (`schema.ts`), queries (`catalogue.ts`, `me.ts`), demo seed (`seed.ts`, `seed-cli.ts`).
- `types/`: shared API types and the Express request augmentation.
- `components/`, `hooks/`: reserved for the UI; empty for now.
- `public/`: the screens (`js/app.js`) and the player (`js/player.js`); `public/demo/` holds staging-only demo files. `styles/` and `tailwind.config.js`: Tailwind.

## Schema

Applied on every start by `lib/schema.ts` (all `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
Private tables (also listed in `dapp.json`) are marked `staging:private`: their schema is copied to staging, their rows are not.

| Table | Visibility | Columns |
|---|---|---|
| `profiles` | private | `id` (Homeroom user id), `username`, `avatar_url`, `coin_balance` (>= 0), `created_at` |
| `genres` | public | `id`, `slug`, `name`, `created_at` |
| `series` | public | `id`, `slug`, `title`, `synopsis`, `genre` (text label), `genre_id` -> genres, `cover_url`, `cover_tone`, `is_demo`, `view_count` (+1 the first time a person starts one of its episodes), `created_at` |
| `episodes` | public | `id`, `series_id` -> series, `number`, `title`, `duration_seconds`, `coin_price` (0 = free), `video_url` (HLS), `subtitles_url` (WebVTT), `created_at`; unique `(series_id, number)` |
| `follows` | public | `user_id`, `series_id` -> series, `created_at`; primary key `(user_id, series_id)` |
| `watch_history` | private | `user_id` -> profiles, `episode_id` -> episodes, `position_seconds`, `completed`, `updated_at` |
| `coin_transactions` | private | `id`, `user_id`, `amount` (+ earns, - spends), `type` (`purchase` / `unlock` / `reward` / `ad`), `episode_id`, `note`, `created_at` |
| `unlocked_episodes` | private | `user_id` -> profiles, `episode_id` -> episodes, `coin_transaction_id`, `unlocked_at` |

The Phase 0 tables `series_follows`, `coin_balances` and `episode_unlocks` are left in place but no longer read.
Existing follows are copied into `follows` and the ledger column `kind` becomes `type`.

## API

Public (guests may read): `GET /api/genres`, `GET /api/series[?genre=<slug>]`, `GET /api/series/:slug`
(with `viewCount`, the viewer's own progress per episode and `continueEpisode`), `GET /api/series/:slug/related`,
`GET /api/series/:slug/episodes`, `GET /api/episodes/:id`, and `GET /api/watch/:episodeId` (the player:
the episode, its series, the series' episodes in order and the viewer's saved position, `null` for guests).
A locked episode's `videoUrl` and `subtitlesUrl` are `null`.

Needs the platform token (signed-in only, own rows only): `PUT|DELETE /api/series/:slug/follow`,
`GET /api/me`, `GET /api/me/follows`, `GET|PUT /api/me/watch-history[/:episodeId]`,
`POST /api/me/watch-history/:episodeId/play` (the watch screen records an opened free or unlocked episode),
`GET /api/me/unlocked`, `GET /api/me/coin-transactions`.

## Demo data and the seed

`lib/seed.ts` adds 5 demo series x 20 episodes (series flagged `is_demo`, placeholder tinted covers,
Apple's public HLS test streams, a fake WebVTT file at `public/demo/staging-subtitles.vtt`, the first few episodes free). It is idempotent. It runs automatically
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
