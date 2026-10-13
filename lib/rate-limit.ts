// Fixed-window rate limiting for the API, in memory (one container per app,
// so there is no shared store to keep in step). A signed-in person is counted
// by their Homeroom id; anyone else by the address the request came from.
// Reads and writes have separate budgets. Over budget answers 429
// { error: 'rate_limited' } with a Retry-After header.

import type { NextFunction, Request, Response } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  /** Requests per window for GET and HEAD. */
  maxReads: number;
  /** Requests per window for everything else. */
  maxWrites: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitOptions = { windowMs: 60_000, maxReads: 300, maxWrites: 60 };

/** Who a request is counted against. */
export function clientKey(req: Request): string {
  if (req.user) return 'user:' + String(req.user.id);
  // The edge appends the caller's address to X-Forwarded-For; the first
  // entry is the original client.
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return 'addr:' + (fwd || req.socket.remoteAddress || 'unknown');
}

export function rateLimit(opts: RateLimitOptions = DEFAULT_RATE_LIMITS) {
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = Date.now();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    // Forget windows that have ended, at most once per window.
    if (now - lastSweep > opts.windowMs) {
      for (const [k, w] of windows) if (now - w.start >= opts.windowMs) windows.delete(k);
      lastSweep = now;
    }
    const read = req.method === 'GET' || req.method === 'HEAD';
    const key = (read ? 'r:' : 'w:') + clientKey(req);
    const max = read ? opts.maxReads : opts.maxWrites;
    let w = windows.get(key);
    if (!w || now - w.start >= opts.windowMs) {
      w = { start: now, count: 0 };
      windows.set(key, w);
    }
    w.count += 1;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - w.count)));
    if (w.count > max) {
      res.set('Retry-After', String(Math.ceil((w.start + opts.windowMs - now) / 1000)));
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    next();
  };
}
