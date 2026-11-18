import { Router } from 'express';
import { P } from '../rbac/permissions.js';

export function createTeamPortalSyncRouter({ guard, sync }) {
  const router = Router();

  router.get('/', async (req, res) => {
    await guard.requirePermission(req, P.EMPLOYEES_READ);
    res.json(await sync.status());
  });

  router.post('/', async (req, res) => {
    const actor = await guard.requirePermission(req, P.EMPLOYEES_MANAGE);
    res.json(await sync.run({ trigger: 'manual', actorId: actor.id }));
  });

  return router;
}
