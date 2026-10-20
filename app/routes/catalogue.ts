// Public read-only routes (guests may read) plus follow and unlock (one episode
// or the rest of a series), which need an account.

import express from 'express';
import type { Pool } from 'pg';
import { requireUser, userId, wrap } from '../../lib/auth';
import {
  getEpisode, getSeries, getWatchPayload, listEpisodes, listGenres, listRelated, listSeries, setFollow,
} from '../../lib/catalogue';
import { ensureProfile, unlockEpisode } from '../../lib/me';
import { unlockSeriesBundle } from '../../lib/coins';
import { CLIENT_EVENT_NAMES, episodeDropOff, trackEvent, type EventName } from '../../lib/analytics';
import { SwrCache } from '../../lib/cache';

export function catalogueRouter(
  pool: Pool, opts: { isStaging: boolean; cacheMs?: number },
): express.Router {
  const router = express.Router();

  // The guest view of the catalogue is the same for every guest, so with
  // cacheMs set it is answered from memory and refreshed in the background
  // (lib/cache.ts). A signed-in person's view carries their own follows and
  // progress and always comes straight from the database.
  const cache = opts.cacheMs ? new SwrCache<unknown>(opts.cacheMs) : null;
  function forViewer<T>(req: express.Request, key: string, load: () => Promise<T>): Promise<T> {
    if (!cache || userId(req) !== null) return load();
    return cache.get(key, load) as Promise<T>;
  }

  router.get('/genres', wrap(async (req, res) => {
    res.json({ genres: await forViewer(req, 'genres', () => listGenres(pool)) });
  }));

  router.get('/series', wrap(async (req, res) => {
    const genre = typeof req.query.genre === 'string' ? req.query.genre : undefined;
    const series = await forViewer(req, 'series:' + (genre || ''), () => listSeries(pool, userId(req), genre));
    res.json({ demo: opts.isStaging, series });
  }));

  router.get('/series/:slug', wrap(async (req, res) => {
    const slug = String(req.params.slug);
    const series = await forViewer(req, 'detail:' + slug, () => getSeries(pool, slug, userId(req)));
    if (!series) return void res.status(404).json({ error: 'not_found' });
    res.json({ demo: opts.isStaging, series });
  }));

  router.get('/series/:slug/related', wrap(async (req, res) => {
    const slug = String(req.params.slug);
    const series = await forViewer(req, 'related:' + slug, () => listRelated(pool, slug, userId(req)));
    if (!series) return void res.status(404).json({ error: 'not_found' });
    res.json({ series });
  }));

  router.get('/series/:slug/episodes', wrap(async (req, res) => {
    const slug = String(req.params.slug);
    const episodes = await forViewer(req, 'episodes:' + slug, () => listEpisodes(pool, slug, userId(req)));
    if (!episodes) return void res.status(404).json({ error: 'not_found' });
    res.json({ episodes });
  }));

  // Per-episode drop-off for a series: counts only, nobody is named.
  router.get('/series/:slug/drop-off', wrap(async (req, res) => {
    const episodes = await episodeDropOff(pool, String(req.params.slug));
    if (!episodes) return void res.status(404).json({ error: 'not_found' });
    res.json({ episodes });
  }));

  // Events only the page can see (leaving an episode early). Play, complete,
  // unlock and purchase are recorded by the server where they happen.
  router.post('/events', requireUser, wrap(async (req, res) => {
    const name = req.body?.name;
    const episodeId = Number(req.body?.episodeId);
    const position = req.body?.positionSeconds === undefined ? null : Number(req.body.positionSeconds);
    if (typeof name !== 'string' || !CLIENT_EVENT_NAMES.has(name) || !Number.isInteger(episodeId)
      || (position !== null && (!Number.isInteger(position) || position < 0))) {
      return void res.status(400).json({ error: 'invalid_event' });
    }
    if (!(await getEpisode(pool, episodeId, null))) return void res.status(404).json({ error: 'not_found' });
    await ensureProfile(pool, userId(req)!, String(req.user!.username));
    await trackEvent(pool, { userId: userId(req)!, name: name as EventName, episodeId, positionSeconds: position });
    res.status(202).json({ recorded: true });
  }));

  router.get('/episodes/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const episode = Number.isInteger(id) ? await getEpisode(pool, id, userId(req)) : null;
    if (!episode) return void res.status(404).json({ error: 'not_found' });
    res.json({ episode });
  }));

  // The player: one episode, its series, the series as the swipe feed, and the
  // viewer's saved position. Guests may read it (resume is null for them).
  router.get('/watch/:episodeId', wrap(async (req, res) => {
    const id = Number(req.params.episodeId);
    const payload = Number.isInteger(id) ? await getWatchPayload(pool, id, userId(req)) : null;
    if (!payload) return void res.status(404).json({ error: 'not_found' });
    res.json({ demo: opts.isStaging, ...payload });
  }));

  // Spend coins on a paid episode. Guests are refused with account_required.
  router.post('/episodes/:id/unlock', requireUser, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return void res.status(404).json({ error: 'not_found' });
    await ensureProfile(pool, userId(req)!, String(req.user!.username));
    const result = await unlockEpisode(pool, userId(req)!, id);
    if (result === 'not_found') return void res.status(404).json({ error: 'not_found' });
    if (result === 'not_enough_coins') return void res.status(402).json({ error: 'not_enough_coins' });
    if (result.spent > 0) {
      await trackEvent(pool, { userId: userId(req)!, name: 'unlock', episodeId: id, props: { coins: result.spent } });
    }
    res.json({ episode: await getEpisode(pool, id, userId(req)), coinBalance: result.coinBalance });
  }));

  // Unlock every remaining paid episode of a series at the bundle price the
  // person was shown (expectedPrice); a changed price answers 409 with the new one.
  router.post('/series/:slug/unlock-all', requireUser, wrap(async (req, res) => {
    const expected = req.body?.expectedPrice;
    if (!Number.isInteger(expected) || expected < 0) return void res.status(400).json({ error: 'invalid_price' });
    await ensureProfile(pool, userId(req)!, String(req.user!.username));
    const r = await unlockSeriesBundle(pool, userId(req)!, String(req.params.slug), expected);
    if (r.status === 'ok') return void res.json({ coinBalance: r.coinBalance, unlockedCount: r.unlockedCount });
    if (r.status === 'not_found') return void res.status(404).json({ error: 'not_found' });
    if (r.status === 'not_enough_coins') return void res.status(402).json({ error: 'not_enough_coins' });
    if (r.status === 'price_changed') return void res.status(409).json({ error: 'price_changed', bundle: r.bundle });
    res.status(409).json({ error: 'nothing_to_unlock' });
  }));

  router.put('/series/:slug/follow', requireUser, wrap(async (req, res) => {
    const following = await setFollow(pool, String(req.params.slug), userId(req)!, true);
    if (following === null) return void res.status(404).json({ error: 'not_found' });
    res.json({ following });
  }));
  router.delete('/series/:slug/follow', requireUser, wrap(async (req, res) => {
    const following = await setFollow(pool, String(req.params.slug), userId(req)!, false);
    if (following === null) return void res.status(404).json({ error: 'not_found' });
    res.json({ following });
  }));

  return router;
}
