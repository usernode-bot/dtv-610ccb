# Dtv

Watch movies and dramas together with the group. Express + TypeScript server
with Postgres. The catalogue: a series browse screen (`/`) and a series detail
page (`/series/<slug>`: cover, genre, expandable description, episode and view
counts, Watch now / Continue, follow, share, a 5-per-row episode grid and related
series), and My List (`/my-list`: the series you follow, and `/my-list/history`: episodes you
opened, most recent first), plain JS in `public/`. Episodes link to `/watch/<episodeId>`, a
placeholder until the player lands; locked episodes call `window.dtv.openUnlockSheet`
(a stub until the unlock sheet lands). There is no player, payment or ad support yet.

The app is installable (`public/manifest.webmanifest`, `public/sw.js`, offline page `public/offline.html`),
in English and Indonesian (`public/js/i18n.js`; a Language menu at the bottom of the series screen), and
each page gets its own title, description and Open Graph tags from the server. `/sitemap.xml` lists every
series page and `/robots.txt` points at it.

## Series manager (admins)

`/admin` lets app admins add, edit, publish/unpublish and delete series, and add episodes in bulk
(`/admin/series/<id>/episodes`: video URL, duration, subtitle language, free or locked). Admins are the
usernames in the `ADMIN_USERNAMES` app secret (comma separated; set it in App secrets). Everyone else sees
"Only Dtv admins can manage series". Viewers only ever see series with `is_published`; series from before
the manager stay published, a newly added one starts unpublished and needs at least one episode to publish.
Posters and banners upload through the platform's file storage (`usernode.uploadFile`) and are saved as
`poster_url` / `banner_url`. Locked episodes cost 15 coins (long) or 3 coins (short). Every field is checked in
the page and again on the server (`lib/admin.ts`), with a message under each field that fails.

API (admins only, 403 `admin_required` otherwise): `GET|POST /api/admin/series`,
`GET|PUT|DELETE /api/admin/series/:id`, `PUT /api/admin/series/:id/published`,
`POST /api/admin/series/:id/episodes`, `DELETE /api/admin/episodes/:id`. A failed check answers
400 `{ error: 'invalid', fields: { <field>: message } }`.

## Layout

- `app/`: the Express server (`server.ts`: platform auth, boot, graceful shutdown) and `app/routes/`.
- `lib/`: the pg pool (`db.ts`), schema (`schema.ts`), queries (`catalogue.ts`, `me.ts`), demo seed (`seed.ts`, `seed-cli.ts`),
  analytics (`analytics.ts`), the guest catalogue cache (`cache.ts`), rate limiting (`rate-limit.ts`),
  Sentry reporting (`monitoring.ts`) and page metadata, robots and sitemap (`seo.ts`).
- `scripts/bundle-report.js`: bundle analysis (`npm run analyze`).
- `types/`: shared API types and the Express request augmentation.
- `components/`, `hooks/`: reserved for the UI; empty for now.
- `public/`: the current browse and detail screens. `styles/` and `tailwind.config.js`: Tailwind.

## Schema

Applied on every start by `lib/schema.ts` (all `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
Private tables (also listed in `dapp.json`) are marked `staging:private`: their schema is copied to staging, their rows are not.

| Table | Visibility | Columns |
|---|---|---|
| `profiles` | private | `id` (Homeroom user id), `username`, `avatar_url`, `coin_balance` (>= 0), `favorite_genres`, `onboarded_at`, `role` (`user` / `admin`), `banned`, `created_at` |
| `genres` | public | `id`, `slug`, `name`, `created_at` |
| `series` | public | `id`, `slug`, `title`, `is_published` (viewers see only published), `original_title` (Hanzi/Hangul), `synopsis`, `description` (read-only alias of `synopsis`), `country` (`china` / `korea`), `format` (`long` / `short`), `genres` (text[]), `genre` (primary label), `genre_id` -> genres, `release_year`, `status` (`ongoing` / `completed`), `poster_url`, `banner_url`, `total_episodes`, `rating` (0-10), `is_featured`, `cover_url`, `cover_tone`, `is_demo`, `view_count` (+1 the first time a person starts one of its episodes), `created_at` |
| `episodes` | public | `id`, `series_id` -> series, `number`, `title`, `duration_seconds`, `coin_price` (0 = free), `video_url` (HLS), `subtitle_langs` (text[], BCP-47), `created_at`; read-only aliases `episode_number` (= `number`), `duration_sec` (= `duration_seconds`), `is_free` (= `coin_price = 0`); unique `(series_id, number)` |
| `follows` | public | `user_id`, `series_id` -> series, `created_at`; primary key `(user_id, series_id)` |
| `watch_history` | private | `user_id` -> profiles, `episode_id` -> episodes, `position_seconds`, `completed`, `updated_at` |
| `coin_transactions` | private | `id`, `user_id`, `amount` (+ earns, - spends), `type` (`purchase` / `unlock` / `reward` / `ad` / `admin`), `episode_id`, `note` (an admin adjustment's reason), `actor_id` (the admin who made it), `created_at` |
| `unlocked_episodes` | private | `user_id` -> profiles, `episode_id` -> episodes, `coin_transaction_id`, `unlocked_at` |
| `analytics_events` | private | `id`, `user_id`, `name` (`play` / `complete` / `unlock` / `purchase` / `drop_off`), `episode_id`, `series_id`, `position_seconds`, `props` (JSON), `created_at` |

The drama columns are nullable (older rows have none). `country`, `format`, `status`, `release_year`,
`total_episodes` and `rating` are checked by constraints. Formats: `long` is 16-40 episodes of 45-70 min
(landscape), `short` is 40-100 episodes of 1-3 min (vertical 9:16). The aliases are generated columns so the
existing queries keep working: write `synopsis`, `number`, `duration_seconds` and `coin_price`.

The Phase 0 tables `series_follows`, `coin_balances` and `episode_unlocks` are left in place but no longer read.
Existing follows are copied into `follows` and the ledger column `kind` becomes `type`.

## API

Public (guests may read): `GET /api/genres`, `GET /api/series[?genre=<slug>]`, `GET /api/series/:slug`
(with `viewCount`, the viewer's own progress per episode and `continueEpisode`), `GET /api/series/:slug/related`,
`GET /api/series/:slug/episodes`, `GET /api/episodes/:id`. A locked episode's `videoUrl` is `null`.

Needs the platform token (signed-in only, own rows only): `PUT|DELETE /api/series/:slug/follow`,
`GET /api/me`, `GET /api/me/follows`, `GET|PUT /api/me/watch-history[/:episodeId]`,
`POST /api/me/watch-history/:episodeId/play` (the watch screen records an opened free or unlocked episode),
`GET /api/me/unlocked`, `GET /api/me/coin-transactions`, `POST /api/events` (the page reports `drop_off`:
`{ name, episodeId, positionSeconds }`), `POST /api/client-errors` (the page's uncaught errors, passed to Sentry).

Also public: `GET /api/series/:slug/drop-off`, per-episode viewers, completions, drop-offs and retention
(counts only). The guest view of the catalogue is cached in memory for 30 seconds and refreshed in the
background; a signed-in person's view is always live.

## Analytics, monitoring and limits

- **Analytics** (`analytics_events`): the server records `play` (the watch screen opened an episode),
  `complete` (progress saved as finished, once), `unlock` (coins spent) and is ready to record `purchase`
  when coin purchases exist (`trackEvent` in `lib/analytics.ts`); the page records `drop_off` when someone
  leaves a playable episode before the end. A player reports its position with `window.dtv.reportPlayback(seconds, completed)`.
- **Errors**: set the private secret `SENTRY_DSN` to send server errors and the page's uncaught errors to
  Sentry. Unset (and always in staging) nothing is sent.
- **Rate limits**: per person (or address, signed out) per minute, 300 reads and 60 writes on `/api`;
  past that the API answers 429 `rate_limited` with `Retry-After`.
- **Bundle size**: `npm run analyze` lists every file the page downloads, raw and gzipped, against a
  budget per kind (`-- --check` exits 1 when one is over).

## Admin

The `ADMIN_USERNAMES` setting (in `dapp.json`, set in the platform's Secrets panel; comma separated,
case-insensitive) gives those people the `admin` role when they sign in. Admins can make others admin from
the Users page; someone listed in the setting cannot be demoted there. Every request re-reads the person's
role and ban state (`attachAccount` in `lib/auth.ts`): a banned person's API calls get 403 `banned`, `/admin`
pages send non-admins to `/`, and `/api/admin/*` answers 403 `admin_only` to anyone but an admin.

Screens: `/admin` (total users, daily active users, revenue as coins bought, coins spent on unlocks, top
series), `/admin/users` (search) and `/admin/users/<id>` (adjust coins with a reason, ban / unban, make or
remove admin, recent coin activity). API: `GET /api/admin/stats`, `GET /api/admin/users[?q=]`,
`GET /api/admin/users/:id`, `POST /api/admin/users/:id/coins` `{ amount, reason }`,
`PUT /api/admin/users/:id/ban` `{ banned }`, `PUT /api/admin/users/:id/role` `{ role }`.
Staging also seeds four fake accounts (`staging-demo-viewer-1` to `-4`) with a few purchases and unlocks.

## Demo data and the seed

`lib/seed.ts` adds 5 demo series x 20 episodes (series flagged `is_demo`, placeholder tinted covers,
Apple's public HLS test streams, the first few episodes free). It is idempotent. It runs automatically
on every **staging** start and never in production. To run it by hand:

```sh
npm run build
DATABASE_URL=postgres://... npm run seed   # refuses when USERNODE_ENV=production
```

### The drama catalogue

`lib/seed-dramas.ts` adds 16 original, fictional dramas: 4 Chinese long (historical romance, wuxia-style
adventure, modern office, fantasy), 4 Chinese short (hidden-identity chairman, rebirth, contract marriage,
mistaken identity), 4 Korean long (romantic comedy, medical, music mystery, family melodrama) and 4 Korean
short (chaebol heir romance, school comeback, time slip, second-chance marriage). Each has a synopsis, 2-3
genres, a release year, 5 hand-written episodes and generated "Episode N" rows up to `total_episodes`. Long
dramas have 3 free episodes (then 15 coins each), short dramas 10 (then 3 coins).

Placeholders, each marked `// PLACEHOLDER: replace with licensed content` in that file: posters and banners
are generated gradient SVG cards (data URIs) with the title, and every episode plays one of Apple's public HLS
test streams. Replace them with licensed artwork and footage before this content goes to real viewers.

It is idempotent: series are upserted by `slug` and episodes by `(series_id, number)`. Re-running updates the
seeded fields of `is_demo` rows in place, removes episodes past a lowered `total_episodes`, never touches a
non-demo series with the same slug, and never changes view counts, follows, history, coins or unlocks. It
runs with the demo seed: on every staging start, and by hand with the same command:

```sh
npm run build
DATABASE_URL=postgres://... npm run seed   # schema + demo + drama catalogue; refuses when USERNODE_ENV=production
```

## Run and test

```sh
npm ci --include=dev
npm run build                      # public/tailwind.css and dist/
USERNODE_ENV=staging DATABASE_URL=postgres://... npm start
DATABASE_URL=postgres://... npm test   # schema, seed, queries and routes against a real Postgres
```

The app needs a platform-issued token for its API, so open it inside Homeroom.
