# Dtv — notes for Claude Code

This app runs on **Homeroom**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Homeroom's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom's dev-chat
the platform fixes the base commit, and none of this applies.

## Starter template

The screen this app currently ships — the "Starter template" hero with
the app's thumbnail tile and the plain-English note on how the app gets
built (by asking Homeroom bot) — is placeholder content from the
Homeroom starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- rewrite `README.md` to describe the actual app.

Keep the `usernode-dev-console@1` forwarder `<script>` when rewriting the
HTML — that block is platform infrastructure, not template content. So is
the bridge `<script>`. The design kit is not placeholder either: build the
real app with it, and fill in "## Design" below.

The screen has a light and a dark look and follows the viewer's Homeroom
theme, switching live when they change it: the theme `<script>` right after
the bridge tag sets a `dark` class on `<html>`. Keep that script, and give
everything you build both looks (the design kit's colour tokens carry both), unless one
fixed look is the point of this app, like a game's own scene; then say so
under "## Design" below. Unless a request asks for one, add
no theme picker: the viewer's Homeroom setting is the control. "The
platform's light/dark theme inside the app frame" in the platform
conventions has the details.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Dtv

Watch movies and dramas together with the group

Phase 1 ships the catalogue (browse series, series detail, follow). Phase 2 adds Homeroom sign-in: a `profiles` row per person on their first
authenticated request, a genre onboarding (pick 3 or more, saved to
`profiles.favorite_genres`) shown until done, and coin unlocks. Guests browse
and see free episodes; follow, unlock and saving genres answer 401
`account_required` with an `action`. Episodes are
free (`coin_price` 0) or locked behind coins; the player, payments and ads come
later. Content must stay wholesome and neutral (rated None).

## Design

This app's look. The first real version fills in the blanks; every later
change follows it, and updates it when a request changes the look on purpose.

- **Palette:** accent: teal; neutrals: warm greys (the kit defaults in `styles/tailwind-input.css`)
- **Signature element:** series covers are tinted tiles with the title's initial until real artwork exists (`cover_url`)
- **Layout:** the page shell is wide (`max-w-6xl`), not a narrow column. Every poster grid (browse, My List following, related series) shares the `POSTER_GRID` literal in `public/js/app.js`: 2 columns on a phone, 3 on a large phone or small tablet, 4 on a tablet, 5 on a laptop, 6 on a wide screen. Detail and history screens keep readable widths (`max-w-prose` synopsis, `sm:max-w-md` action row, `max-w-2xl` history list); the episode grid is 5/8/10 columns across the same ladder.
- **Header:** a sticky "Dtv" bar (`#app-header` in `public/index.html`) runs across the top of every screen, with a back chevron at its left edge on every screen below browse (set per route via `setHeader`; `null` on browse). It never holds an exit control: the X close button and the URL hint are the Homeroom frame's own, and leaving the app is the frame's job.
- **Onboarding is always dark:** the genre onboarding layer carries the `dark`
  class itself, so it keeps its cinematic dark look in both themes. Every other
  screen follows the viewer's theme.
- **Type scale:** `text-title`, `text-heading`, `text-body`, `text-small`
  _(change their sizes in `tailwind.config.js` if you must, not their number)_

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and a few components
(`btn-primary`, `btn-secondary`, `field`, `list` and `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. 5.0"), never a bare value that could pass for one
  already entered.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry.
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions).
- No cards in cards, no uppercase eyebrows, no emoji as icons.

## App-specific conventions

- **Every string a person reads goes through `t(key)`** from `public/js/i18n.js`,
  with an English and an Indonesian value. Add both when adding a string.
- **Analytics events are recorded server-side where they happen**
  (`trackEvent` in `lib/analytics.ts`); the page only sends `drop_off`.
  `analytics_events` is private.
- **Only the guest view of the catalogue is cached** (`SwrCache`); never cache
  anything that carries a person's own follows, progress or coins.
- The service worker never caches `/api/*`, pages or the platform's
  `/usernode-*` files; bump `CACHE` in `public/sw.js` when its file list changes.
- App admins (the series manager at `/admin`) are the usernames in the
  `ADMIN_USERNAMES` secret, checked on the server by `lib/admin.ts`. Viewer
  queries only ever return `series.is_published` rows.
