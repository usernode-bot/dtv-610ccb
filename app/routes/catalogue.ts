// Public read-only routes (guests may read) plus follow, which needs an account.

import express from 'express';
import type { Pool } from 'pg';
import { requireUser, userId, wrap } from '../../lib/auth';
import {
  getEpisode, getSeries, listEpisodes, listGenres, listSeries, setFollow,
} from '../../lib/catalogue';

export function catalogueRouter(pool: Pool, opts: { isStaging: boolean }): express.Router {
  const router = express.Router();

  router.get('/genres', wrap(async (_req, res) => {
    res.json({ genres: await listGenres(pool) });
  }));

  router.get('/series', wrap(async (req, res) => {
    const genre = typeof req.query.genre === 'string' ? req.query.genre : undefined;
    res.json({ demo: opts.isStaging, series: await listSeries(pool, userId(req), genre) });
  }));

  router.get('/series/:slug', wrap(async (req, res) => {
    const series = await getSeries(pool, String(req.params.slug), userId(req));
    if (!series) return void res.status(404).json({ error: 'not_found' });
    res.json({ demo: opts.isStaging, series });
  }));

  router.get('/series/:slug/episodes', wrap(async (req, res) => {
    const episodes = await listEpisodes(pool, String(req.params.slug), userId(req));
    if (!episodes) return void res.status(404).json({ error: 'not_found' });
    res.json({ episodes });
  }));

  router.get('/episodes/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const episode = Number.isInteger(id) ? await getEpisode(pool, id, userId(req)) : null;
    if (!episode) return void res.status(404).json({ error: 'not_found' });
    res.json({ episode });
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
