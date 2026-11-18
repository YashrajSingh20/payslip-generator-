import { Router } from 'express';
import { badRequest } from '../http-error.js';
import { P } from '../rbac/permissions.js';
import * as v from '../validate.js';
import { sendFile } from './payroll-runs.js';

export function createPayslipsRouter({ guard, payroll }) {
  const router = Router();

  router.get('/:id', async (req, res) => {
    await guard.requirePermission(req, P.PAYROLL_READ);
    res.json(await payroll.getPayslip(v.uuidParam(req.params.id, 'Payslip')));
  });

  // Corrects flagged fields on a draft run. Body: { changes: { netPay: "44000", officialEmail: "..." } }
  router.patch('/:id', async (req, res) => {
    const actor = await guard.requirePermission(req, P.PAYROLL_MANAGE);
    const id = v.uuidParam(req.params.id, 'Payslip');
    const { changes } = v.body(req);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw badRequest('changes must be an object', 'validation_failed');
    }
    await payroll.correctPayslip(actor, id, changes);
    res.json(await payroll.getPayslip(id));
  });

  // ?download=1 for an attachment; inline otherwise (used by the preview pane).
  router.get('/:id/pdf', async (req, res) => {
    await guard.requirePermission(req, P.PAYROLL_READ);
    const download = req.query.download === '1';
    const pdf = await payroll.payslipPdf(v.uuidParam(req.params.id, 'Payslip'), { attachment: download });
    // Approved payslips live in S3: send a 60-second signed link instead of the bytes.
    if (pdf.url) return res.set('Cache-Control', 'private, no-store').redirect(302, pdf.url);
    sendFile(res, pdf, 'application/pdf', { download });
  });

  return router;
}
