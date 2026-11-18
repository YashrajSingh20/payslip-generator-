import { Router } from 'express';
import { P } from '../rbac/permissions.js';
import * as v from '../validate.js';

export function createImportsRouter({ guard, imports, config }) {
  const router = Router();
  // base64 inflates by 4/3.
  const maxBase64 = Math.ceil((config.uploads.maxWorkbookBytes * 4) / 3) + 16;

  router.post('/', async (req, res) => {
    const actor = await guard.requireAnyPermission(req, [P.PAYROLL_MANAGE, P.EMPLOYEES_MANAGE]);
    const input = v.body(req);
    const fileName = v.string(input.fileName, 'File name', { max: 255 });
    const contentBase64 = v.string(input.contentBase64, 'File', { max: maxBase64 });
    res.status(201).json(await imports.createImport(actor, { fileName, contentBase64 }));
  });

  return router;
}
