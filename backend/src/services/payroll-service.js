import { zipSync } from 'fflate';
import { conflict, HttpError, notFound } from '../http-error.js';
import { detectColumns, FIELD_BY_KEY } from '../payroll/fields.js';
import { amountInWords } from '../payroll/format.js';
import { auditPayslip, buildPayslips, CORRECTABLE_FIELDS } from '../payroll/normalize.js';
import { PARSERS } from '../payroll/values.js';
import { payslipFileName, renderTemplate, tokensFor } from '../payroll/templates.js';
import { isMasterSheet } from '../payroll/workbook.js';
import { employeesFromSheet, upsertEmployees } from './employee-service.js';

const UNIQUE_VIOLATION = '23505';

const toRun = (r) => ({
  id: r.id,
  period: r.period,
  status: r.status,
  sourceFileName: r.source_file_name,
  sourceSheet: r.source_sheet,
  branding: r.branding,
  columnMapping: r.column_mapping,
  employeeCount: r.employee_count,
  netPayTotalPaise: r.net_pay_total_paise,
  createdAt: r.created_at,
  createdBy: r.created_by_name ? { id: r.created_by, name: r.created_by_name } : null,
  approvedAt: r.approved_at,
  approvedBy: r.approved_by_name ? { id: r.approved_by, name: r.approved_by_name } : null,
  stats: r.blocking_count === undefined
    ? undefined
    : {
        blocking: r.blocking_count,
        warnings: r.warning_count,
        emailable: r.emailable_count,
        emailsSent: r.emails_sent,
        emailsQueued: r.emails_queued,
        emailsFailed: r.emails_failed,
      },
});

const toPayslipItem = (r) => ({
  id: r.id,
  rowNumber: r.row_number,
  employeeCode: r.employee_code,
  fullName: r.full_name,
  designation: r.designation,
  email: r.effective_email,
  emailFromDirectory: !r.recipient_email && Boolean(r.effective_email),
  netPayPaise: r.net_pay_paise,
  grossEarningsPaise: r.gross_earnings_paise,
  totalDeductionsPaise: r.total_deductions_paise,
  ctcPaise: r.data?.ctc ?? null,
  workingDays: r.data?.workingDays ?? null,
  blockingIssueCount: r.blocking_issue_count,
  warningIssueCount: r.warning_issue_count,
  issues: r.issues,
  derivedFields: r.derived_fields,
  emailStatus: r.email_status ?? null,
  emailSentAt: r.email_sent_at ?? null,
  emailError: r.email_error ?? null,
});

// Recipient: the address captured on the run, else the directory address by
// preference, so fixing an email in Employees is enough to send.
const effectiveEmail = (pref) => `COALESCE(p.recipient_email,
  CASE WHEN ${pref} = 'personal' THEN COALESCE(e.personal_email, e.official_email)
       ELSE COALESCE(e.official_email, e.personal_email) END)`;

const runSelect = (pref) => `
  SELECT r.*, cu.name AS created_by_name, au.name AS approved_by_name,
    (SELECT count(*)::int FROM payslips p WHERE p.run_id = r.id AND p.blocking_issue_count > 0) AS blocking_count,
    (SELECT count(*)::int FROM payslips p WHERE p.run_id = r.id AND p.warning_issue_count > 0) AS warning_count,
    (SELECT count(*)::int FROM payslips p LEFT JOIN employees e ON e.employee_code = p.employee_code
      WHERE p.run_id = r.id AND p.blocking_issue_count = 0 AND ${effectiveEmail(pref)} IS NOT NULL) AS emailable_count,
    (SELECT count(DISTINCT o.payslip_id)::int FROM email_outbox o JOIN payslips p ON p.id = o.payslip_id
      WHERE p.run_id = r.id AND o.status = 'sent') AS emails_sent,
    (SELECT count(*)::int FROM email_outbox o JOIN payslips p ON p.id = o.payslip_id
      WHERE p.run_id = r.id AND o.status IN ('pending', 'sending')) AS emails_queued,
    (SELECT count(*)::int FROM email_outbox o JOIN payslips p ON p.id = o.payslip_id
      WHERE p.run_id = r.id AND o.status = 'failed') AS emails_failed
  FROM payroll_runs r
  JOIN users cu ON cu.id = r.created_by
  LEFT JOIN users au ON au.id = r.approved_by`;

/** De-duplicates file names inside a ZIP: a.pdf, a (2).pdf, ... */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? name : name.replace(/\.pdf$/i, ` (${n}).pdf`);
  });
}

/**
 * Re-runs the audit for every payslip in a draft run (duplicate-ID checks need
 * the whole run) and refreshes the run total. Pass `slips` to save values
 * already changed in memory; otherwise they are read from the database.
 */
export async function reauditRun(tx, runId, preference, slips = null) {
  const rows = slips ?? (await tx.query(
    'SELECT id, data, derived_fields, issues, edits FROM payslips WHERE run_id = $1 ORDER BY row_number',
    [runId],
  )).rows;

  const idCounts = new Map();
  for (const p of rows) idCounts.set(p.data.employeeId, (idCounts.get(p.data.employeeId) ?? 0) + 1);

  for (const p of rows) {
    const edited = new Set(p.edits.map((e) => e.field));
    const invalidKeys = p.issues.filter((i) => i.check.startsWith('Unreadable ')).map((i) => i.field
      ?? [...FIELD_BY_KEY.values()].find((f) => i.check === `Unreadable ${f.label}`)?.key).filter((k) => k && !edited.has(k));
    const audit = auditPayslip({
      data: p.data, invalidKeys, derived: p.derived_fields, duplicateCount: idCounts.get(p.data.employeeId),
      edits: p.edits, preference,
    });
    await tx.query(
      `UPDATE payslips SET employee_code = $2, full_name = $3, designation = $4, recipient_email = $5,
              net_pay_paise = $6, data = $7, derived_fields = $8, issues = $9,
              blocking_issue_count = $10, warning_issue_count = $11, edits = $12
        WHERE id = $1`,
      [p.id, p.data.employeeId, p.data.name ?? '', p.data.designation ?? '', audit.recipient, p.data.netPay,
        p.data, p.derived_fields, JSON.stringify(audit.issues), audit.blockingIssueCount, audit.warningIssueCount,
        JSON.stringify(p.edits)],
    );
  }

  await tx.query(
    `UPDATE payroll_runs SET net_pay_total_paise = (SELECT COALESCE(sum(net_pay_paise), 0) FROM payslips WHERE run_id = $1)
      WHERE id = $1`,
    [runId],
  );
}

/** Applies the current audit rules to all draft runs. Approved runs are never touched. */
export async function reauditDraftRuns({ database, settings }) {
  const preference = (await settings.get()).recipientPreference;
  const { rows } = await database.query(`SELECT id FROM payroll_runs WHERE status = 'draft'`);
  for (const { id } of rows) {
    await database.transaction(async (tx) => {
      const { rows: run } = await tx.query('SELECT status FROM payroll_runs WHERE id = $1 FOR UPDATE', [id]);
      if (run[0]?.status === 'draft') await reauditRun(tx, id, preference);
    });
  }
  return rows.length;
}

export function createPayrollService({ database, imports, settings, mailer, documents, onEmailsQueued = () => {}, onApproved = () => {} }) {
  async function preference() {
    return (await settings.get()).recipientPreference;
  }

  async function directoryFor(tx, workbookImport, codes) {
    const directory = new Map();
    const { rows } = await tx.query(
      `SELECT employee_code, full_name, designation, joining_date, exit_date, official_email, personal_email, pan, uan
         FROM employees WHERE employee_code = ANY($1)`,
      [codes],
    );
    for (const r of rows) {
      directory.set(r.employee_code, {
        fullName: r.full_name, designation: r.designation, joiningDate: r.joining_date, exitDate: r.exit_date,
        officialEmail: r.official_email, personalEmail: r.personal_email, pan: r.pan, uan: r.uan,
      });
    }
    // An "Employee Master" sheet in the same workbook wins over the stored directory.
    for (const sheet of workbookImport.sheets.filter((s) => isMasterSheet(s.name))) {
      for (const e of employeesFromSheet(sheet).employees) {
        const current = directory.get(e.employeeCode) ?? {};
        const merged = { ...current };
        for (const [k, val] of Object.entries(e)) if (val) merged[k] = val;
        directory.set(e.employeeCode, merged);
      }
    }
    return directory;
  }

  async function createRun(actor, { importId, sheetName, period }) {
    const workbookImport = await imports.loadImport(actor, importId);
    const sheet = imports.findSheet(workbookImport, sheetName);
    const mapping = detectColumns(sheet.headers);
    if (!mapping.employeeId || !mapping.netPay) {
      throw new HttpError(422, `"${sheetName}" needs at least an Employee ID column and a Net Pay column.`, 'missing_required_columns');
    }

    const current = await settings.get();
    const branding = {
      companyName: current.companyName,
      cin: current.cin,
      registeredOffice: current.registeredOffice,
      logoPrimaryObjectId: current.logoPrimaryObjectId,
      logoSecondaryObjectId: current.logoSecondaryObjectId,
      currencyPrefix: current.currencyPrefix,
      footerText: current.footerText,
      filenamePattern: current.filenamePattern,
    };

    return database.transaction(async (tx) => {
      const codes = sheet.rows.map((r) => String(r.values[mapping.employeeId] ?? '').trim()).filter(Boolean);
      const directory = await directoryFor(tx, workbookImport, codes);
      const payslips = buildPayslips({ sheet, mapping, directory, preference: current.recipientPreference });
      if (!payslips.length) throw new HttpError(422, `"${sheetName}" has no rows with an Employee ID.`, 'empty_sheet');

      const netTotal = payslips.reduce((sum, p) => sum + (p.netPayPaise ?? 0), 0);
      const { rows } = await tx.query(
        `INSERT INTO payroll_runs (period, source_file_name, source_sheet, source_sha256, branding, column_mapping,
                                   employee_count, net_pay_total_paise, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [period, workbookImport.file_name, sheetName, workbookImport.sha256, branding, mapping,
          payslips.length, netTotal, actor.id],
      );
      const runId = rows[0].id;

      await tx.query(
        `INSERT INTO payslips (run_id, row_number, employee_code, full_name, designation, recipient_email,
                               net_pay_paise, gross_earnings_paise, total_deductions_paise, data, derived_fields,
                               issues, blocking_issue_count, warning_issue_count, source_row)
         SELECT $1, x."rowNumber", x."employeeCode", x."fullName", x.designation, x."recipientEmail",
                x."netPayPaise", x."grossEarningsPaise", x."totalDeductionsPaise", x.data,
                ARRAY(SELECT jsonb_array_elements_text(x."derivedFields")), x.issues,
                x."blockingIssueCount", x."warningIssueCount", x."sourceRow"
           FROM jsonb_to_recordset($2::jsonb) AS x(
             "rowNumber" int, "employeeCode" text, "fullName" text, designation text, "recipientEmail" text,
             "netPayPaise" bigint, "grossEarningsPaise" bigint, "totalDeductionsPaise" bigint, data jsonb,
             "derivedFields" jsonb, issues jsonb, "blockingIssueCount" int, "warningIssueCount" int, "sourceRow" jsonb)`,
        [runId, JSON.stringify(payslips)],
      );

      // Keep the employee directory current (blank values never erase stored ones).
      const byCode = new Map();
      for (const p of payslips) {
        byCode.set(p.employeeCode, {
          employeeCode: p.employeeCode,
          fullName: p.data.name,
          designation: p.data.designation,
          joiningDate: p.data.joiningDate,
          exitDate: p.data.exitDate,
          officialEmail: p.data.officialEmail?.includes('@') ? p.data.officialEmail : null,
          personalEmail: p.data.personalEmail?.includes('@') ? p.data.personalEmail : null,
          pan: p.data.pan,
          uan: p.data.uan,
        });
      }
      await upsertEmployees(tx, [...byCode.values()]);
      return { id: runId };
    });
  }

  async function listRuns() {
    const { rows } = await database.query(
      `${runSelect('$1')} ORDER BY r.period DESC, r.created_at DESC LIMIT 120`,
      [await preference()],
    );
    return rows.map(toRun);
  }

  async function getRun(runId) {
    const { rows } = await database.query(`${runSelect('$2')} WHERE r.id = $1`, [runId, await preference()]);
    if (!rows[0]) throw notFound('Payroll run not found');
    return toRun(rows[0]);
  }

  async function listPayslips(runId) {
    await getRun(runId);
    const { rows } = await database.query(
      `SELECT p.id, p.row_number, p.employee_code, p.full_name, p.designation, p.recipient_email,
              p.net_pay_paise, p.gross_earnings_paise, p.total_deductions_paise,
              jsonb_build_object('ctc', p.data->'ctc', 'workingDays', p.data->'workingDays') AS data,
              p.blocking_issue_count, p.warning_issue_count, p.issues, p.derived_fields,
              ${effectiveEmail('$2')} AS effective_email,
              o.status AS email_status, o.sent_at AS email_sent_at, o.last_error AS email_error
         FROM payslips p
         LEFT JOIN employees e ON e.employee_code = p.employee_code
         LEFT JOIN LATERAL (
           SELECT status, sent_at, last_error FROM email_outbox WHERE payslip_id = p.id ORDER BY id DESC LIMIT 1
         ) o ON true
        WHERE p.run_id = $1
        ORDER BY p.row_number`,
      [runId, await preference()],
    );
    return rows.map(toPayslipItem);
  }

  async function loadPayslip(payslipId) {
    const { rows } = await database.query(
      `SELECT p.*, r.period, r.branding, r.status AS run_status, r.source_sheet, r.source_file_name
         FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = $1`,
      [payslipId],
    );
    if (!rows[0]) throw notFound('Payslip not found');
    return rows[0];
  }

  const pdfInput = (row) => ({
    employeeCode: row.employee_code, fullName: row.full_name, designation: row.designation,
    netPayPaise: row.net_pay_paise, data: row.data,
  });

  async function getPayslip(payslipId) {
    const row = await loadPayslip(payslipId);
    const { rows: emails } = await database.query(
      `SELECT id, to_email, status, attempts, last_error, created_at, sent_at
         FROM email_outbox WHERE payslip_id = $1 ORDER BY id DESC LIMIT 20`,
      [payslipId],
    );
    const run = { period: row.period, branding: row.branding };
    return {
      id: row.id,
      runId: row.run_id,
      runStatus: row.run_status,
      period: row.period,
      rowNumber: row.row_number,
      employeeCode: row.employee_code,
      fullName: row.full_name,
      designation: row.designation,
      recipientEmail: row.recipient_email,
      netPayPaise: row.net_pay_paise,
      data: row.data,
      derivedFields: row.derived_fields,
      issues: row.issues,
      edits: row.edits,
      sourceSheet: row.source_sheet,
      sourceFileName: row.source_file_name,
      sourceRow: row.source_row,
      fileName: payslipFileName(row.branding.filenamePattern, tokensFor(pdfInput(row), run)),
      emails: emails.map((e) => ({
        id: e.id, to: e.to_email, status: e.status, attempts: e.attempts, error: e.last_error,
        createdAt: e.created_at, sentAt: e.sent_at,
      })),
    };
  }

  /** { url } (signed S3 link) or { bytes }; approved payslips come from storage. */
  async function payslipPdf(payslipId, { attachment = false } = {}) {
    return documents.download(await loadPayslip(payslipId), { attachment });
  }

  async function payslipZip(runId, payslipIds) {
    const run = await getRun(runId);
    const params = [runId];
    let filter = '';
    if (payslipIds?.length) {
      params.push(payslipIds);
      filter = 'AND id = ANY($2)';
    }
    const { rows } = await database.query(
      `SELECT p.*, r.period, r.branding FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
        WHERE p.run_id = $1 ${filter.replace('id', 'p.id')} ORDER BY p.row_number`,
      params,
    );
    if (!rows.length) throw new HttpError(422, 'No payslips selected.', 'nothing_selected');

    const names = uniqueNames(rows.map((row) => documents.fileName(row)));
    const files = {};
    for (let i = 0; i < rows.length; i += 1) {
      files[names[i]] = [await documents.bytesFor(rows[i]), { level: 0 }];
    }
    const [year, month] = run.period.split('-');
    return { fileName: `Keystone_Payslips_${year}_${month}.zip`, bytes: zipSync(files) };
  }

  async function approve(actor, runId) {
    try {
      return await database.transaction(async (tx) => {
        const { rows } = await tx.query('SELECT status FROM payroll_runs WHERE id = $1 FOR UPDATE', [runId]);
        if (!rows[0]) throw notFound('Payroll run not found');
        if (rows[0].status !== 'draft') throw conflict('This run is already approved.', 'already_approved');
        const { rows: blocking } = await tx.query(
          'SELECT count(*)::int AS n FROM payslips WHERE run_id = $1 AND blocking_issue_count > 0',
          [runId],
        );
        if (blocking[0].n > 0) {
          throw conflict(`${blocking[0].n} payslip(s) have blocking issues. Fix them on the run page or upload a corrected register.`, 'blocking_issues');
        }
        await tx.query(
          `UPDATE payroll_runs SET status = 'approved', approved_by = $2, approved_at = now()
            WHERE id = $1 AND status = 'draft'`,
          [runId, actor.id],
        );
        return { id: runId };
      }).then((result) => {
        onApproved(); // store the final PDFs now
        return result;
      });
    } catch (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw conflict('Another run for this month is already approved.', 'period_already_approved');
      }
      throw error;
    }
  }

  /**
   * Corrects the fields the audit flags (ID, name, designation, net pay, emails)
   * on a draft run, then re-audits every payslip in the run so duplicate-ID
   * checks stay correct. Each change is recorded in payslips.edits.
   */
  async function correctPayslip(actor, payslipId, changes) {
    const keys = Object.keys(changes ?? {});
    if (!keys.length) throw new HttpError(400, 'Nothing to change.', 'validation_failed');
    const unknown = keys.filter((k) => !CORRECTABLE_FIELDS.includes(k));
    if (unknown.length) throw new HttpError(400, `These fields cannot be edited here: ${unknown.join(', ')}`, 'field_not_correctable');

    const parsed = {};
    for (const key of keys) {
      const field = FIELD_BY_KEY.get(key);
      const raw = changes[key];
      if (raw !== null && typeof raw !== 'string' && typeof raw !== 'number') {
        throw new HttpError(400, `${field.label} must be text or a number.`, 'validation_failed');
      }
      if (typeof raw === 'string' && raw.length > 254) throw new HttpError(400, `${field.label} is too long.`, 'validation_failed');
      const { value, invalid } = PARSERS[field.type](raw);
      if (invalid) throw new HttpError(400, `${field.label} is not a valid ${field.type === 'money' ? 'amount' : field.type}.`, 'validation_failed');
      if (value === null && ['employeeId', 'name', 'netPay'].includes(key)) {
        throw new HttpError(400, `${field.label} cannot be blank.`, 'validation_failed');
      }
      if (key === 'netPay' && value < 0) throw new HttpError(400, 'Net Pay cannot be negative.', 'validation_failed');
      parsed[key] = value;
    }

    const pref = await preference();
    return database.transaction(async (tx) => {
      const { rows: target } = await tx.query('SELECT run_id FROM payslips WHERE id = $1', [payslipId]);
      if (!target[0]) throw notFound('Payslip not found');
      const runId = target[0].run_id;
      const { rows: run } = await tx.query('SELECT status FROM payroll_runs WHERE id = $1 FOR UPDATE', [runId]);
      if (run[0].status !== 'draft') throw conflict('Approved runs cannot be edited.', 'run_approved');

      const { rows: slips } = await tx.query(
        'SELECT id, data, derived_fields, issues, edits FROM payslips WHERE run_id = $1 ORDER BY row_number',
        [runId],
      );
      const at = new Date().toISOString();
      const slip = slips.find((p) => p.id === payslipId);
      for (const [key, value] of Object.entries(parsed)) {
        const from = slip.data[key] ?? null;
        if (from === value) continue;
        slip.data[key] = value;
        slip.edits = [...slip.edits, { field: key, from, to: value, by: { id: actor.id, name: actor.name }, at }];
        slip.changed = true;
        if (key === 'netPay') {
          slip.data.amountWords = amountInWords(value);
          if (!slip.derived_fields.includes('amountWords')) slip.derived_fields = [...slip.derived_fields, 'amountWords'];
        }
      }
      if (!slip.changed) return { id: payslipId };

      await reauditRun(tx, runId, pref, slips);

      // Corrected names and emails also help future runs.
      const d = slip.data;
      await upsertEmployees(tx, [{
        employeeCode: d.employeeId, fullName: d.name, designation: d.designation, joiningDate: d.joiningDate, exitDate: d.exitDate,
        officialEmail: d.officialEmail?.includes('@') && parsed.officialEmail !== undefined ? d.officialEmail : null,
        personalEmail: d.personalEmail?.includes('@') && parsed.personalEmail !== undefined ? d.personalEmail : null,
      }]);
      return { id: payslipId };
    });
  }

  async function deleteDraft(runId) {
    const { rows } = await database.query(
      `DELETE FROM payroll_runs WHERE id = $1 AND status = 'draft' RETURNING id`,
      [runId],
    );
    if (rows[0]) return;
    await getRun(runId); // 404 when missing
    throw conflict('Approved runs cannot be deleted.', 'run_approved');
  }

  /**
   * Queues payslip emails for an approved run. Without `resend`, payslips that
   * already have a queued or sent email are skipped, so a double click or a
   * retried request never mails anyone twice.
   */
  async function queueEmails(actor, runId, { payslipIds = null, resend = false }) {
    if (!mailer) throw new HttpError(503, 'Email is not configured. Add the Gmail credentials to .env.', 'email_unavailable');
    const current = await settings.get();

    const result = await database.transaction(async (tx) => {
      const { rows: runs } = await tx.query('SELECT id, status, period, branding FROM payroll_runs WHERE id = $1 FOR UPDATE', [runId]);
      const run = runs[0];
      if (!run) throw notFound('Payroll run not found');
      if (run.status !== 'approved') throw conflict('Approve the run before emailing payslips.', 'run_not_approved');

      const params = [runId, current.recipientPreference];
      let filter = '';
      if (payslipIds?.length) {
        params.push(payslipIds);
        filter = `AND p.id = ANY($${params.length})`;
      }
      const { rows: candidates } = await tx.query(
        `SELECT p.id, p.employee_code, p.full_name, p.designation, p.net_pay_paise, p.data, p.blocking_issue_count,
                ${effectiveEmail('$2')} AS email,
                EXISTS (SELECT 1 FROM email_outbox o WHERE o.payslip_id = p.id AND o.status IN ('pending', 'sending', 'sent')) AS already
           FROM payslips p
           LEFT JOIN employees e ON e.employee_code = p.employee_code
          WHERE p.run_id = $1 ${filter}
          ORDER BY p.row_number`,
        params,
      );

      const skipped = { noEmail: 0, blocking: 0, alreadySent: 0 };
      const toQueue = [];
      for (const c of candidates) {
        if (c.blocking_issue_count > 0) skipped.blocking += 1;
        else if (!c.email) skipped.noEmail += 1;
        else if (c.already && !resend) skipped.alreadySent += 1;
        else toQueue.push(c);
      }

      const outbox = toQueue.map((c) => {
        const input = { employeeCode: c.employee_code, fullName: c.full_name, designation: c.designation, netPayPaise: c.net_pay_paise, data: c.data };
        const tokens = tokensFor(input, run);
        return {
          payslipId: c.id,
          to: c.email,
          subject: renderTemplate(current.emailSubject, tokens),
          body: renderTemplate(current.emailBody, tokens),
          attachment: payslipFileName(run.branding.filenamePattern, tokens),
        };
      });
      if (outbox.length) {
        await tx.query(
          `INSERT INTO email_outbox (kind, payslip_id, to_email, from_name, subject, body_text, attachment_name, created_by)
           SELECT 'payslip', x."payslipId", x."to", $2, x.subject, x.body, x.attachment, $3
             FROM jsonb_to_recordset($1::jsonb) AS x("payslipId" uuid, "to" text, subject text, body text, attachment text)`,
          [JSON.stringify(outbox), current.emailFromName, actor.id],
        );
      }
      return { queued: outbox.length, skipped };
    });

    if (result.queued) onEmailsQueued();
    return result;
  }

  return { createRun, listRuns, getRun, listPayslips, getPayslip, payslipPdf, payslipZip, approve, deleteDraft, queueEmails, correctPayslip };
}
