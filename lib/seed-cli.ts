// `npm run seed`: apply the schema and the demo catalogue to DATABASE_URL.
// Refuses to run against production. Staging runs the same seed on boot.

import { createPool } from './db';
import { migrate } from './schema';
import { seedDemoCatalogue } from './seed';

async function main(): Promise<void> {
  if (process.env.USERNODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data in production.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const pool = createPool();
  try {
    await migrate(pool);
    await seedDemoCatalogue(pool);
    const { rows } = await pool.query(
      'SELECT (SELECT COUNT(*) FROM series WHERE is_demo)::int AS series, (SELECT COUNT(*) FROM episodes e JOIN series s ON s.id = e.series_id WHERE s.is_demo)::int AS episodes');
    console.log(`Demo catalogue ready: ${rows[0].series} series, ${rows[0].episodes} episodes.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
