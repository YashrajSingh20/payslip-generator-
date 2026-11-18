import { readCookie, SESSION_COOKIE } from '../auth/cookies.js';
import { verifySession } from '../auth/jwt.js';
import { HttpError } from '../http-error.js';

/**
 * Resolves the signed-in user and checks permissions. Called as the first
 * statement of every route handler.
 *
 * Permissions come from the DB on every request, so revoking a role or
 * deactivating a user takes effect immediately.
 */
export function createAccessGuard({ database, config }) {
  async function loadActor(req) {
    if (req.actor !== undefined) return req.actor;
    req.actor = await loadActorFromToken(readCookie(req, SESSION_COOKIE));
    return req.actor;
  }

  async function loadActorFromToken(token) {
    const session = await verifySession(token, config.auth.jwtSecret);
    let actor = null;
    if (session) {
      const { rows } = await database.query(
        `SELECT u.id, u.email, u.name, u.session_version,
                COALESCE(array_agg(p.permission_key) FILTER (WHERE p.permission_key IS NOT NULL), '{}') AS permissions
         FROM users u
         LEFT JOIN user_effective_permissions p ON p.user_id = u.id
         WHERE u.id = $1 AND u.is_active
         GROUP BY u.id`,
        [session.userId],
      );
      const row = rows[0];
      if (row && row.session_version === session.sessionVersion) {
        actor = { id: row.id, email: row.email, name: row.name, permissions: new Set(row.permissions) };
      }
    }
    return actor;
  }

  async function requireUser(req) {
    const actor = await loadActor(req);
    if (!actor) throw new HttpError(401, 'Please sign in to continue', 'unauthenticated');
    return actor;
  }

  async function requirePermission(req, permission) {
    const actor = await requireUser(req);
    if (!actor.permissions.has(permission)) {
      throw new HttpError(403, 'You do not have permission to do this', 'forbidden');
    }
    return actor;
  }

  async function requireAnyPermission(req, permissions) {
    const actor = await requireUser(req);
    if (!permissions.some((p) => actor.permissions.has(p))) {
      throw new HttpError(403, 'You do not have permission to do this', 'forbidden');
    }
    return actor;
  }

  return { loadActor, loadActorFromToken, requireUser, requirePermission, requireAnyPermission };
}
