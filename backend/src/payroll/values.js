// Parsing of individual workbook cell values. Every parser returns
// { value, invalid } where value is null when the cell is blank or unreadable.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_NAME_DATE = /^(\d{1,2})[-\s/]([a-z]{3,9})[-\s/,]+(\d{2}|\d{4})$/i;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

export const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
export const isEmail = (v) => EMAIL.test(String(v ?? '').trim());

const ok = (value) => ({ value, invalid: false });
const blank = { value: null, invalid: false };
const bad = { value: null, invalid: true };

function toNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== 'string') return NaN;
  let s = raw.replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

export function parseText(raw) {
  if (isBlank(raw)) return blank;
  return ok(String(raw).trim().replace(/\s+/g, ' '));
}

export function parseEmail(raw) {
  if (isBlank(raw)) return blank;
  const value = String(raw).trim().toLowerCase();
  return EMAIL.test(value) ? ok(value) : { value, invalid: true };
}

/** Rupees in the sheet -> integer paise. */
export function parseMoney(raw) {
  if (isBlank(raw)) return blank;
  const n = toNumber(raw);
  return Number.isFinite(n) ? ok(Math.round(n * 100)) : bad;
}

export function parseNumber(raw) {
  if (isBlank(raw)) return blank;
  const n = toNumber(raw);
  return Number.isFinite(n) ? ok(Math.round(n * 100) / 100) : bad;
}

/** "93.33%", 93.33 or 0.9333 -> 0.9333. Values above 1 are read as percentages. */
export function parsePercent(raw) {
  if (isBlank(raw)) return blank;
  const n = toNumber(typeof raw === 'string' ? raw.replace('%', '') : raw);
  if (!Number.isFinite(n) || n < 0) return bad;
  const fraction = n > 1 ? n / 100 : n;
  return ok(Math.round(fraction * 1e6) / 1e6);
}

function isoFromParts(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const fullYear = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * Accepts 'YYYY-MM-DD' (what the workbook reader emits for date cells),
 * 'DD-MM-YYYY' / 'DD/MM/YY', '15-Jul-2026', or an Excel serial number.
 * Day-first is assumed for numeric dates, as is the norm in India.
 */
export function parseDate(raw) {
  if (isBlank(raw)) return blank;
  if (typeof raw === 'number') {
    if (raw < 1 || raw > 2958465) return bad;
    const ms = EXCEL_EPOCH_UTC + Math.round(raw) * 86_400_000;
    return ok(new Date(ms).toISOString().slice(0, 10));
  }
  const s = String(raw).trim();
  let m = s.match(ISO_DATE);
  if (m) return wrap(isoFromParts(+m[1], +m[2], +m[3]));
  m = s.match(DMY_DATE);
  if (m) return wrap(isoFromParts(fullYear(m[3]), +m[2], +m[1]));
  m = s.match(MONTH_NAME_DATE);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m[2].toLowerCase().slice(0, 3)));
    if (month >= 0) return wrap(isoFromParts(fullYear(m[3]), month + 1, +m[1]));
  }
  return bad;
}
const wrap = (iso) => (iso ? ok(iso) : bad);

export const PARSERS = {
  text: parseText,
  email: parseEmail,
  money: parseMoney,
  number: parseNumber,
  percent: parsePercent,
  date: parseDate,
};

export function monthName(isoDate) {
  if (!isoDate) return '';
  const month = Number(isoDate.slice(5, 7));
  const name = MONTHS[month - 1];
  return name ? name[0].toUpperCase() + name.slice(1) : '';
}

/** 'YYYY-MM' -> { month: 'July', year: '2026' } */
export function periodParts(period) {
  return { month: monthName(`${period}-01`), year: period.slice(0, 4) };
}
