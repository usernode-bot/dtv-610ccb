// Error monitoring: sends server errors, and errors the page reports through
// POST /api/client-errors, to Sentry. Off unless SENTRY_DSN is set (a private
// secret in dapp.json, so a staging preview never reports into production's
// project). Speaks Sentry's envelope protocol directly with fetch, so there is
// no SDK to load: an event is the error's type, message and stack, the route,
// the environment and the person's Homeroom id (never their handle or data).

import crypto from 'crypto';

export interface ParsedDsn {
  endpoint: string;
  publicKey: string;
  dsn: string;
}

/** https://<key>@<host>[/<path>]/<project>  ->  the envelope endpoint and key. */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const parts = u.pathname.split('/').filter(Boolean);
    const project = parts.pop();
    if (!u.username || !project || !/^\d+$/.test(project)) return null;
    const prefix = parts.length ? '/' + parts.join('/') : '';
    return {
      endpoint: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`,
      publicKey: u.username,
      dsn,
    };
  } catch {
    return null;
  }
}

export interface ErrorContext {
  platform?: 'node' | 'javascript';
  userId?: number | null;
  method?: string;
  url?: string;
  tags?: Record<string, string>;
}

interface Frame { function?: string; filename?: string; lineno?: number; colno?: number }

/** V8 stack lines ("at fn (file:1:2)") as Sentry frames, oldest call first. */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split('\n').slice(1, 51)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line) || /^(.*)@(.+?):(\d+):(\d+)$/.exec(line.trim());
    if (m) frames.push({ function: m[1] || '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

/** The Sentry event for one error. */
export function buildEvent(err: { name?: string; message?: string; stack?: string }, ctx: ErrorContext, environment: string) {
  const frames = parseStack(err.stack);
  return {
    event_id: crypto.randomBytes(16).toString('hex'),
    timestamp: Date.now() / 1000,
    platform: ctx.platform || 'node',
    level: 'error',
    environment,
    exception: {
      values: [{
        type: String(err.name || 'Error').slice(0, 200),
        value: String(err.message || '').slice(0, 2000),
        ...(frames.length ? { stacktrace: { frames } } : {}),
      }],
    },
    ...(ctx.url || ctx.method ? { request: { url: ctx.url, method: ctx.method } } : {}),
    ...(ctx.userId ? { user: { id: String(ctx.userId) } } : {}),
    tags: { app: 'dtv', ...(ctx.tags || {}) },
  };
}

const MAX_EVENTS_PER_MINUTE = 30;

export function createMonitor(dsnValue: string | undefined, environment: string) {
  const target = dsnValue ? parseDsn(dsnValue) : null;
  if (dsnValue && !target) console.warn('monitoring: SENTRY_DSN is not a valid DSN; errors are not reported');
  let windowStart = 0;
  let sent = 0;

  function captureException(err: unknown, ctx: ErrorContext = {}): void {
    if (!target) return;
    const now = Date.now();
    if (now - windowStart > 60_000) { windowStart = now; sent = 0; }
    if (++sent > MAX_EVENTS_PER_MINUTE) return;
    const e = err instanceof Error ? err : new Error(String(err));
    const event = buildEvent(e, ctx, environment);
    const body = [
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: target.dsn }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');
    fetch(target.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=dtv/1.0`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    }).catch((sendErr) => console.warn('monitoring: could not reach Sentry: ' + (sendErr as Error).message));
  }

  return { enabled: !!target, captureException };
}

/** The app's one monitor, from SENTRY_DSN. */
export const monitor = createMonitor(process.env.SENTRY_DSN, process.env.USERNODE_ENV || 'development');
