import { conflict, HttpError } from '../http-error.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCK_KEY = 'team_portal_sync';

/**
 * Validates the Team Portal roster payload. Bad rows are skipped with a reason
 * rather than failing the whole sync; a malformed envelope fails it.
 */
export function parseRoster(body) {
  if (!body || !Array.isArray(body.items)) throw new Error('Team Portal returned an unexpected response.');
  const employees = [];
  const skipped = [];
  const seen = new Set();
  for (const item of body.items) {
    const code = typeof item?.employeeCode === 'string' ? item.employeeCode.trim() : String(item?.employeeCode ?? '').trim();
    const id = item?.id ? String(item.id) : '';
    if (!code || !id) {
      skipped.push({ employeeCode: code || null, name: item?.name ?? null, reason: 'No employee code' });
      continue;
    }
    if (seen.has(code)) {
      skipped.push({ employeeCode: code, name: item.name ?? null, reason: 'Employee code used twice in Team Portal' });
      continue;
    }
    seen.add(code);
    const email = typeof item.email === 'string' ? item.email.trim().toLowerCase() : '';
    const salary = Number(item.monthlySalaryPaise);
    employees.push({
      teamPortalUserId: id,
      employeeCode: code,
      fullName: typeof item.name === 'string' ? item.name.trim().replace(/\s+/g, ' ').slice(0, 200) : '',
      officialEmail: EMAIL.test(email) ? email : null,
      joiningDate: typeof item.joinedAt === 'string' && ISO_DATE.test(item.joinedAt) ? item.joinedAt : null,
      isActive: item.isActive !== false,
      monthlySalaryPaise: item.monthlySalaryPaise !== null && Number.isSafeInteger(salary) && salary >= 0 ? salary : null,
    });
  }
  return { employees, skipped };
}

/**
 * Pulls the employee roster from the Team Portal and upserts it into the
 * payroll employee directory, matching on employee_code.
 *
 * The Team Portal is the authority for name, official email, joining date and
 * active status. Nothing is ever deleted: people missing from the roster are
 * marked inactive. Designation, personal email, PAN and UAN stay payroll-owned.
 */
export function createTeamPortalSync({ database, config, logger, fetchImpl = globalThis.fetch }) {
  const settings = config.teamPortal;

  async function fetchRoster() {
    let response;
    try {
      response = await fetchImpl(`${settings.origin}/api/integrations/employees`, {
        headers: { authorization: `Bearer ${settings.token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(settings.timeoutMs),
      });
    } catch (error) {
      throw new Error(error.name === 'TimeoutError' ? 'Team Portal did not respond in time.' : 'Could not reach the Team Portal.');
    }
    if (response.status === 401) throw new Error('Team Portal rejected the sync token. Check TEAM_PORTAL_SYNC_TOKEN on both sides.');
    if (response.status === 503) throw new Error('The payroll integration is switched off in the Team Portal (PAYROLL_SYNC_TOKEN not set).');
    if (!response.ok) throw new Error(`Team Portal returned an error (${response.status}).`);
    return parseRoster(await response.json().catch(() => null));
  }

  async function apply(tx, employees) {
    const payload = JSON.stringify(employees);
    const recordset = `jsonb_to_recordset($1::jsonb) AS x(
      "teamPortalUserId" text, "employeeCode" text, "fullName" text, "officialEmail" text,
      "joiningDate" date, "isActive" boolean, "monthlySalaryPaise" bigint)`;

    // An employee whose code changed in the Team Portal: release the old link first.
    await tx.query(
      `UPDATE employees e SET team_portal_user_id = NULL
         FROM ${recordset}
        WHERE e.team_portal_user_id = x."teamPortalUserId" AND e.employee_code <> x."employeeCode"`,
      [payload],
    );

    const { rows } = await tx.query(
      `INSERT INTO employees AS e (employee_code, full_name, official_email, joining_date, is_active, source,
                                   team_portal_user_id, portal_monthly_salary_paise, synced_at)
       SELECT x."employeeCode", x."fullName", x."officialEmail", x."joiningDate", x."isActive", 'team_portal',
              x."teamPortalUserId", x."monthlySalaryPaise", now()
         FROM ${recordset}
       ON CONFLICT (employee_code) DO UPDATE SET
         full_name      = COALESCE(NULLIF(EXCLUDED.full_name, ''), e.full_name),
         official_email = COALESCE(EXCLUDED.official_email, e.official_email),
         joining_date   = COALESCE(EXCLUDED.joining_date, e.joining_date),
         is_active      = EXCLUDED.is_active,
         source         = 'team_portal',
         team_portal_user_id = EXCLUDED.team_portal_user_id,
         portal_monthly_salary_paise = EXCLUDED.portal_monthly_salary_paise,
         synced_at      = now(),
         updated_at     = CASE
           WHEN (e.full_name, e.official_email, e.joining_date, e.is_active, e.source, e.team_portal_user_id, e.portal_monthly_salary_paise)
                IS DISTINCT FROM
                (COALESCE(NULLIF(EXCLUDED.full_name, ''), e.full_name), COALESCE(EXCLUDED.official_email, e.official_email),
                 COALESCE(EXCLUDED.joining_date, e.joining_date), EXCLUDED.is_active, 'team_portal',
                 EXCLUDED.team_portal_user_id, EXCLUDED.portal_monthly_salary_paise)
           THEN now() ELSE e.updated_at END
       RETURNING (xmax = 0) AS inserted, (e.updated_at = now()) AS touched`,
      [payload],
    );

    // People who disappeared from the Team Portal roster stay on record, inactive.
    const { rowCount: deactivated } = await tx.query(
      `UPDATE employees SET is_active = false, updated_at = now(), synced_at = now()
        WHERE source = 'team_portal' AND is_active
          AND NOT (employee_code = ANY($1::text[]))`,
      [employees.map((e) => e.employeeCode)],
    );

    const created = rows.filter((r) => r.inserted).length;
    const updated = rows.filter((r) => !r.inserted && r.touched).length;
    return { created, updated, unchanged: rows.length - created - updated, deactivated };
  }

  async function run({ trigger, actorId = null }) {
    if (!settings.enabled) {
      throw new HttpError(503, 'Team Portal sync is not configured. Set TEAM_PORTAL_ORIGIN and TEAM_PORTAL_SYNC_TOKEN.', 'sync_not_configured');
    }
    const { rows: log } = await database.query(
      'INSERT INTO team_portal_syncs (trigger, actor_id) VALUES ($1, $2) RETURNING id',
      [trigger, actorId],
    );
    const logId = log[0].id;
    try {
      const { employees, skipped } = await fetchRoster();
      if (!employees.length) throw new Error('Team Portal returned no employees, so nothing was changed.');

      const counts = await database.transaction(async (tx) => {
        const { rows } = await tx.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [LOCK_KEY]);
        if (!rows[0].locked) throw conflict('A Team Portal sync is already running.', 'sync_in_progress');
        return apply(tx, employees);
      });
      const result = { total: employees.length, ...counts, skipped: skipped.length, skippedRows: skipped.slice(0, 50) };
      await database.query(
        `UPDATE team_portal_syncs SET status = 'succeeded', finished_at = now(), counts = $2 WHERE id = $1`,
        [logId, JSON.stringify(result)],
      );
      logger?.info('team_portal_sync_succeeded', { trigger, ...counts, skipped: skipped.length });
      return result;
    } catch (error) {
      await database.query(
        `UPDATE team_portal_syncs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
        [logId, error.message.slice(0, 500)],
      ).catch(() => {});
      logger?.error('team_portal_sync_failed', { trigger, error: error.message });
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, error.message, 'sync_failed');
    }
  }

  async function status() {
    const { rows: last } = await database.query(
      `SELECT trigger, started_at, finished_at, status, counts, error
         FROM team_portal_syncs WHERE status <> 'running' ORDER BY started_at DESC LIMIT 1`,
    );
    const { rows: lastOk } = await database.query(
      `SELECT finished_at FROM team_portal_syncs WHERE status = 'succeeded' ORDER BY started_at DESC LIMIT 1`,
    );
    const { rows: n } = await database.query(
      `SELECT count(*) FILTER (WHERE source = 'team_portal')::int AS linked,
              count(*) FILTER (WHERE source = 'payroll')::int AS payroll_only
         FROM employees`,
    );
    const l = last[0];
    return {
      configured: settings.enabled,
      intervalMinutes: settings.intervalMinutes,
      linkedEmployees: n[0].linked,
      payrollOnlyEmployees: n[0].payroll_only,
      lastSuccessAt: lastOk[0]?.finished_at ?? null,
      lastRun: l ? { trigger: l.trigger, startedAt: l.started_at, finishedAt: l.finished_at, status: l.status, counts: l.counts, error: l.error } : null,
    };
  }

  return { run, status, fetchRoster };
}

/** Runs the sync on a timer. Each run is recorded; failures never crash the API. */
export function startTeamPortalSyncWorker({ sync, intervalMinutes, logger, firstRunDelayMs = 15_000 }) {
  let timer = null;
  let running = null;
  const tick = async () => {
    if (running) return;
    running = sync.run({ trigger: 'scheduled' }).catch(() => {}).finally(() => { running = null; });
    await running;
  };
  const first = setTimeout(tick, firstRunDelayMs);
  timer = setInterval(tick, intervalMinutes * 60_000);
  first.unref?.();
  timer.unref?.();
  logger?.info('team_portal_sync_worker_started', { intervalMinutes });
  return {
    async close() {
      clearTimeout(first);
      clearInterval(timer);
      await running;
    },
  };
}
