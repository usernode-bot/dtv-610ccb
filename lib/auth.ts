import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { ensureProfile } from './me';
import { applyConfiguredAdmin, getAccount } from './admin';
import { monitor } from './monitoring';

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
  [/^\/api\/series\/[^/]+\/unlock-all$/, 'unlock these episodes'],
  [/^\/api\/ads\/sessions(\/[^/]+\/complete)?$/, 'unlock an episode'],
  [/^\/api\/me\/check-in$/, 'check in'],
  [/^\/api\/store\/checkout$/, 'buy coins'],
  [/^\/api\/me\/watch-history\/[^/]+\/play$/, 'keep a watch history'],
  [/^\/api\/admin\//, 'manage series'],
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
 * request (and refresh their handle once per process), and give them the admin
 * role when ADMIN_USERNAMES lists them. Ids already seen by this process skip
 * the query.
 */
export function upsertProfileOnce(pool: Pool) {
  const seen = new Set<number>();
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = userId(req);
    if (id === null || seen.has(id)) return next();
    const username = String(req.user!.username);
    ensureProfile(pool, id, username)
      .then(() => applyConfiguredAdmin(pool, id, username))
      .then(() => { seen.add(id); })
      .catch((err) => console.error('profile upsert failed: ' + (err as Error).message))
      .then(() => next());
  };
}

/**
 * Read the signed-in person's role and ban state on every request (so a ban
 * or a demotion takes effect at once) and refuse every API call from a banned
 * person with 403 `banned`. Pages still load, so the app can say why.
 */
export function attachAccount(pool: Pool) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = userId(req);
    if (id === null) return next();
    getAccount(pool, id).then((account) => {
      req.role = account ? account.role : 'user';
      req.banned = account ? account.banned : false;
      if (req.banned && req.path.startsWith('/api/')) {
        res.status(403).json({ error: 'banned' });
        return;
      }
      next();
    }, (err) => {
      console.error(err);
      res.status(500).json({ error: 'Something went wrong. Try again.' });
    });
  };
}

/** For /api/admin: only an admin gets through; everyone else gets 403 `admin_only`. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.role !== 'admin' || req.banned) {
    res.status(403).json({ error: 'admin_only' });
    return;
  }
  next();
}

/**
 * For /admin pages: a person who is not an admin is sent to the home screen,
 * keeping the query string (the platform's ?token= and theme).
 */
export function adminPageGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.user && req.role === 'admin' && !req.banned) return next();
  const q = req.originalUrl.indexOf('?');
  res.redirect(302, '/' + (q >= 0 ? req.originalUrl.slice(q) : ''));
}

/** Wrap an async route so a thrown error becomes a plain 500 (and is reported). */
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err) => {
      console.error(err);
      monitor.captureException(err, { userId: userId(req), method: req.method, url: req.baseUrl + (req.route ? req.route.path : '') });
      res.status(500).json({ error: 'Something went wrong. Try again.' });
    });
  };
