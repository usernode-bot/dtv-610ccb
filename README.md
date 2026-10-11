# Dtv

Watch movies and dramas together with the group. Phase 1 is the catalogue:
a series browse screen and a series detail screen. There is no player,
payment or ad support yet.

## What is here

- `server.js`: Express server, platform auth, boot (migrate, seed, listen), graceful shutdown.
- `db/schema.js`: idempotent migrations for `series`, `episodes`, `series_follows`,
  `coin_balances`, `coin_transactions` and `episode_unlocks`. The three coin and
  unlock tables are marked `staging:private`.
- `db/seed.js`: six wholesome demo series with episodes (first few free, the rest priced in coins).
- `db/series.js`: queries (list, detail with free / unlocked / locked episodes, follow).
- `routes/series.js`: `GET /api/series`, `GET /api/series/:slug`, `PUT|DELETE /api/series/:slug/follow`.
- `public/js/app.js`: the two screens (`#/` browse, `#/series/<slug>` detail).

Guests can browse; following needs an account.

## Run and test

```sh
npm ci --include=dev
npm run build                      # compiles public/tailwind.css
USERNODE_ENV=staging DATABASE_URL=postgres://... node server.js
DATABASE_URL=postgres://... npm test   # schema, seed and queries against a real Postgres
```

`USERNODE_ENV=staging` seeds the demo catalogue on boot; production never seeds.
The app needs a platform-issued token for its API, so open it inside Homeroom.
