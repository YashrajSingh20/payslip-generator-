import { Router } from 'express';
import { P } from '../rbac/permissions.js';
import * as v from '../validate.js';

export function createEmployeesRouter({ guard, employees }) {
  const router = Router();

  router.get('/', async (req, res) => {
    await guard.requirePermission(req, P.EMPLOYEES_READ);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
    res.json(await employees.list({ q, cursor, limit: v.pageLimit(req.query.limit, { fallback: 100, max: 500 }) }));
  });

  router.post('/import', async (req, res) => {
    const actor = await guard.requirePermission(req, P.EMPLOYEES_MANAGE);
    const input = v.body(req);
    res.json(await employees.importFromSheet(actor, {
      importId: v.uuidParam(input.importId, 'Upload'),
      sheetName: v.string(input.sheetName, 'Sheet', { max: 200 }),
    }));
  });

  router.patch('/:code', async (req, res) => {
    await guard.requirePermission(req, P.EMPLOYEES_MANAGE);
    res.json(await employees.update(String(req.params.code), v.body(req)));
  });

  return router;
}
