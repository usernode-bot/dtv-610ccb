// Admin API under /api/admin. Every route needs the admin role (requireAdmin):
// anyone else gets 403 admin_only.

import express from 'express';
import type { Pool } from 'pg';
import { requireAdmin, userId, wrap } from '../../lib/auth';
import {
  adjustCoins, dashboardStats, getUser, listUsers, setBanned, setRole,
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

  return router;
}
