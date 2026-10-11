// /api/series routes. Mounted by server.js after the auth middleware, so
// req.user is set for signed-in people and absent for guests (who may read).

const express = require('express');
const { listSeries, getSeries, setFollow } = require('../db/series');

/**
 * @param {import('pg').Pool} pool
 * @param {{isStaging: boolean}} opts  isStaging lets the page label demo content
 * @returns {import('express').Router}
 */
function seriesRouter(pool, opts) {
  const router = express.Router();
  // The platform user id, or null for a guest.
  const uid = (req) => (req.user ? Number(req.user.id) : null);
  const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  });

  router.get('/', wrap(async (req, res) => {
    res.json({ demo: opts.isStaging, series: await listSeries(pool, uid(req)) });
  }));

  router.get('/:slug', wrap(async (req, res) => {
    const series = await getSeries(pool, req.params.slug, uid(req));
    if (!series) return res.status(404).json({ error: 'not_found' });
    res.json({ demo: opts.isStaging, series });
  }));

  // Writes need an account; the auth middleware already answers guests 401.
  router.put('/:slug/follow', wrap(async (req, res) => {
    const following = await setFollow(pool, req.params.slug, uid(req), true);
    if (following === null) return res.status(404).json({ error: 'not_found' });
    res.json({ following });
  }));
  router.delete('/:slug/follow', wrap(async (req, res) => {
    const following = await setFollow(pool, req.params.slug, uid(req), false);
    if (following === null) return res.status(404).json({ error: 'not_found' });
    res.json({ following });
  }));

  return router;
}

module.exports = { seriesRouter };
