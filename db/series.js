// Read and write queries for the series catalogue. All functions take the pool
// first and return plain objects (camelCase) ready to send as JSON.

/**
 * @typedef {Object} SeriesSummary
 * @property {number} id
 * @property {string} slug
 * @property {string} title
 * @property {string} genre
 * @property {string|null} coverUrl
 * @property {number} coverTone
 * @property {number} episodeCount
 * @property {number} freeEpisodeCount
 * @property {boolean} following        always false for a guest
 *
 * @typedef {Object} EpisodeItem
 * @property {number} id
 * @property {number} number
 * @property {string} title
 * @property {number} durationSeconds
 * @property {number} coinPrice
 * @property {'free'|'unlocked'|'locked'} state
 *
 * @typedef {SeriesSummary & {synopsis: string, episodes: EpisodeItem[]}} SeriesDetail
 */

const SUMMARY_SQL = `
  SELECT s.id, s.slug, s.title, s.genre, s.synopsis, s.cover_url, s.cover_tone,
         COUNT(e.id)::int AS episode_count,
         COUNT(e.id) FILTER (WHERE e.coin_price = 0)::int AS free_episode_count,
         EXISTS (SELECT 1 FROM series_follows f
                  WHERE f.series_id = s.id AND f.user_id = $1) AS following
    FROM series s
    LEFT JOIN episodes e ON e.series_id = s.id
   GROUP BY s.id`;

function toSummary(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    genre: r.genre,
    coverUrl: r.cover_url,
    coverTone: r.cover_tone,
    episodeCount: r.episode_count,
    freeEpisodeCount: r.free_episode_count,
    following: r.following,
  };
}

/**
 * All series, oldest first.
 * @param {import('pg').Pool} pool
 * @param {number|null} userId  null for a guest
 * @returns {Promise<SeriesSummary[]>}
 */
async function listSeries(pool, userId) {
  const { rows } = await pool.query(`${SUMMARY_SQL} ORDER BY s.id`, [userId]);
  return rows.map(toSummary);
}

/**
 * One series with its episodes, or null when the slug is unknown.
 * An episode is 'free' (price 0), 'unlocked' (this user unlocked it) or 'locked'.
 * @param {import('pg').Pool} pool
 * @param {string} slug
 * @param {number|null} userId
 * @returns {Promise<SeriesDetail|null>}
 */
async function getSeries(pool, slug, userId) {
  const found = await pool.query(
    `SELECT * FROM (${SUMMARY_SQL}) q WHERE slug = $2`, [userId, slug]);
  if (!found.rows.length) return null;
  const r = found.rows[0];
  const eps = await pool.query(
    `SELECT e.id, e.number, e.title, e.duration_seconds, e.coin_price,
            EXISTS (SELECT 1 FROM episode_unlocks u
                     WHERE u.episode_id = e.id AND u.user_id = $2) AS unlocked
       FROM episodes e WHERE e.series_id = $1 ORDER BY e.number`,
    [r.id, userId]);
  return {
    ...toSummary(r),
    synopsis: r.synopsis,
    episodes: eps.rows.map((e) => ({
      id: e.id,
      number: e.number,
      title: e.title,
      durationSeconds: e.duration_seconds,
      coinPrice: e.coin_price,
      state: e.coin_price === 0 ? 'free' : e.unlocked ? 'unlocked' : 'locked',
    })),
  };
}

/**
 * Follow or unfollow. Idempotent both ways.
 * @param {import('pg').Pool} pool
 * @param {string} slug
 * @param {number} userId
 * @param {boolean} follow
 * @returns {Promise<boolean|null>} the new follow state, or null if no such series
 */
async function setFollow(pool, slug, userId, follow) {
  const s = await pool.query('SELECT id FROM series WHERE slug = $1', [slug]);
  if (!s.rows.length) return null;
  const id = s.rows[0].id;
  if (follow) {
    await pool.query(
      `INSERT INTO series_follows (user_id, series_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`, [userId, id]);
  } else {
    await pool.query(
      'DELETE FROM series_follows WHERE user_id = $1 AND series_id = $2', [userId, id]);
  }
  return follow;
}

module.exports = { listSeries, getSeries, setFollow };
