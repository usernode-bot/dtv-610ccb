// The series manager's API, for admins only (ADMIN_USERNAMES; see lib/admin.ts).
// A failed validation answers 400 { error: 'invalid', fields: { <field>: message } }.

import express from 'express';
import type { Pool } from 'pg';
import { wrap } from '../../lib/auth';
import {
  addEpisodes, createSeries, deleteEpisode, deleteSeries, episodeCount, genreSlugs, getAdminSeries,
  listAdminSeries, requireAdmin, setPublished, updateSeries, validateEpisodes, validateSeries,
} from '../../lib/admin';

export function adminRouter(pool: Pool): express.Router {
  const router = express.Router();
  router.use(requireAdmin);

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
