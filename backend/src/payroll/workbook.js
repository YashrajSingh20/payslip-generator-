import ExcelJS from 'exceljs';
import { FIELD_BY_KEY, normalizeHeader } from './fields.js';
import { HttpError } from '../http-error.js';

const HEADER_SCAN_ROWS = 15;
const ID_ALIASES = new Set(FIELD_BY_KEY.get('employeeId').aliases.map(normalizeHeader));

const isoDay = (date) => new Date(Math.round(date.getTime() / 86_400_000) * 86_400_000).toISOString().slice(0, 10);

/**
 * Reduces an exceljs cell value to a JSON-safe primitive.
 * Dates become 'YYYY-MM-DD'. Excel stores date-only cells as UTC midnight, so
 * rounding to the nearest UTC day avoids the off-by-one the browser version had.
 */
export function cellToPrimitive(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : isoDay(value);
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    if ('result' in value) return cellToPrimitive(value.result); // formula
    if ('sharedFormula' in value) return cellToPrimitive(value.result ?? null);
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if ('text' in value) return cellToPrimitive(value.text); // hyperlink
    if ('error' in value) return null;
  }
  return String(value);
}

function rowValues(row, columnCount) {
  const out = [];
  for (let c = 1; c <= columnCount; c += 1) out.push(cellToPrimitive(row.getCell(c).value));
  return out;
}

const hasContent = (values) => values.some((v) => v !== null && String(v).trim() !== '');

/** The header row is the first one naming an Employee ID column, else the first non-empty row. */
function findHeaderRow(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i += 1) {
    if (rows[i].values.some((v) => ID_ALIASES.has(normalizeHeader(v)))) return i;
  }
  return rows.findIndex((r) => hasContent(r.values));
}

function uniqueHeaders(rawHeaders) {
  const seen = new Map();
  return rawHeaders.map((raw, i) => {
    const base = raw === null || String(raw).trim() === '' ? `Column ${i + 1}` : String(raw).trim().replace(/\s+/g, ' ');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/**
 * Parses an .xlsx buffer into sheets of header-keyed rows:
 *   [{ name, headerRowNumber, headers: [..], rows: [{ rowNumber, values: { header: primitive } }] }]
 */
export async function readWorkbook(buffer, { maxRowsPerSheet }) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new HttpError(422, 'This file could not be read as an .xlsx workbook. Re-save it from Excel as .xlsx and try again.', 'invalid_workbook');
  }

  const sheets = [];
  workbook.eachSheet((worksheet) => {
    if (worksheet.state && worksheet.state !== 'visible') return;
    const columnCount = worksheet.actualColumnCount || worksheet.columnCount;
    const raw = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      raw.push({ rowNumber, values: rowValues(row, columnCount) });
    });

    const headerIndex = findHeaderRow(raw);
    if (headerIndex === -1) {
      sheets.push({ name: worksheet.name, headerRowNumber: null, headers: [], rows: [] });
      return;
    }

    const headers = uniqueHeaders(raw[headerIndex].values);
    const dataRows = raw.slice(headerIndex + 1).filter((r) => hasContent(r.values));
    if (dataRows.length > maxRowsPerSheet) {
      throw new HttpError(413, `Sheet "${worksheet.name}" has ${dataRows.length} rows; the limit is ${maxRowsPerSheet}.`, 'too_many_rows');
    }
    sheets.push({
      name: worksheet.name,
      headerRowNumber: raw[headerIndex].rowNumber,
      headers,
      rows: dataRows.map((r) => ({
        rowNumber: r.rowNumber,
        values: Object.fromEntries(headers.map((h, i) => [h, r.values[i] ?? null])),
      })),
    });
  });

  if (!sheets.length) throw new HttpError(422, 'The workbook has no visible sheets.', 'empty_workbook');
  return sheets;
}

export const isMasterSheet = (name) => /employee\s*master|^master$/i.test(name);
export const looksLikePayroll = (name) => /^pr[-_ ]|payroll|salary|register/i.test(name);
