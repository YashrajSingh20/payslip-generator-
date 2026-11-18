import { randomUUID } from 'node:crypto';
import { HttpError } from '../http-error.js';
import { renderPayslipPdf } from '../payroll/pdf.js';
import { payslipFileName, tokensFor } from '../payroll/templates.js';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Only formats pdf-lib can embed. Checked by magic bytes, not the file name. */
export function imageType(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/**
 * Everything about payslip files and stored images:
 *  - renders PDFs (with uploaded logos when the run's branding has them),
 *  - archives approved payslips to private storage exactly once,
 *  - hands back stored bytes or a signed URL for downloads and email.
 */
export function createPayslipDocuments({ database, store, prefix, logger }) {
  const logoCache = new Map();

  async function loadObject(db, id) {
    const { rows } = await db.query("SELECT * FROM private_objects WHERE id = $1 AND status = 'ready'", [id]);
    return rows[0] ?? null;
  }

  async function saveObject(db, { purpose, ownerUserId, key, name, contentType, bytes }) {
    const { checksum } = await store.put({ key, bytes, contentType });
    const { rows } = await db.query(
      `INSERT INTO private_objects (owner_user_id, purpose, object_key, original_name, content_type, byte_size, checksum_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [ownerUserId, purpose, key, name, contentType, bytes.length, checksum],
    );
    return rows[0];
  }

  async function logoBytes(objectId) {
    if (!objectId) return null;
    if (logoCache.has(objectId)) return logoCache.get(objectId);
    const object = await loadObject(database, objectId);
    const bytes = object ? await store.get(object.object_key) : null;
    if (bytes) logoCache.set(objectId, bytes);
    return bytes;
  }

  async function runFor(period, branding) {
    const [primary, secondary] = await Promise.all([logoBytes(branding?.logoPrimaryObjectId), logoBytes(branding?.logoSecondaryObjectId)]);
    return { period, branding, logos: { primary, secondary } };
  }

  /** row: payslip joined with run (period, branding). */
  async function render(row) {
    const input = { employeeCode: row.employee_code, fullName: row.full_name, designation: row.designation, netPayPaise: row.net_pay_paise, data: row.data };
    return renderPayslipPdf(input, await runFor(row.period, row.branding));
  }

  function fileName(row) {
    const input = { employeeCode: row.employee_code, fullName: row.full_name, designation: row.designation, data: row.data };
    return payslipFileName(row.branding.filenamePattern, tokensFor(input, { period: row.period, branding: row.branding }));
  }

  /** The stored PDF when the run is approved and archived, otherwise a fresh render. */
  async function bytesFor(row) {
    if (row.pdf_object_id) {
      const object = await loadObject(database, row.pdf_object_id);
      if (object) return store.get(object.object_key);
    }
    return render(row);
  }

  /** { url } for a signed S3 redirect, or { bytes } to stream (local storage or not archived yet). */
  async function download(row, { attachment }) {
    const name = fileName(row);
    if (row.pdf_object_id) {
      const object = await loadObject(database, row.pdf_object_id);
      if (object) {
        const url = await store.signedUrl(object.object_key, { name, contentType: 'application/pdf', attachment });
        if (url) return { url, fileName: name };
        return { bytes: await store.get(object.object_key), fileName: name };
      }
    }
    return { bytes: await render(row), fileName: name };
  }

  /**
   * Writes PDFs for approved payslips that do not have one yet. Rows are claimed
   * with SKIP LOCKED, so several API instances can run this safely.
   */
  async function archiveBatch(limit = 20) {
    return database.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT p.*, r.period, r.branding, r.approved_by
           FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
          WHERE r.status = 'approved' AND p.pdf_object_id IS NULL
          ORDER BY r.approved_at, p.row_number
          LIMIT $1
          FOR UPDATE OF p SKIP LOCKED`,
        [limit],
      );
      for (const row of rows) {
        const bytes = await render(row);
        // A random suffix keeps a retry after a crash from colliding with a half-finished write.
        const key = `${prefix}/payslip_pdf/${row.run_id}/${row.id}-${randomUUID()}.pdf`;
        const object = await saveObject(tx, {
          purpose: 'payslip_pdf', ownerUserId: row.approved_by, key, name: fileName(row), contentType: 'application/pdf', bytes,
        });
        await tx.query('UPDATE payslips SET pdf_object_id = $2 WHERE id = $1', [row.id, object.id]);
      }
      return rows.length;
    });
  }

  async function saveLogo(actor, { fileName: name, bytes }) {
    if (!bytes?.length) throw new HttpError(400, 'The file is empty.', 'empty_file');
    if (bytes.length > MAX_LOGO_BYTES) throw new HttpError(413, 'Logo must be 2 MB or smaller.', 'file_too_large');
    const contentType = imageType(bytes);
    if (!contentType) throw new HttpError(400, 'Logo must be a PNG or JPEG image.', 'invalid_file_type');
    // Prove pdf-lib can embed it now, rather than failing at approval time.
    try {
      await renderPayslipPdf({ employeeCode: 'TEST', fullName: 'Test', designation: '', data: { name: 'Test', netPay: 0 } },
        { period: '2026-01', branding: { companyName: 'Test', currencyPrefix: '₹' }, logos: { primary: bytes } });
    } catch {
      throw new HttpError(400, 'This image could not be read. Export it again as PNG or JPEG.', 'invalid_image');
    }
    const ext = contentType === 'image/png' ? 'png' : 'jpg';
    const safeName = String(name || `logo.${ext}`).replace(/[\r\n\\/]/g, '_').slice(0, 200);
    return saveObject(database, {
      purpose: 'brand_logo', ownerUserId: actor.id, key: `${prefix}/brand_logo/${randomUUID()}.${ext}`,
      name: safeName, contentType, bytes,
    });
  }

  async function objectDownload(objectId, { attachment = false } = {}) {
    const object = await loadObject(database, objectId);
    if (!object) throw new HttpError(404, 'File not found', 'file_not_found');
    const url = await store.signedUrl(object.object_key, { name: object.original_name, contentType: object.content_type, attachment });
    if (url) return { url };
    return { bytes: await store.get(object.object_key), contentType: object.content_type, fileName: object.original_name };
  }

  return { render, fileName, bytesFor, download, archiveBatch, saveLogo, objectDownload, storeKind: store.kind, logger };
}

/** Archives approved payslips in the background; nudged right after an approval. */
export function startPayslipArchiveWorker({ documents, intervalMs, logger }) {
  let running = null;
  let again = false;
  const tick = async () => {
    if (running) { again = true; return; }
    running = (async () => {
      do {
        again = false;
        let n;
        do {
          n = await documents.archiveBatch();
          if (n) logger?.info('payslips_archived', { count: n, storage: documents.storeKind });
        } while (n);
      } while (again);
    })().catch((error) => logger?.error('payslip_archive_failed', { error: error.message })).finally(() => { running = null; });
    await running;
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 2000).unref?.();
  return {
    nudge: () => { tick(); },
    async close() { clearInterval(timer); await running; },
  };
}
