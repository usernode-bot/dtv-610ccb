import type { AuthUser } from './index';

declare global {
  namespace Express {
    interface Request {
      /** Set when a valid user token was sent. */
      user?: AuthUser;
      /** Set for a visitor with no account (read-only). */
      guest?: boolean;
      /** "Now" for this request; see requestNow in app/server.ts. */
      now: Date;
      /** The signed-in person's role and ban state, from profiles (attachAccount). */
      role?: 'user' | 'admin';
      banned?: boolean;
    }
  }
}

export {};
