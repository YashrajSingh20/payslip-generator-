import { readFileSync } from 'node:fs';
import pg from 'pg';

// DATE columns stay 'YYYY-MM-DD' strings: no timezone shifts.
pg.types.setTypeParser(1082, (v) => v);
// bigint (paise totals) as Number. Safe up to ~9e13 rupees.
pg.types.setTypeParser(20, (v) => Number(v));

/**
 * Creates the database handle used throughout the app:
 *   database.query(text, params)
 *   database.transaction(async (tx) => tx.query(...))
 *   database.ready()   -> pings the DB (used by /readyz)
 *   database.close()
 */
export function createDatabase(config, logger) {
  const url = new URL(config.database.url);
  url.searchParams.delete('sslmode');

  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: config.database.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: config.database.ssl
      ? {
          rejectUnauthorized: true,
          ...(config.database.sslCaFile ? { ca: readFileSync(config.database.sslCaFile, 'utf8') } : {}),
        }
      : false,
  });
  pool.on('error', (error) => logger.error('db_pool_error', { error }));

  return {
    query: (text, params) => pool.query(text, params),

    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async ready() {
      await pool.query('SELECT 1');
      return true;
    },

    close: () => pool.end(),
  };
}
