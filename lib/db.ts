import { Pool } from 'pg';

/** The app's one connection pool. */
export function createPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}
