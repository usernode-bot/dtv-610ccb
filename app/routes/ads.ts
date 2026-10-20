// Rewarded ads: start a session, then complete it to unlock the episode. The
// unlock is granted only by the server (lib/ads.ts); the page just plays the ad.

import express from 'express';
import type { Pool } from 'pg';
import { requireUser, userId, wrap } from '../../lib/auth';
import {
  AD_DAILY_LIMIT, adProvider, adsRemaining, completeAdSession, getAdSession, startAdSession,
} from '../../lib/ads';
import { getEpisode } from '../../lib/catalogue';
import { ensureProfile, utcDay } from '../../lib/me';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function adsRouter(pool: Pool): express.Router {
  const router = express.Router();
  router.use(requireUser);

  router.get('/quota', wrap(async (req, res) => {
    res.json({ remainingToday: await adsRemaining(pool, userId(req)!, utcDay(req.now)), dailyLimit: AD_DAILY_LIMIT });
  }));

  router.post('/sessions', wrap(async (req, res) => {
    const id = Number(req.body?.episodeId);
    if (!Number.isInteger(id)) return void res.status(404).json({ error: 'not_found' });
    const me = userId(req)!;
    await ensureProfile(pool, me, String(req.user!.username));
    const episode = await getEpisode(pool, id, me);
    if (!episode) return void res.status(404).json({ error: 'not_found' });
    if (episode.state !== 'locked') return void res.status(409).json({ error: 'already_unlocked' });
    const day = utcDay(req.now);
    const remaining = await adsRemaining(pool, me, day);
    if (remaining <= 0) return void res.status(429).json({ error: 'daily_limit', remainingToday: 0 });
    const provider = adProvider();
    const sessionId = await startAdSession(pool, me, id, provider.name, day);
    res.json({ sessionId, provider: provider.name, minSeconds: provider.minSeconds, remainingToday: remaining });
  }));

  router.post('/sessions/:id/complete', wrap(async (req, res) => {
    const id = String(req.params.id);
    const me = userId(req)!;
    const session = UUID.test(id) ? await getAdSession(pool, me, id) : null;
    if (!session) return void res.status(404).json({ error: 'not_found' });
    const provider = adProvider();
    if (session.provider !== provider.name || !(await provider.verify(session, req.body))) {
      return void res.status(403).json({ error: 'not_verified' });
    }
    const r = await completeAdSession(pool, me, id, provider.minSeconds);
    const status = { ok: 200, already_unlocked: 200, too_early: 425, used: 409, daily_limit: 429, not_found: 404 }[r.result];
    if (status !== 200) return void res.status(status).json({ error: r.result, remainingToday: r.remainingToday });
    res.json({ episode: await getEpisode(pool, r.episodeId!, me), remainingToday: r.remainingToday });
  }));

  return router;
}
