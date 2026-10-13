// Personal routes under /api/me. All of them need the platform token, and each
// only touches rows whose user_id is the signed-in person's.

import express from 'express';
import type { Pool } from 'pg';
import { requireUser, userId, wrap } from '../../lib/auth';
import { trackEvent } from '../../lib/analytics';
import {
  ensureProfile, listCoinTransactions, listFollowed, listUnlocked, listWatchHistory,
  minFavoriteGenres, recordPlay, saveFavoriteGenres, saveProgress,
} from '../../lib/me';

export function meRouter(pool: Pool): express.Router {
  const router = express.Router();
  router.use(requireUser);

  // Who is signed in, and whether the genre onboarding is still due (it is
  // skipped while there are no genres to pick from).
  router.get('/', wrap(async (req, res) => {
    const profile = await ensureProfile(pool, userId(req)!, String(req.user!.username));
    const minGenres = await minFavoriteGenres(pool);
    res.json({
      profile,
      onboarding: { required: !profile.onboardedAt && minGenres > 0, minGenres },
    });
  }));

  // Onboarding: the genres the person picked (genre slugs, at least minGenres).
  router.post('/genres', wrap(async (req, res) => {
    const result = await saveFavoriteGenres(
      pool, userId(req)!, String(req.user!.username), req.body?.genres);
    if (typeof result === 'string') return void res.status(400).json({ error: result });
    res.json({ profile: result });
  }));

  router.get('/follows', wrap(async (req, res) => {
    res.json({ series: await listFollowed(pool, userId(req)!) });
  }));

  router.get('/watch-history', wrap(async (req, res) => {
    res.json({ history: await listWatchHistory(pool, userId(req)!) });
  }));

  router.put('/watch-history/:episodeId', wrap(async (req, res) => {
    const episodeId = Number(req.params.episodeId);
    const position = Number(req.body?.positionSeconds);
    if (!Number.isInteger(episodeId) || !Number.isInteger(position) || position < 0) {
      return void res.status(400).json({ error: 'invalid_progress' });
    }
    await ensureProfile(pool, userId(req)!, String(req.user!.username));
    const saved = await saveProgress(pool, userId(req)!, episodeId, position, req.body?.completed === true);
    if (!saved) return void res.status(404).json({ error: 'not_found' });
    if (saved.newlyCompleted) {
      await trackEvent(pool, { userId: userId(req)!, name: 'complete', episodeId, positionSeconds: position });
    }
    res.json({ saved: true });
  }));

  // The watch screen opened this episode: put it in the person's history.
  router.post('/watch-history/:episodeId/play', wrap(async (req, res) => {
    const episodeId = Number(req.params.episodeId);
    if (!Number.isInteger(episodeId)) return void res.status(400).json({ error: 'invalid_episode' });
    await ensureProfile(pool, userId(req)!, String(req.user!.username));
    const result = await recordPlay(pool, userId(req)!, episodeId);
    if (result === 'not_found') return void res.status(404).json({ error: 'not_found' });
    if (result === 'locked') return void res.status(403).json({ error: 'locked' });
    await trackEvent(pool, { userId: userId(req)!, name: 'play', episodeId });
    res.json({ saved: true });
  }));

  router.get('/unlocked', wrap(async (req, res) => {
    res.json({ episodes: await listUnlocked(pool, userId(req)!) });
  }));

  router.get('/coin-transactions', wrap(async (req, res) => {
    res.json({ transactions: await listCoinTransactions(pool, userId(req)!) });
  }));

  return router;
}
