import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { ensureProfile } from './me';

/** Id of the signed-in person, or null for a guest. */
export function userId(req: Request): number | null {
  return req.user ? Number(req.user.id) : null;
}

// What a guest was trying to do, by write route. Sent as `action` beside
// `account_required`, so the bridge's "Make an account to continue" sheet can
// name it. Used by the token middleware (which answers guest writes before
// any router sees them) and by requireUser.
const ACCOUNT_ACTIONS: Array<[RegExp, string]> = [
  [/^\/api\/series\/[^/]+\/follow$/, 'follow a series'],
  [/^\/api\/episodes\/[^/]+\/unlock$/, 'unlock an episode'],
  [/^\/api\/me\/genres$/, 'save your favourite genres'],
];

/** The `account_required` answer for a request a guest may not make. */
export function accountRequired(req: Request): { error: 'account_required'; action?: string } {
  const path = req.originalUrl.split('?')[0];
  const hit = ACCOUNT_ACTIONS.find(([re]) => re.test(path));
  return hit ? { error: 'account_required', action: hit[1] } : { error: 'account_required' };
}

/** For personal routes: only a signed-in person gets through; a guest is told to make an account. */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json(accountRequired(req));
    return;
  }
  next();
}

/**
 * Create the signed-in person's profile row on their first authenticated
 * request (and refresh their handle once per process). Ids already seen by
 * this process skip the query.
 */
export function upsertProfileOnce(pool: Pool) {
  const seen = new Set<number>();
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = userId(req);
    if (id === null || seen.has(id)) return next();
    ensureProfile(pool, id, String(req.user!.username))
      .then(() => { seen.add(id); })
      .catch((err) => console.error('profile upsert failed: ' + (err as Error).message))
      .then(() => next());
  };
}

/** Wrap an async route so a thrown error becomes a plain 500. */
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: 'Something went wrong. Try again.' });
    });
  };
