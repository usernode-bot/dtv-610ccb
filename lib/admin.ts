// Admin queries: who is an admin, the dashboard numbers, user management, and
// the series manager (add, edit, publish and delete series, and add episodes in
// bulk). Every query here assumes the caller already checked the admin role
// (requireAdmin in lib/auth.ts); none of them check it again.
//
// The series manager's validation lives here so the routes and the tests share
// it. Each failure is reported per field ({ title: 'Enter a title.' }); the page
// shows the message next to that field. public/js/app.js repeats the same rules
// so most mistakes are caught before a request is sent.

import type { Request } from 'express';
import type { Pool } from 'pg';
import type { AdminStats, AdminUser, CoinTransaction, Role } from '../types';

/**
 * Usernames listed in the ADMIN_USERNAMES setting (comma or space separated,
 * matched case-insensitively, a leading @ ignored).
 */
export function configuredAdmins(raw = process.env.ADMIN_USERNAMES || ''): Set<string> {
  return new Set(raw.split(/[\s,]+/).map((u) => u.replace(/^@/, '').toLowerCase()).filter(Boolean));
}

/** Give a person listed in ADMIN_USERNAMES the admin role. The profile must exist. */
export async function applyConfiguredAdmin(
  pool: Pool, userId: number, username: string, admins = configuredAdmins(),
): Promise<void> {
  if (!admins.has(username.toLowerCase())) return;
  await pool.query(`UPDATE profiles SET role = 'admin' WHERE id = $1 AND role <> 'admin'`, [userId]);
}

/** Whether the request comes from a signed-in, unbanned admin (see attachAccount in lib/auth.ts). */
export function isAdmin(req: Request): boolean {
  return !!req.user && req.role === 'admin' && !req.banned;
}

/** Role and ban state of a person, or null when they have no profile yet. */
export async function getAccount(
  pool: Pool, userId: number,
): Promise<{ role: Role; banned: boolean } | null> {
  const { rows } = await pool.query('SELECT role, banned FROM profiles WHERE id = $1', [userId]);
  return rows.length ? { role: rows[0].role, banned: rows[0].banned } : null;
}

/** The dashboard numbers. "Today" is the UTC day that `now` falls on. */
export async function dashboardStats(pool: Pool, now: Date): Promise<AdminStats> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const { rows: [t] } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM profiles) AS total_users,
       (SELECT COUNT(*)::int FROM (
          SELECT user_id FROM watch_history WHERE updated_at >= $1 AND updated_at < $2
          UNION SELECT user_id FROM coin_transactions WHERE created_at >= $1 AND created_at < $2
          UNION SELECT user_id FROM follows WHERE created_at >= $1 AND created_at < $2
          UNION SELECT id FROM profiles WHERE created_at >= $1 AND created_at < $2
        ) active) AS dau,
       (SELECT COALESCE(SUM(amount), 0)::int FROM coin_transactions WHERE type = 'purchase') AS revenue,
       (SELECT COALESCE(SUM(amount), 0)::int FROM coin_transactions
         WHERE type = 'purchase' AND created_at >= $1 AND created_at < $2) AS revenue_today,
       (SELECT COALESCE(-SUM(amount), 0)::int FROM coin_transactions WHERE type = 'unlock') AS spent`,
    [dayStart, dayEnd]);
  const { rows: top } = await pool.query(
    `SELECT s.slug, s.title, s.view_count,
            COALESCE(-SUM(c.amount), 0)::int AS coins_spent
       FROM series s
       LEFT JOIN episodes e ON e.series_id = s.id
       LEFT JOIN coin_transactions c ON c.episode_id = e.id AND c.type = 'unlock'
      GROUP BY s.id
      ORDER BY s.view_count DESC, coins_spent DESC, s.title
      LIMIT 5`);
  return {
    totalUsers: t.total_users,
    dailyActiveUsers: t.dau,
    revenueCoins: t.revenue,
    revenueCoinsToday: t.revenue_today,
    coinsSpent: t.spent,
    topSeries: top.map((r) => ({
      slug: r.slug, title: r.title, viewCount: r.view_count, coinsSpent: r.coins_spent,
    })),
  };
}

function toAdminUser(r: any, admins: Set<string>): AdminUser {
  return {
    id: Number(r.id),
    username: r.username,
    coinBalance: r.coin_balance,
    role: r.role,
    banned: r.banned,
    configuredAdmin: admins.has(String(r.username).toLowerCase()),
    createdAt: r.created_at.toISOString(),
  };
}

const USER_COLUMNS = 'id, username, coin_balance, role, banned, created_at';

/** People whose username contains `query` (all when empty), admins first, then newest. */
export async function listUsers(
  pool: Pool, query: string, admins = configuredAdmins(),
): Promise<AdminUser[]> {
  const like = '%' + query.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM profiles
      WHERE username ILIKE $1
      ORDER BY (role = 'admin') DESC, created_at DESC, id DESC
      LIMIT 100`, [like]);
  return rows.map((r) => toAdminUser(r, admins));
}

/** One person and their latest coin ledger rows, or null. */
export async function getUser(
  pool: Pool, userId: number, admins = configuredAdmins(),
): Promise<{ user: AdminUser; transactions: CoinTransaction[] } | null> {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM profiles WHERE id = $1`, [userId]);
  if (!rows.length) return null;
  const tx = await pool.query(
    `SELECT id, amount, type, episode_id, note, created_at FROM coin_transactions
      WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20`, [userId]);
  return {
    user: toAdminUser(rows[0], admins),
    transactions: tx.rows.map((r) => ({
      id: Number(r.id), amount: r.amount, type: r.type, episodeId: r.episode_id,
      note: r.note, createdAt: r.created_at.toISOString(),
    })),
  };
}

export type AdminError =
  | 'not_found' | 'invalid_amount' | 'reason_required' | 'not_enough_coins'
  | 'cannot_change_self' | 'configured_admin' | 'cannot_ban_admin';

/**
 * Add (amount > 0) or take away (amount < 0) coins, with a reason. Writes one
 * 'admin' ledger row naming the admin, in the same transaction as the balance.
 */
export async function adjustCoins(
  pool: Pool, adminId: number, userId: number, amount: unknown, reason: unknown,
): Promise<{ coinBalance: number } | AdminError> {
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount === 0
      || Math.abs(amount) > 1_000_000) return 'invalid_amount';
  const note = typeof reason === 'string' ? reason.trim() : '';
  if (!note || note.length > 200) return 'reason_required';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const me = await client.query('SELECT coin_balance FROM profiles WHERE id = $1 FOR UPDATE', [userId]);
    if (!me.rows.length) { await client.query('ROLLBACK'); return 'not_found'; }
    if (me.rows[0].coin_balance + amount < 0) { await client.query('ROLLBACK'); return 'not_enough_coins'; }
    await client.query(
      `INSERT INTO coin_transactions (user_id, amount, type, note, actor_id)
       VALUES ($1, $2, 'admin', $3, $4)`, [userId, amount, note, adminId]);
    const upd = await client.query(
      'UPDATE profiles SET coin_balance = coin_balance + $2 WHERE id = $1 RETURNING coin_balance',
      [userId, amount]);
    await client.query('COMMIT');
    return { coinBalance: upd.rows[0].coin_balance };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Ban or unban. An admin cannot ban themselves or another admin (demote first). */
export async function setBanned(
  pool: Pool, adminId: number, userId: number, banned: boolean, admins = configuredAdmins(),
): Promise<AdminUser | AdminError> {
  if (adminId === userId) return 'cannot_change_self';
  const found = await getUser(pool, userId, admins);
  if (!found) return 'not_found';
  if (banned && found.user.role === 'admin') return 'cannot_ban_admin';
  const { rows } = await pool.query(
    `UPDATE profiles SET banned = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`, [userId, banned]);
  return toAdminUser(rows[0], admins);
}

/**
 * Promote or demote. Not for yourself, and not for someone listed in
 * ADMIN_USERNAMES (they would be admin again on their next sign-in).
 */
export async function setRole(
  pool: Pool, adminId: number, userId: number, role: unknown, admins = configuredAdmins(),
): Promise<AdminUser | AdminError | 'invalid_role'> {
  if (role !== 'user' && role !== 'admin') return 'invalid_role';
  if (adminId === userId) return 'cannot_change_self';
  const found = await getUser(pool, userId, admins);
  if (!found) return 'not_found';
  if (role === 'user' && found.user.configuredAdmin) return 'configured_admin';
  // A banned person who is promoted is unbanned: an admin is never banned.
  const { rows } = await pool.query(
    `UPDATE profiles SET role = $2, banned = banned AND $2 <> 'admin'
      WHERE id = $1 RETURNING ${USER_COLUMNS}`, [userId, role]);
  return toAdminUser(rows[0], admins);
}

export type FieldErrors = Record<string, string>;

export const COUNTRIES = ['china', 'korea'] as const;
export const FORMATS = ['long', 'short'] as const;
/** Subtitle languages an episode can carry, as BCP-47 tags (as the drama seed stores them). */
export const SUBTITLE_LANGS = ['en', 'id', 'zh-Hans', 'ko'] as const;
/** Coins for a locked episode, by format (the drama seed's prices). */
export const LOCKED_PRICE: Record<(typeof FORMATS)[number], number> = { long: 15, short: 3 };

export const LIMITS = {
  title: 120, description: 2000, genres: 5, totalEpisodes: 500, url: 2048,
  yearMin: 1900, yearMax: 2100, episodesPerRequest: 200, durationMax: 6 * 3600,
};

export interface SeriesInput {
  title: string;
  originalTitle: string | null;
  country: (typeof COUNTRIES)[number];
  format: (typeof FORMATS)[number];
  /** Genre slugs; the first is the primary genre. */
  genres: string[];
  year: number;
  description: string;
  posterUrl: string | null;
  bannerUrl: string | null;
  totalEpisodes: number;
}

export interface EpisodeInput {
  videoUrl: string;
  durationSeconds: number;
  subtitleLang: (typeof SUBTITLE_LANGS)[number];
  free: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function isHttpsUrl(v: string): boolean {
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
}

/** A whole number from a JSON number or a numeric string, else NaN. */
function whole(v: unknown): number {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v);
  return NaN;
}

/** "45:00", "1:02:30" or plain minutes ("45") as seconds; NaN when it is none of those. */
export function parseDuration(v: unknown): number {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  const s = str(v);
  let m: RegExpExecArray | null;
  if ((m = /^(\d+):([0-5]\d)$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(s))) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  if (/^\d+$/.test(s)) return Number(s) * 60;
  return NaN;
}

/**
 * Check a series form. `knownGenres` are the genre slugs that exist;
 * `minTotal` is how many episodes the series already has (0 for a new one).
 */
export function validateSeries(
  body: any, knownGenres: string[], minTotal = 0,
): { value: SeriesInput } | { fields: FieldErrors } {
  const b = body && typeof body === 'object' ? body : {};
  const fields: FieldErrors = {};

  const title = str(b.title);
  if (!title) fields.title = 'Enter a title.';
  else if (title.length > LIMITS.title) fields.title = `Keep the title to ${LIMITS.title} characters or fewer.`;

  const originalTitle = str(b.originalTitle);
  if (originalTitle.length > LIMITS.title) {
    fields.originalTitle = `Keep the original title to ${LIMITS.title} characters or fewer.`;
  }

  if (!COUNTRIES.includes(b.country)) fields.country = 'Choose a country.';
  if (!FORMATS.includes(b.format)) fields.format = 'Choose a format.';

  const genres: string[] = Array.isArray(b.genres) ? b.genres.filter((g: unknown) => typeof g === 'string') : [];
  const unique = [...new Set(genres)];
  if (!unique.length) fields.genres = 'Pick at least one genre.';
  else if (unique.length > LIMITS.genres) fields.genres = `Pick up to ${LIMITS.genres} genres.`;
  else if (!unique.every((g) => knownGenres.includes(g))) fields.genres = 'Pick genres from the list.';

  const year = whole(b.year);
  if (b.year === undefined || b.year === null || str(String(b.year)) === '') fields.year = 'Enter the release year.';
  else if (!(year >= LIMITS.yearMin && year <= LIMITS.yearMax)) {
    fields.year = `Enter a year from ${LIMITS.yearMin} to ${LIMITS.yearMax}.`;
  }

  const description = str(b.description);
  if (!description) fields.description = 'Enter a description.';
  else if (description.length > LIMITS.description) {
    fields.description = `Keep the description to ${LIMITS.description} characters or fewer.`;
  }

  const posterUrl = str(b.posterUrl);
  if (posterUrl && (!isHttpsUrl(posterUrl) || posterUrl.length > LIMITS.url)) {
    fields.posterUrl = 'The poster did not upload properly. Upload it again.';
  }
  const bannerUrl = str(b.bannerUrl);
  if (bannerUrl && (!isHttpsUrl(bannerUrl) || bannerUrl.length > LIMITS.url)) {
    fields.bannerUrl = 'The banner did not upload properly. Upload it again.';
  }

  const totalEpisodes = whole(b.totalEpisodes);
  if (b.totalEpisodes === undefined || b.totalEpisodes === null || str(String(b.totalEpisodes)) === '') {
    fields.totalEpisodes = 'Enter the total number of episodes.';
  } else if (!(totalEpisodes >= 1 && totalEpisodes <= LIMITS.totalEpisodes)) {
    fields.totalEpisodes = `Enter a whole number from 1 to ${LIMITS.totalEpisodes}.`;
  } else if (totalEpisodes < minTotal) {
    fields.totalEpisodes = `This series already has ${minTotal} episodes. Enter ${minTotal} or more.`;
  }

  if (Object.keys(fields).length) return { fields };
  return {
    value: {
      title, originalTitle: originalTitle || null, country: b.country, format: b.format,
      genres: unique, year, description, posterUrl: posterUrl || null, bannerUrl: bannerUrl || null,
      totalEpisodes,
    },
  };
}

/** Check the rows of the bulk episode form. Field keys are "episodes.<row>.<field>". */
export function validateEpisodes(body: any): { value: EpisodeInput[] } | { fields: FieldErrors } {
  const rows = body && Array.isArray(body.episodes) ? body.episodes : null;
  if (!rows || !rows.length) return { fields: { episodes: 'Add at least one episode.' } };
  if (rows.length > LIMITS.episodesPerRequest) {
    return { fields: { episodes: `Add up to ${LIMITS.episodesPerRequest} episodes at a time.` } };
  }
  const fields: FieldErrors = {};
  const value: EpisodeInput[] = rows.map((r: any, i: number) => {
    const row = r && typeof r === 'object' ? r : {};
    const key = (f: string) => `episodes.${i}.${f}`;
    const videoUrl = str(row.videoUrl);
    if (!videoUrl) fields[key('videoUrl')] = 'Enter the video URL.';
    else if (!isHttpsUrl(videoUrl) || videoUrl.length > LIMITS.url) {
      fields[key('videoUrl')] = 'Enter a full link starting with https://.';
    }
    const durationSeconds = parseDuration(row.duration);
    if (str(String(row.duration ?? '')) === '') fields[key('duration')] = 'Enter the duration.';
    else if (!(durationSeconds > 0 && durationSeconds <= LIMITS.durationMax)) {
      fields[key('duration')] = 'Enter minutes:seconds, e.g. 45:00.';
    }
    if (!SUBTITLE_LANGS.includes(row.subtitleLang)) fields[key('subtitleLang')] = 'Choose a subtitle language.';
    return { videoUrl, durationSeconds, subtitleLang: row.subtitleLang, free: row.free === true };
  });
  return Object.keys(fields).length ? { fields } : { value };
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export interface AdminSeriesRow {
  id: number;
  slug: string;
  title: string;
  isDemo: boolean;
  isPublished: boolean;
  episodeCount: number;
  totalEpisodes: number | null;
}

export async function listAdminSeries(pool: Pool): Promise<AdminSeriesRow[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.slug, s.title, s.is_demo, s.is_published, s.total_episodes,
            COUNT(e.id)::int AS episode_count
       FROM series s LEFT JOIN episodes e ON e.series_id = s.id
      GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC`);
  return rows.map((r) => ({
    id: r.id, slug: r.slug, title: r.title, isDemo: r.is_demo, isPublished: r.is_published,
    episodeCount: r.episode_count, totalEpisodes: r.total_episodes,
  }));
}

export async function getAdminSeries(pool: Pool, id: number) {
  const { rows } = await pool.query('SELECT * FROM series WHERE id = $1', [id]);
  if (!rows.length) return null;
  const s = rows[0];
  const genreSlugs = await pool.query(
    `SELECT g.slug FROM unnest($1::text[]) WITH ORDINALITY AS x(name, i)
       JOIN genres g ON g.name = x.name ORDER BY x.i`, [s.genres]);
  const eps = await pool.query(
    `SELECT id, number, title, duration_seconds, coin_price, video_url, subtitle_langs
       FROM episodes WHERE series_id = $1 ORDER BY number`, [id]);
  return {
    id: s.id, slug: s.slug, title: s.title, originalTitle: s.original_title, country: s.country,
    format: s.format, genres: genreSlugs.rows.map((g) => g.slug), year: s.release_year,
    description: s.synopsis, posterUrl: s.poster_url, bannerUrl: s.banner_url,
    totalEpisodes: s.total_episodes, isPublished: s.is_published, isDemo: s.is_demo,
    episodes: eps.rows.map((e) => ({
      id: e.id, number: e.number, title: e.title, durationSeconds: e.duration_seconds,
      free: e.coin_price === 0, coinPrice: e.coin_price, videoUrl: e.video_url,
      subtitleLangs: e.subtitle_langs,
    })),
  };
}

export async function genreSlugs(pool: Pool): Promise<string[]> {
  return (await pool.query('SELECT slug FROM genres')).rows.map((r) => r.slug);
}

async function genreColumns(pool: Pool, slugs: string[]) {
  const { rows } = await pool.query(
    `SELECT g.id, g.name FROM unnest($1::text[]) WITH ORDINALITY AS x(slug, i)
       JOIN genres g ON g.slug = x.slug ORDER BY x.i`, [slugs]);
  return { names: rows.map((r) => r.name as string), primaryId: rows[0].id as number, primary: rows[0].name as string };
}

/** Add a series, unpublished. Returns its id. */
export async function createSeries(pool: Pool, v: SeriesInput): Promise<number> {
  const g = await genreColumns(pool, v.genres);
  const base = slugify(v.title) || 'series';
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const { rows } = await pool.query(
      `INSERT INTO series (slug, title, original_title, synopsis, genre, genre_id, genres, country, format,
                           release_year, poster_url, banner_url, total_episodes, cover_tone, is_published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               (SELECT COUNT(*) % 5 FROM series), FALSE)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [slug, v.title, v.originalTitle, v.description, g.primary, g.primaryId, g.names, v.country, v.format,
       v.year, v.posterUrl, v.bannerUrl, v.totalEpisodes]);
    if (rows.length) return rows[0].id;
  }
}

/** Save the form over a series; its slug (and so its links) stays. False when there is no such series. */
export async function updateSeries(pool: Pool, id: number, v: SeriesInput): Promise<boolean> {
  const g = await genreColumns(pool, v.genres);
  const { rowCount } = await pool.query(
    `UPDATE series SET title = $2, original_title = $3, synopsis = $4, genre = $5, genre_id = $6, genres = $7,
            country = $8, format = $9, release_year = $10, poster_url = $11, banner_url = $12,
            total_episodes = $13
      WHERE id = $1`,
    [id, v.title, v.originalTitle, v.description, g.primary, g.primaryId, g.names, v.country, v.format,
     v.year, v.posterUrl, v.bannerUrl, v.totalEpisodes]);
  return (rowCount ?? 0) > 0;
}

export async function episodeCount(pool: Pool, seriesId: number): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM episodes WHERE series_id = $1', [seriesId]);
  return rows[0].n;
}

/**
 * Publish or unpublish. Publishing needs at least one episode. Returns the new
 * state, 'not_found', or 'no_episodes'.
 */
export async function setPublished(
  pool: Pool, id: number, published: boolean,
): Promise<boolean | 'not_found' | 'no_episodes'> {
  const s = await pool.query('SELECT 1 FROM series WHERE id = $1', [id]);
  if (!s.rows.length) return 'not_found';
  if (published && await episodeCount(pool, id) === 0) return 'no_episodes';
  await pool.query('UPDATE series SET is_published = $2 WHERE id = $1', [id, published]);
  return published;
}

/** Delete a series with its episodes (and everyone's follows, history and unlocks of them). */
export async function deleteSeries(pool: Pool, id: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM series WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Append episodes after the series' last one, numbered on, titled "Episode N".
 * Refuses to go past total_episodes. Returns how many were added, 'not_found',
 * or { fields } when there is no room for them.
 */
export async function addEpisodes(
  pool: Pool, seriesId: number, eps: EpisodeInput[],
): Promise<number | 'not_found' | { fields: FieldErrors }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query('SELECT format, total_episodes FROM series WHERE id = $1 FOR UPDATE', [seriesId]);
    if (!s.rows.length) { await client.query('ROLLBACK'); return 'not_found'; }
    const { format, total_episodes: total } = s.rows[0];
    const cur = await client.query(
      'SELECT COUNT(*)::int AS n, COALESCE(MAX(number), 0)::int AS last FROM episodes WHERE series_id = $1',
      [seriesId]);
    const { n, last } = cur.rows[0];
    if (total && n + eps.length > total) {
      await client.query('ROLLBACK');
      const room = Math.max(0, total - n);
      return { fields: { episodes: room
        ? `This series has ${total} episodes planned and ${n} added, so there is room for ${room} more. Remove rows or raise the total episodes.`
        : `This series already has all ${total} planned episodes. Raise the total episodes to add more.` } };
    }
    const price = LOCKED_PRICE[format as 'long' | 'short'] ?? LOCKED_PRICE.long;
    await client.query(
      `INSERT INTO episodes (series_id, number, title, duration_seconds, coin_price, video_url, subtitle_langs)
       SELECT $1, $2 + i, 'Episode ' || ($2 + i), dur, price, url, ARRAY[lang]
         FROM unnest($3::int[], $4::int[], $5::text[], $6::text[]) WITH ORDINALITY AS x(dur, price, url, lang, i)`,
      [seriesId, last, eps.map((e) => e.durationSeconds), eps.map((e) => (e.free ? 0 : price)),
       eps.map((e) => e.videoUrl), eps.map((e) => e.subtitleLang)]);
    await client.query('COMMIT');
    return eps.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteEpisode(pool: Pool, id: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM episodes WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
