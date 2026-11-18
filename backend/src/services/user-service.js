import { badRequest, conflict, notFound } from '../http-error.js';
import * as v from '../validate.js';

const UNIQUE_VIOLATION = '23505';

const USER_SELECT = `
  SELECT u.id, u.email, u.name, u.is_active, u.last_login_at, u.created_at,
         COALESCE(json_agg(json_build_object('key', r.key, 'name', r.name) ORDER BY r.name)
                  FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id`;

const toUser = (r) => ({
  id: r.id, email: r.email, name: r.name, isActive: r.is_active,
  lastLoginAt: r.last_login_at, createdAt: r.created_at, roles: r.roles,
});

function roleKeys(value) {
  if (!Array.isArray(value) || !value.length || !value.every((k) => typeof k === 'string')) {
    throw badRequest('Choose at least one role', 'validation_failed');
  }
  return [...new Set(value)];
}

export function createUserService({ database }) {
  async function list() {
    const { rows } = await database.query(`${USER_SELECT} GROUP BY u.id ORDER BY u.is_active DESC, u.name`);
    return rows.map(toUser);
  }

  async function roles() {
    const { rows } = await database.query(
      `SELECT r.key, r.name, r.description,
              COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
        GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
    );
    return rows;
  }

  async function setRoles(tx, userId, keys) {
    const { rows } = await tx.query('SELECT id FROM roles WHERE key = ANY($1)', [keys]);
    if (rows.length !== keys.length) throw badRequest('Unknown role', 'validation_failed');
    await tx.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await tx.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::uuid[])', [userId, rows.map((r) => r.id)]);
  }

  async function get(db, id) {
    const { rows } = await db.query(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id`, [id]);
    if (!rows[0]) throw notFound('User not found');
    return toUser(rows[0]);
  }

  async function create(input) {
    const email = v.email(input.email, 'Email');
    const name = v.string(input.name, 'Name', { max: 120 });
    const keys = roleKeys(input.roleKeys);
    try {
      return await database.transaction(async (tx) => {
        const { rows } = await tx.query('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id', [email, name]);
        await setRoles(tx, rows[0].id, keys);
        return get(tx, rows[0].id);
      });
    } catch (error) {
      if (error.code === UNIQUE_VIOLATION) throw conflict('A user with this email already exists.', 'email_taken');
      throw error;
    }
  }

  async function update(actor, id, input) {
    const self = id === actor.id;
    return database.transaction(async (tx) => {
      await get(tx, id);
      if (input.name !== undefined) {
        await tx.query('UPDATE users SET name = $2, updated_at = now() WHERE id = $1', [id, v.string(input.name, 'Name', { max: 120 })]);
      }
      if (input.isActive !== undefined) {
        const isActive = v.boolean(input.isActive, 'isActive');
        if (self && !isActive) throw badRequest('You cannot deactivate your own account.', 'self_deactivation');
        // Deactivating also ends every open session.
        await tx.query(
          `UPDATE users SET is_active = $2, session_version = session_version + CASE WHEN $2 THEN 0 ELSE 1 END, updated_at = now()
            WHERE id = $1`,
          [id, isActive],
        );
      }
      if (input.roleKeys !== undefined) {
        if (self) throw badRequest('You cannot change your own roles.', 'self_role_change');
        await setRoles(tx, id, roleKeys(input.roleKeys));
      }
      return get(tx, id);
    });
  }

  return { list, roles, create, update };
}
