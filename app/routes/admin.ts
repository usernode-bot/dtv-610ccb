// Admin API under /api/admin: the dashboard, user management and the series
// manager. Every route needs the admin role (requireAdmin): anyone else gets
// 403 admin_only. A failed series validation answers
// 400 { error: 'invalid', fields: { <field>: message } }.

import express from 'express';
import type { Pool } from 'pg';
import { requireAdmin, userId, wrap } from '../../lib/auth';
import {
  addEpisodes, adjustCoins, createSeries, dashboardStats, deleteEpisode, deleteSeries, episodeCount,
  genreSlugs, getAdminSeries, getUser, listAdminSeries, listUsers, setBanned, setPublished, setRole,
  updateSeries, validateEpisodes, validateSeries,
} from '../../lib/admin';

const STATUS: Record<string, number> = { not_found: 404 };

export function adminRouter(pool: Pool): express.Router {
  const router = express.Router();
  router.use(requireAdmin);

  // Answer a result that is either the updated thing or an error code.
  function reply(res: express.Response, result: unknown, key: string) {
    if (typeof result === 'string') return void res.status(STATUS[result] || 400).json({ error: result });
    res.json({ [key]: result });
  }

  router.get('/stats', wrap(async (req, res) => {
    res.json({ stats: await dashboardStats(pool, req.now) });
  }));

  router.get('/users', wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 64) : '';
    res.json({ users: await listUsers(pool, q) });
  }));

  router.get('/users/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const found = Number.isInteger(id) ? await getUser(pool, id) : null;
    if (!found) return void res.status(404).json({ error: 'not_found' });
    res.json(found);
  }));

  router.post('/users/:id/coins', wrap(async (req, res) => {
    reply(res, await adjustCoins(pool, userId(req)!, Number(req.params.id), req.body?.amount, req.body?.reason), 'result');
  }));

  router.put('/users/:id/ban', wrap(async (req, res) => {
    reply(res, await setBanned(pool, userId(req)!, Number(req.params.id), req.body?.banned === true), 'user');
  }));

  router.put('/users/:id/role', wrap(async (req, res) => {
    reply(res, await setRole(pool, userId(req)!, Number(req.params.id), req.body?.role), 'user');
  }));

  const idParam = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  router.get('/series', wrap(async (_req, res) => {
    res.json({ series: await listAdminSeries(pool) });
  }));

  router.post('/series', wrap(async (req, res) => {
    const checked = validateSeries(req.body, await genreSlugs(pool));
    if ('fields' in checked) return void res.status(400).json({ error: 'invalid', fields: checked.fields });
    const id = await createSeries(pool, checked.value);
    res.status(201).json({ series: await getAdminSeries(pool, id) });
  }));

  router.get('/series/:id', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    const series = id && await getAdminSeries(pool, id);
    if (!series) return void res.status(404).json({ error: 'not_found' });
    res.json({ series });
  }));

  router.put('/series/:id', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return void res.status(404).json({ error: 'not_found' });
    const checked = validateSeries(req.body, await genreSlugs(pool), await episodeCount(pool, id));
    if ('fields' in checked) return void res.status(400).json({ error: 'invalid', fields: checked.fields });
    if (!await updateSeries(pool, id, checked.value)) return void res.status(404).json({ error: 'not_found' });
    res.json({ series: await getAdminSeries(pool, id) });
  }));

  router.put('/series/:id/published', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id || typeof req.body?.published !== 'boolean') return void res.status(400).json({ error: 'invalid' });
    const result = await setPublished(pool, id, req.body.published);
    if (result === 'not_found') return void res.status(404).json({ error: 'not_found' });
    if (result === 'no_episodes') {
      return void res.status(400).json({
        error: 'invalid', fields: { published: 'Add at least one episode before publishing.' },
      });
    }
    res.json({ published: result });
  }));

  router.delete('/series/:id', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id || !await deleteSeries(pool, id)) return void res.status(404).json({ error: 'not_found' });
    res.json({ deleted: true });
  }));

  router.post('/series/:id/episodes', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return void res.status(404).json({ error: 'not_found' });
    const checked = validateEpisodes(req.body);
    if ('fields' in checked) return void res.status(400).json({ error: 'invalid', fields: checked.fields });
    const result = await addEpisodes(pool, id, checked.value);
    if (result === 'not_found') return void res.status(404).json({ error: 'not_found' });
    if (typeof result === 'object') return void res.status(400).json({ error: 'invalid', fields: result.fields });
    res.status(201).json({ added: result, series: await getAdminSeries(pool, id) });
  }));

  router.delete('/episodes/:id', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id || !await deleteEpisode(pool, id)) return void res.status(404).json({ error: 'not_found' });
    res.json({ deleted: true });
  }));

  return router;
}
