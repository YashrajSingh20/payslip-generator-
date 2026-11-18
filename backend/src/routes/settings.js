import { Router } from 'express';
import { P } from '../rbac/permissions.js';
import { badRequest } from '../http-error.js';
import * as v from '../validate.js';

const SLOTS = new Set(['primary', 'secondary']);
const slotParam = (value) => {
  if (!SLOTS.has(value)) throw badRequest('Logo slot must be primary or secondary', 'validation_failed');
  return value;
};

export function createSettingsRouter({ guard, settings, mailer, documents, config }) {
  const router = Router();

  router.get('/', async (req, res) => {
    await guard.requireAnyPermission(req, [P.PAYROLL_READ, P.SETTINGS_MANAGE]);
    res.json({ ...(await settings.get()), emailProvider: mailer?.provider ?? null });
  });

  router.put('/', async (req, res) => {
    const actor = await guard.requirePermission(req, P.SETTINGS_MANAGE);
    res.json({ ...(await settings.update(actor, v.body(req))), emailProvider: mailer?.provider ?? null });
  });

  // Upload a PNG/JPEG logo. Stored privately (S3 in AWS) and printed on new runs.
  router.post('/logos/:slot', async (req, res) => {
    const actor = await guard.requirePermission(req, P.SETTINGS_MANAGE);
    const slot = slotParam(req.params.slot);
    const input = v.body(req);
    const contentBase64 = v.string(input.contentBase64, 'File', { max: Math.ceil((2 * 1024 * 1024 * 4) / 3) + 8 });
    const object = await documents.saveLogo(actor, {
      fileName: v.string(input.fileName, 'File name', { max: 200 }),
      bytes: Buffer.from(contentBase64, 'base64'),
    });
    res.status(201).json({ ...(await settings.setLogo(slot, object.id)), emailProvider: mailer?.provider ?? null });
  });

  // Back to the bundled logo. The uploaded file stays stored for runs that used it.
  router.delete('/logos/:slot', async (req, res) => {
    await guard.requirePermission(req, P.SETTINGS_MANAGE);
    res.json({ ...(await settings.setLogo(slotParam(req.params.slot), null)), emailProvider: mailer?.provider ?? null });
  });

  router.get('/logos/:slot', async (req, res) => {
    await guard.requireAnyPermission(req, [P.PAYROLL_READ, P.SETTINGS_MANAGE]);
    const slot = slotParam(req.params.slot);
    const current = await settings.get();
    const objectId = slot === 'primary' ? current.logoPrimaryObjectId : current.logoSecondaryObjectId;
    if (!objectId) return res.status(404).json({ error: 'Using the default logo', code: 'default_logo' });
    const file = await documents.objectDownload(objectId);
    if (file.url) return res.set('Cache-Control', 'private, no-store').redirect(302, file.url);
    res.set({ 'Content-Type': file.contentType, 'Cache-Control': 'private, no-store' }).end(file.bytes);
  });

  return router;
}
