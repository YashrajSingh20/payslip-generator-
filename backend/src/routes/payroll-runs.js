import { Router } from 'express';
import { P } from '../rbac/permissions.js';
import * as v from '../validate.js';

const contentDisposition = (type, fileName) =>
  `${type}; filename="${fileName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

export function sendFile(res, { fileName, bytes }, contentType, { download = true } = {}) {
  res.set({
    'Content-Type': contentType,
    'Content-Length': String(bytes.length),
    'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', fileName),
  });
  res.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

export function createPayrollRunsRouter({ guard, payroll }) {
  const router = Router();

  router.get('/', async (req, res) => {
    await guard.requirePermission(req, P.PAYROLL_READ);
    res.json({ items: await payroll.listRuns() });
  });

  router.post('/', async (req, res) => {
    const actor = await guard.requirePermission(req, P.PAYROLL_MANAGE);
    const input = v.body(req);
    const run = await payroll.createRun(actor, {
      importId: v.uuidParam(input.importId, 'Upload'),
      sheetName: v.string(input.sheetName, 'Sheet', { max: 200 }),
      period: v.period(input.period),
    });
    res.status(201).json(run);
  });

  router.get('/:id', async (req, res) => {
    await guard.requirePermission(req, P.PAYROLL_READ);
    res.json(await payroll.getRun(v.uuidParam(req.params.id, 'Payroll run')));
  });

  router.get('/:id/payslips', async (req, res) => {
    await guard.requirePermission(req, P.PAYROLL_READ);
    res.json({ items: await payroll.listPayslips(v.uuidParam(req.params.id, 'Payroll run')) });
  });

  // ?ids=a,b,c limits the archive to selected payslips.
  router.get('/:id/payslips.zip', async (req, res) => {
    await guard.requirePermission(req, P.PAYROLL_READ);
    const ids = typeof req.query.ids === 'string' && req.query.ids ? v.uuidList(req.query.ids.split(','), 'ids') : null;
    sendFile(res, await payroll.payslipZip(v.uuidParam(req.params.id, 'Payroll run'), ids), 'application/zip');
  });

  router.post('/:id/approve', async (req, res) => {
    const actor = await guard.requirePermission(req, P.PAYROLL_APPROVE);
    await payroll.approve(actor, v.uuidParam(req.params.id, 'Payroll run'));
    res.json(await payroll.getRun(req.params.id));
  });

  router.delete('/:id', async (req, res) => {
    await guard.requirePermission(req, P.PAYROLL_MANAGE);
    await payroll.deleteDraft(v.uuidParam(req.params.id, 'Payroll run'));
    res.status(204).end();
  });

  router.post('/:id/emails', async (req, res) => {
    const actor = await guard.requirePermission(req, P.PAYSLIP_SEND);
    const input = v.body(req);
    const result = await payroll.queueEmails(actor, v.uuidParam(req.params.id, 'Payroll run'), {
      payslipIds: v.uuidList(input.payslipIds, 'payslipIds'),
      resend: v.boolean(input.resend, 'resend', false),
    });
    res.status(202).json(result);
  });

  return router;
}
