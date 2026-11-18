import { createHash } from 'node:crypto';
import { HttpError, notFound } from '../http-error.js';
import { detectColumns, FIELDS } from '../payroll/fields.js';
import { parseRow, suggestPeriod } from '../payroll/normalize.js';
import { isMasterSheet, looksLikePayroll, readWorkbook } from '../payroll/workbook.js';

const RETENTION = "interval '2 days'";

export function classifySheet(sheet, mapping) {
  if (isMasterSheet(sheet.name)) return 'master';
  if (mapping.employeeId && mapping.netPay) return 'payroll';
  if (mapping.employeeId && (mapping.officialEmail || mapping.personalEmail)) return 'master';
  return 'other';
}

export function summarizeSheet(sheet) {
  const mapping = detectColumns(sheet.headers);
  const kind = classifySheet(sheet, mapping);
  const dates = sheet.rows.slice(0, 500).map((r) => parseRow(r.values, mapping).data);
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return {
    name: sheet.name,
    kind,
    rowCount: sheet.rows.length,
    headerRowNumber: sheet.headerRowNumber,
    suggestedPeriod: kind === 'payroll' ? suggestPeriod(dates, sheet.name) : null,
    mapping: FIELDS.map((f) => ({ key: f.key, label: f.label, column: mapping[f.key] })),
    unmappedColumns: sheet.headers.filter((h) => !mapped.has(h)),
  };
}

function pickDefaultSheet(summaries) {
  const payroll = summaries.filter((s) => s.kind === 'payroll');
  const named = payroll.filter((s) => looksLikePayroll(s.name));
  return (named.at(-1) ?? payroll.at(-1) ?? summaries[0])?.name ?? null;
}

export function createImportService({ database, config }) {
  async function createImport(actor, { fileName, contentBase64 }) {
    if (!/\.xlsx$/i.test(fileName)) {
      throw new HttpError(422, 'Upload an .xlsx workbook. Older .xls files can be re-saved as .xlsx from Excel.', 'unsupported_file_type');
    }
    const buffer = Buffer.from(contentBase64, 'base64');
    if (!buffer.length) throw new HttpError(400, 'The file is empty.', 'empty_file');
    if (buffer.length > config.uploads.maxWorkbookBytes) {
      throw new HttpError(413, `The file is larger than ${Math.round(config.uploads.maxWorkbookBytes / 1024 / 1024)} MB.`);
    }

    const sheets = await readWorkbook(buffer, { maxRowsPerSheet: config.uploads.maxRowsPerSheet });
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    await database.query(`DELETE FROM workbook_imports WHERE created_at < now() - ${RETENTION}`);
    const { rows } = await database.query(
      `INSERT INTO workbook_imports (file_name, file_size, sha256, sheets, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [fileName, buffer.length, sha256, JSON.stringify(sheets), actor.id],
    );

    const summaries = sheets.map(summarizeSheet);
    return {
      id: rows[0].id,
      fileName,
      fileSize: buffer.length,
      sheets: summaries,
      defaultSheet: pickDefaultSheet(summaries),
    };
  }

  /** Loads an import the actor uploaded. Returns { import, sheets }. */
  async function loadImport(actor, importId) {
    const { rows } = await database.query(
      `SELECT id, file_name, sha256, sheets FROM workbook_imports
        WHERE id = $1 AND created_by = $2 AND created_at > now() - ${RETENTION}`,
      [importId, actor.id],
    );
    if (!rows[0]) throw notFound('This upload has expired. Please upload the workbook again.');
    return rows[0];
  }

  function findSheet(workbookImport, sheetName) {
    const sheet = workbookImport.sheets.find((s) => s.name === sheetName);
    if (!sheet) throw new HttpError(422, `Sheet "${sheetName}" is not in ${workbookImport.file_name}.`, 'sheet_not_found');
    return sheet;
  }

  return { createImport, loadImport, findSheet };
}
