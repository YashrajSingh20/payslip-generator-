import { badRequest, notFound } from './http-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

export function string(value, field, { required = true, max = 500, min = required ? 1 : 0 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} is required`, 'validation_failed');
    return null;
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be text`, 'validation_failed');
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`${field} is required`, 'validation_failed');
  if (trimmed.length > max) throw badRequest(`${field} must be at most ${max} characters`, 'validation_failed');
  return trimmed;
}

export function email(value, field, { required = true } = {}) {
  const s = string(value, field, { required, max: 254, min: required ? 1 : 0 });
  if (!s) return null;
  const lower = s.toLowerCase();
  if (!EMAIL.test(lower)) throw badRequest(`${field} is not a valid email address`, 'validation_failed');
  return lower;
}

export function boolean(value, field, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false`, 'validation_failed');
  return value;
}

export function oneOf(value, field, options) {
  if (!options.includes(value)) throw badRequest(`${field} must be one of: ${options.join(', ')}`, 'validation_failed');
  return value;
}

/** Path ids: a malformed id is simply "not found". */
export function uuidParam(value, what = 'Record') {
  if (typeof value !== 'string' || !UUID.test(value)) throw notFound(`${what} not found`);
  return value.toLowerCase();
}

export function uuidList(value, field, { max = 5000 } = {}) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > max || !value.every((v) => typeof v === 'string' && UUID.test(v))) {
    throw badRequest(`${field} must be a list of ids`, 'validation_failed');
  }
  return [...new Set(value.map((v) => v.toLowerCase()))];
}

export function period(value) {
  const s = string(value, 'period', { max: 7 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw badRequest('period must look like 2026-07', 'validation_failed');
  return s;
}

/** Cursor pagination: ?limit=&cursor= */
export function pageLimit(value, { fallback = 50, max = 200 } = {}) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw badRequest('limit must be a positive integer', 'validation_failed');
  return Math.min(n, max);
}
