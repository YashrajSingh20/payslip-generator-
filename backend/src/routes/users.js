import { Router } from 'express';
import { P } from '../rbac/permissions.js';
import * as v from '../validate.js';

export function createUsersRouter({ guard, users }) {
  const router = Router();

  router.get('/', async (req, res) => {
    await guard.requirePermission(req, P.USERS_MANAGE);
    res.json({ items: await users.list() });
  });

  router.get('/roles', async (req, res) => {
    await guard.requirePermission(req, P.USERS_MANAGE);
    res.json({ items: await users.roles() });
  });

  router.post('/', async (req, res) => {
    await guard.requirePermission(req, P.USERS_MANAGE);
    res.status(201).json(await users.create(v.body(req)));
  });

  router.patch('/:id', async (req, res) => {
    const actor = await guard.requirePermission(req, P.USERS_MANAGE);
    res.json(await users.update(actor, v.uuidParam(req.params.id, 'User'), v.body(req)));
  });

  return router;
}
