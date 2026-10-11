// Admin queries: who is an admin, the dashboard numbers, and user management.
// Every function here assumes the caller already checked the admin role
// (requireAdmin in lib/auth.ts); none of them check it again.

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
