import { HttpError, notFound } from '../http-error.js';
import { detectColumns } from '../payroll/fields.js';
import { parseRow } from '../payroll/normalize.js';
import * as v from '../validate.js';

const toEmployee = (r) => ({
  employeeCode: r.employee_code,
  fullName: r.full_name,
  designation: r.designation,
  joiningDate: r.joining_date,
  exitDate: r.exit_date,
  officialEmail: r.official_email,
  personalEmail: r.personal_email,
  pan: r.pan ?? null,
  uan: r.uan ?? null,
  source: r.source ?? 'payroll',
  isActive: r.is_active ?? true,
  syncedAt: r.synced_at ?? null,
  updatedAt: r.updated_at,
  lastPeriod: r.last_period ?? null,
});

/** Directory rows from a parsed sheet, last occurrence of an Employee ID wins. */
export function employeesFromSheet(sheet) {
  const mapping = detectColumns(sheet.headers);
  if (!mapping.employeeId) return { mapping, employees: [] };
  const byCode = new Map();
  for (const row of sheet.rows) {
    const { data } = parseRow(row.values, mapping);
    if (!data.employeeId) continue;
    byCode.set(data.employeeId, {
      employeeCode: data.employeeId,
      fullName: data.name,
      designation: data.designation,
      joiningDate: data.joiningDate,
      exitDate: data.exitDate,
      officialEmail: data.officialEmail?.includes('@') ? data.officialEmail : null,
      personalEmail: data.personalEmail?.includes('@') ? data.personalEmail : null,
      pan: data.pan,
      uan: data.uan,
    });
  }
  return { mapping, employees: [...byCode.values()] };
}

/**
 * Inserts or updates directory rows. Blank values never erase what is already
 * stored. Returns { inserted, updated }.
 */
export async function upsertEmployees(db, employees) {
  const valid = employees.filter((e) => e.employeeCode);
  if (!valid.length) return { inserted: 0, updated: 0 };
  const { rows } = await db.query(
    `INSERT INTO employees AS e (employee_code, full_name, designation, joining_date, exit_date, official_email, personal_email, pan, uan)
     SELECT x."employeeCode", COALESCE(x."fullName", ''), x.designation, x."joiningDate", x."exitDate", x."officialEmail", x."personalEmail",
            upper(x.pan), x.uan
       FROM jsonb_to_recordset($1::jsonb) AS x(
         "employeeCode" text, "fullName" text, designation text, "joiningDate" date, "exitDate" date,
         "officialEmail" text, "personalEmail" text, pan text, uan text)
     ON CONFLICT (employee_code) DO UPDATE SET
       -- Team Portal owns name, official email and joining date for synced rows.
       full_name      = CASE WHEN e.source = 'team_portal' THEN e.full_name
                             ELSE COALESCE(NULLIF(EXCLUDED.full_name, ''), e.full_name) END,
       designation    = COALESCE(EXCLUDED.designation, e.designation),
       joining_date   = CASE WHEN e.source = 'team_portal' THEN COALESCE(e.joining_date, EXCLUDED.joining_date)
                             ELSE COALESCE(EXCLUDED.joining_date, e.joining_date) END,
       exit_date      = COALESCE(EXCLUDED.exit_date, e.exit_date),
       official_email = CASE WHEN e.source = 'team_portal' THEN COALESCE(e.official_email, EXCLUDED.official_email)
                             ELSE COALESCE(EXCLUDED.official_email, e.official_email) END,
       personal_email = COALESCE(EXCLUDED.personal_email, e.personal_email),
       pan            = COALESCE(EXCLUDED.pan, e.pan),
       uan            = COALESCE(EXCLUDED.uan, e.uan),
       updated_at     = now()
     RETURNING (xmax = 0) AS inserted`,
    [JSON.stringify(valid)],
  );
  const inserted = rows.filter((r) => r.inserted).length;
  return { inserted, updated: rows.length - inserted };
}

export function createEmployeeService({ database, imports }) {
  async function list({ q = '', cursor = null, limit = 100 }) {
    const params = [];
    const where = [];
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      where.push(`(lower(e.employee_code) LIKE $${params.length} OR lower(e.full_name) LIKE $${params.length}
                   OR lower(coalesce(e.official_email, '')) LIKE $${params.length} OR lower(coalesce(e.personal_email, '')) LIKE $${params.length}
                   OR lower(coalesce(e.designation, '')) LIKE $${params.length})`);
    }
    if (cursor) {
      params.push(cursor);
      where.push(`e.employee_code > $${params.length}`);
    }
    params.push(limit + 1);
    const { rows } = await database.query(
      `SELECT e.*, (SELECT max(r.period) FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
                     WHERE p.employee_code = e.employee_code) AS last_period
         FROM employees e
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY e.employee_code
        LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toEmployee);
    const { rows: total } = await database.query('SELECT count(*)::int AS n FROM employees');
    return { items, nextCursor: hasMore ? items.at(-1).employeeCode : null, total: total[0].n };
  }

  async function importFromSheet(actor, { importId, sheetName }) {
    const workbook = await imports.loadImport(actor, importId);
    const sheet = imports.findSheet(workbook, sheetName);
    const { employees } = employeesFromSheet(sheet);
    if (!employees.length) {
      throw new HttpError(422, `No Employee ID column was found in "${sheetName}".`, 'no_employee_column');
    }
    const result = await database.transaction((tx) => upsertEmployees(tx, employees));
    return { ...result, total: employees.length };
  }

  async function update(code, input) {
    const patch = {
      fullName: v.string(input.fullName, 'Full name', { max: 200 }),
      designation: v.string(input.designation, 'Designation', { required: false, max: 200 }),
      officialEmail: v.email(input.officialEmail || null, 'Official email', { required: false }),
      personalEmail: v.email(input.personalEmail || null, 'Personal email', { required: false }),
    };
    const { rows: current } = await database.query('SELECT source, full_name, official_email FROM employees WHERE employee_code = $1', [code]);
    if (!current[0]) throw notFound('Employee not found');
    if (current[0].source === 'team_portal'
      && (patch.fullName !== current[0].full_name || (patch.officialEmail ?? null) !== (current[0].official_email ?? null))) {
      throw new HttpError(409, 'Name and official email are managed in the Team Portal. Change them there.', 'managed_in_team_portal');
    }
    const { rows } = await database.query(
      `UPDATE employees SET full_name = $2, designation = $3, official_email = $4, personal_email = $5, updated_at = now()
        WHERE employee_code = $1 RETURNING *`,
      [code, patch.fullName, patch.designation || null, patch.officialEmail, patch.personalEmail],
    );
    if (!rows[0]) throw notFound('Employee not found');
    return toEmployee(rows[0]);
  }

  return { list, importFromSheet, update };
}
