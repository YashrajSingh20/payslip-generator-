#!/usr/bin/env node
// Applies migrations/NNN_*.sql in order, each in its own transaction.
// The deploy pipeline runs this before every release (see backend/infra/), and
// it is safe to run by hand too: runs are serialised with an advisory lock and
// applied filenames are recorded in schema_migrations.
//   pnpm db:migrate              apply pending files
//   pnpm db:migrate --status     list applied and pending files
//   pnpm db:migrate --file=002_x.sql   apply one specific pending file
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, withClient } from './lib/db-connection.mjs';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

async function main() {
  const args = parseArgs();
  const files = (await readdir(migrationsDir)).filter((f) => FILE_PATTERN.test(f)).sort();

  const env = process.env;
  if ((env.APP_ENV === 'production' || env.NODE_ENV === 'production') && env.DATABASE_SSL !== 'false' && !env.DATABASE_SSL_CA_FILE) {
    throw new Error('DATABASE_SSL_CA_FILE is required in production so the RDS certificate is verified');
  }

  await withClient(async (client) => {
    // Serialise pipeline and manual runs before reading the ledger.
    await client.query("SELECT pg_advisory_lock(hashtext('keystone-payroll:schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));

    if (args.status) {
      for (const f of files) console.log(`${applied.has(f) ? 'applied ' : 'pending '} ${f}`);
      const unknown = [...applied].filter((f) => !files.includes(f));
      for (const f of unknown) console.log(`unknown  ${f} (applied in the database, missing from migrations/)`);
      console.log(`
${applied.size} applied, ${pending.length} pending`);
      return;
    }

    let targets = pending;
    if (typeof args.file === 'string') {
      if (!files.includes(args.file)) throw new Error(`Unknown migration file: ${args.file}`);
      if (applied.has(args.file)) throw new Error(`${args.file} is already applied`);
      targets = [args.file];
    }

    if (!targets.length) {
      console.log('Database is up to date.');
      return;
    }

    for (const file of targets) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      process.stdout.write(`Applying ${file} ... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('done');
      } catch (error) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw error;
      }
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
