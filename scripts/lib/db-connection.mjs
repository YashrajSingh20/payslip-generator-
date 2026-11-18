import { readFileSync } from 'node:fs';
import pg from 'pg';

/**
 * Builds a pg client config for ops scripts. Prefers DATABASE_ADMIN_URL (the
 * migration role) and falls back to DATABASE_URL.
 */
export function scriptClientConfig(env = process.env) {
  const raw = env.DATABASE_ADMIN_URL || env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL (or DATABASE_ADMIN_URL) is required');

  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  const sslDisabled = env.DATABASE_SSL === 'false';
  if (sslDisabled && env.NODE_ENV === 'production') {
    throw new Error('DATABASE_SSL=false is not allowed in production');
  }

  return {
    connectionString: url.toString(),
    ssl: sslDisabled
      ? false
      : {
          rejectUnauthorized: true,
          ...(env.DATABASE_SSL_CA_FILE ? { ca: readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8') } : {}),
        },
  };
}

export async function withClient(fn, env = process.env) {
  const client = new pg.Client(scriptClientConfig(env));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const item of argv) {
    const match = item.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) args[match[1]] = match[2] ?? true;
  }
  return args;
}
