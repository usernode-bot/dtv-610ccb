import type { NextFunction, Request, Response } from 'express';

/** Id of the signed-in person, or null for a guest. */
export function userId(req: Request): number | null {
  return req.user ? Number(req.user.id) : null;
}

/** For personal routes: only a signed-in person gets through; a guest is told to make an account. */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'account_required' });
    return;
  }
  next();
}

/** Wrap an async route so a thrown error becomes a plain 500. */
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: 'Something went wrong. Try again.' });
    });
  };
