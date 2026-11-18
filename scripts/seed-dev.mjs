#!/usr/bin/env node
// Local development seed: one user per system role. With DEV_AUTH_BYPASS=true the
// OTP for every user is 123456.
import { withClient } from './lib/db-connection.mjs';

if (process.env.NODE_ENV === 'production') {
  console.error('seed:dev refuses to run with NODE_ENV=production');
  process.exit(1);
}

const USERS = [
  { email: 'admin@keystone.test', name: 'Aarav Admin', role: 'super_admin' },
  { email: 'payroll@keystone.test', name: 'Priya Payroll', role: 'payroll_manager' },
  { email: 'approver@keystone.test', name: 'Arjun Approver', role: 'approver' },
  { email: 'auditor@keystone.test', name: 'Meera Auditor', role: 'auditor' },
];

await withClient(async (client) => {
  for (const user of USERS) {
    const { rows } = await client.query(
      `INSERT INTO users (email, name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, is_active = true
       RETURNING id`,
      [user.email, user.name],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE key = $2 ON CONFLICT DO NOTHING`,
      [rows[0].id, user.role],
    );
    console.log(`${user.role.padEnd(16)} ${user.email}`);
  }
});
console.log('\nSeeded. Sign in with any address above; the dev OTP is 123456 when DEV_AUTH_BYPASS=true.');
