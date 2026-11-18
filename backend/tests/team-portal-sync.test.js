import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createTeamPortalSync, parseRoster } from '../src/services/team-portal-sync.js';

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://unused', JWT_SECRET: 'x'.repeat(40), ALLOWED_ORIGINS: 'http://localhost:3000' };

describe('parseRoster', () => {
  it('keeps only the fields payroll uses and skips rows it cannot match', () => {
    const { employees, skipped } = parseRoster({
      items: [
        { id: 'u1', employeeCode: ' 10016 ', name: ' Asha  Rao ', email: 'ASHA@Keystone.in', isActive: true, joinedAt: '2026-07-13', monthlySalaryPaise: 3339300, phone: '999' },
        { id: 'u2', employeeCode: '', name: 'No Code' },
        { id: 'u3', employeeCode: '10016', name: 'Dup' },
        { id: 'u4', employeeCode: '10020', name: 'Bad', email: 'not-an-email', joinedAt: '13/07/2026', isActive: false, monthlySalaryPaise: -5 },
      ],
    });
    assert.deepEqual(employees, [
      { teamPortalUserId: 'u1', employeeCode: '10016', fullName: 'Asha Rao', officialEmail: 'asha@keystone.in', joiningDate: '2026-07-13', isActive: true, monthlySalaryPaise: 3339300 },
      { teamPortalUserId: 'u4', employeeCode: '10020', fullName: 'Bad', officialEmail: null, joiningDate: null, isActive: false, monthlySalaryPaise: null },
    ]);
    assert.deepEqual(skipped.map((s) => s.reason), ['No employee code', 'Employee code used twice in Team Portal']);
  });

  it('rejects a malformed response', () => {
    assert.throws(() => parseRoster({ nope: true }), /unexpected response/);
  });
});

describe('Team Portal config', () => {
  it('stays off unless both origin and token are set', () => {
    assert.equal(loadConfig(base).teamPortal.enabled, false);
    assert.equal(loadConfig({ ...base, TEAM_PORTAL_ORIGIN: 'http://localhost:8090' }).teamPortal.enabled, false);
    const on = loadConfig({ ...base, TEAM_PORTAL_ORIGIN: 'http://localhost:8090/', TEAM_PORTAL_SYNC_TOKEN: 't'.repeat(32) });
    assert.equal(on.teamPortal.enabled, true);
    assert.equal(on.teamPortal.origin, 'http://localhost:8090');
  });

  it('rejects a short token', () => {
    assert.throws(() => loadConfig({ ...base, TEAM_PORTAL_ORIGIN: 'http://x.test', TEAM_PORTAL_SYNC_TOKEN: 'short' }), /at least 32/);
  });
});

describe('fetchRoster', () => {
  const config = loadConfig({ ...base, TEAM_PORTAL_ORIGIN: 'https://portal.test', TEAM_PORTAL_SYNC_TOKEN: 't'.repeat(40) });

  it('sends the service token and explains an auth failure', async () => {
    let seen;
    const sync = createTeamPortalSync({
      database: {}, config,
      fetchImpl: async (url, init) => { seen = { url, auth: init.headers.authorization }; return new Response('{}', { status: 401 }); },
    });
    await assert.rejects(sync.fetchRoster(), /rejected the sync token/);
    assert.equal(seen.url, 'https://portal.test/api/integrations/employees');
    assert.equal(seen.auth, `Bearer ${'t'.repeat(40)}`);
  });

  it('reports an unreachable portal plainly', async () => {
    const sync = createTeamPortalSync({ database: {}, config, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(sync.fetchRoster(), /Could not reach the Team Portal/);
  });

  it('refuses to run when not configured', async () => {
    const sync = createTeamPortalSync({ database: {}, config: loadConfig(base) });
    await assert.rejects(sync.run({ trigger: 'manual' }), { code: 'sync_not_configured' });
  });
});
