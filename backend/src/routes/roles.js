import { Router } from 'express';
import { P } from '../rbac/permissions.js';
import * as v from '../validate.js';

export function createRolesRouter({ guard, roles }) {
  const router = Router();

  router.get('/', async (req, res) => {
    await guard.requireAnyPermission(req, [P.ROLES_MANAGE, P.USERS_MANAGE]);
    res.json({ items: await roles.list() });
  });

  router.get('/permissions', async (req, res) => {
    await guard.requireAnyPermission(req, [P.ROLES_MANAGE, P.USERS_MANAGE]);
    res.json({ items: await roles.listPermissions() });
  });

  router.post('/', async (req, res) => {
    await guard.requirePermission(req, P.ROLES_MANAGE);
    res.status(201).json(await roles.create(v.body(req)));
  });

  router.patch('/:id', async (req, res) => {
    await guard.requirePermission(req, P.ROLES_MANAGE);
    res.json(await roles.update(v.uuidParam(req.params.id, 'Role'), v.body(req)));
  });

  router.delete('/:id', async (req, res) => {
    await guard.requirePermission(req, P.ROLES_MANAGE);
    await roles.remove(v.uuidParam(req.params.id, 'Role'));
    res.status(204).end();
  });

  return router;
}
