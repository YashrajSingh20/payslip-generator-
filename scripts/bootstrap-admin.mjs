#!/usr/bin/env node
// Creates (or re-activates) the first super admin. Nobody can sign in before this
// runs, because sign-in only works for emails that already exist in `users`.
//
//   pnpm bootstrap-admin -- --email=finance@keystonecommerce.in --name="Finance Admin"
//   pnpm bootstrap-admin -- --list          show current super admins
//
// Uses DATABASE_ADMIN_URL if set, otherwise DATABASE_URL (from .env locally).
// Safe to run twice: the same email is updated, not duplicated.
import { parseArgs, withClient } from './lib/db-connection.mjs';

const USAGE = 'Usage: pnpm bootstrap-admin -- --email=you@company.com --name="Your Name"   (or --list)';

async function listAdmins(client) {
  const { rows } = await client.query(
    `SELECT u.email, u.name, u.is_active, u.last_login_at
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.key = 'super_admin'
      ORDER BY u.email`,
  );
  if (!rows.length) {
    console.log('No super admins yet.');
    return;
  }
  for (const r of rows) {
    const state = r.is_active ? 'active' : 'deactivated';
    const seen = r.last_login_at ? `last sign-in ${r.last_login_at.toISOString().slice(0, 16).replace('T', ' ')}` : 'never signed in';
    console.log(`${r.email}  ${r.name}  (${state}, ${seen})`);
  }
}

async function main() {
  const args = parseArgs();

  await withClient(async (client) => {
    const { rows: role } = await client.query(`SELECT to_regclass('public.roles') IS NOT NULL AS ready`);
    if (!role[0].ready) throw new Error('The database has no tables yet. Run pnpm db:migrate first.');

    if (args.list) return listAdmins(client);

    const email = String(args.email || '').trim().toLowerCase();
    const name = String(args.name || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) throw new Error(USAGE);

    await client.query('BEGIN');
    try {
      const { rows: superAdmin } = await client.query(`SELECT id FROM roles WHERE key = 'super_admin'`);
      if (!superAdmin[0]) throw new Error('The super_admin role is missing. Run pnpm db:migrate first.');
      const { rows } = await client.query(
        `INSERT INTO users (email, name) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, is_active = true, updated_at = now()
         RETURNING id, (xmax = 0) AS created`,
        [email, name],
      );
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [rows[0].id, superAdmin[0].id],
      );
      await client.query('COMMIT');
      console.log(`${rows[0].created ? 'Created' : 'Updated'} super admin: ${email}. Sign in with this email; the code arrives by email.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
