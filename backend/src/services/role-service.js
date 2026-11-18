import { badRequest, conflict, HttpError, notFound } from '../http-error.js';
import * as v from '../validate.js';

const UNIQUE_VIOLATION = '23505';
// Always holds every permission so an admin can never lock everyone out.
const LOCKED_ROLE = 'super_admin';

const ROLE_SELECT = `
  SELECT r.id, r.key, r.name, r.description, r.is_system,
         COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
         (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS holders
    FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id`;

const toRole = (r) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  isSystem: r.is_system,
  locked: r.key === LOCKED_ROLE,
  permissions: r.permissions,
  holders: r.holders,
});

/** "Payroll Reviewer (North)" -> "payroll_reviewer_north" */
export function roleKeyFrom(name) {
  const key = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  if (!key) return '';
  return /^[a-z]/.test(key) ? key : `role_${key}`;
}

/**
 * Custom roles, the same model as the Team Portal: built-in roles can be
 * re-permissioned but not deleted; custom roles can be created, renamed and
 * deleted once nobody holds them. The permission list itself is fixed in code.
 */
export function createRoleService({ database }) {
  async function get(db, id) {
    const { rows } = await db.query(`${ROLE_SELECT} WHERE r.id = $1 GROUP BY r.id`, [id]);
    if (!rows[0]) throw notFound('Role not found');
    return toRole(rows[0]);
  }

  async function list() {
    const { rows } = await database.query(`${ROLE_SELECT} GROUP BY r.id ORDER BY r.is_system DESC, r.name`);
    return rows.map(toRole);
  }

  async function listPermissions() {
    const { rows } = await database.query('SELECT key, description FROM permissions ORDER BY key');
    return rows;
  }

  async function writePermissions(tx, roleId, keys) {
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) {
      throw badRequest('permissions must be a list of permission keys', 'validation_failed');
    }
    const wanted = [...new Set(keys)];
    const { rows } = await tx.query('SELECT key FROM permissions WHERE key = ANY($1)', [wanted]);
    if (rows.length !== wanted.length) {
      const known = new Set(rows.map((r) => r.key));
      throw badRequest(`Unknown permission(s): ${wanted.filter((k) => !known.has(k)).join(', ')}`, 'validation_failed');
    }
    await tx.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    if (wanted.length) {
      await tx.query('INSERT INTO role_permissions (role_id, permission_key) SELECT $1, unnest($2::text[])', [roleId, wanted]);
    }
  }

  async function create(input) {
    const name = v.string(input.name, 'Name', { max: 100 });
    const description = v.string(input.description ?? '', 'Description', { required: false, max: 300 }) ?? '';
    const key = roleKeyFrom(name);
    if (!key) throw badRequest('Use letters or numbers in the role name', 'validation_failed');
    try {
      return await database.transaction(async (tx) => {
        const { rows } = await tx.query(
          'INSERT INTO roles (key, name, description, is_system) VALUES ($1, $2, $3, false) RETURNING id',
          [key, name, description],
        );
        if (input.permissions !== undefined) await writePermissions(tx, rows[0].id, input.permissions);
        return get(tx, rows[0].id);
      });
    } catch (error) {
      if (error.code === UNIQUE_VIOLATION) throw conflict('A role with this name already exists.', 'role_exists');
      throw error;
    }
  }

  async function update(id, input) {
    return database.transaction(async (tx) => {
      const role = await get(tx, id);
      if (input.name !== undefined) {
        await tx.query('UPDATE roles SET name = $2 WHERE id = $1', [id, v.string(input.name, 'Name', { max: 100 })]);
      }
      if (input.description !== undefined) {
        const description = v.string(input.description, 'Description', { required: false, max: 300 }) ?? '';
        await tx.query('UPDATE roles SET description = $2 WHERE id = $1', [id, description]);
      }
      if (input.permissions !== undefined) {
        if (role.locked) throw new HttpError(422, 'Super admin always has every permission.', 'role_locked');
        await writePermissions(tx, id, input.permissions);
      }
      return get(tx, id);
    });
  }

  async function remove(id) {
    const role = await get(database, id);
    if (role.isSystem) throw new HttpError(422, `"${role.name}" is a built-in role and cannot be deleted.`, 'system_role');
    if (role.holders) throw conflict(`${role.holders} user(s) still have this role. Change their roles first.`, 'role_in_use');
    await database.query('DELETE FROM roles WHERE id = $1 AND NOT is_system', [id]);
  }

  return { list, listPermissions, create, update, remove };
}
