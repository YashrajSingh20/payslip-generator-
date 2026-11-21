import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_USER, previewResponse } from '../app/lib/frontend-preview.js';
import { DEMO_PAYSLIP, DEMO_RUN } from '../app/lib/demo-payslip.js';

test('preview opens every main screen without a database', () => {
  assert.ok(PREVIEW_USER.permissions.includes('users.manage'));
  assert.equal(previewResponse('/api/payroll-runs').items.length, 1);
  assert.deepEqual(previewResponse('/api/employees?limit=100&q=hello'), { items: [], total: 0, nextCursor: null });
  assert.deepEqual(previewResponse('/api/users'), { items: [] });
  assert.equal(previewResponse('/api/roles').items.length, 4);
  assert.equal(previewResponse('/api/settings').emailProvider, null);
});

test('single-person demo reconciles and links run, employee and payslip', () => {
  const { data } = DEMO_PAYSLIP;
  const earnings = ['basicPayable', 'hraPayable', 'monthlyAllowancePayable', 'ltaPayable', 'performancePayable', 'telephonePayable', 'fuelPayable', 'specialBonusPayable'];
  assert.equal(earnings.reduce((sum, key) => sum + data[key], 0), data.grossEarnings);
  assert.equal(data.pfEmployee + data.professionalTax + data.tds + data.advanceDeducted, data.totalDeductions);
  assert.equal(data.grossEarnings - data.totalDeductions, data.netPay);
  assert.equal(DEMO_RUN.netPayTotalPaise, data.netPay);
  assert.equal(previewResponse(`/api/payroll-runs/${DEMO_RUN.id}/payslips`).items[0].id, DEMO_PAYSLIP.id);
  assert.equal(previewResponse(`/api/payslips/${DEMO_PAYSLIP.id}`).fullName, 'Aarav Kapoor');
  assert.equal(previewResponse('/api/employees?q=aarav').total, 1);
  assert.equal(previewResponse('/api/employees?q=missing').total, 0);
});

test('preview rejects writes and unsupported screens instead of contacting a service', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.throws(() => previewResponse('/api/users', method), /UI preview/);
  }
  assert.throws(() => previewResponse('/api/payroll-runs/real-run'), /not connected/);
  assert.deepEqual(previewResponse('/api/auth/logout', 'POST'), { ok: true });
});

test('preview role and identity responses cannot mutate the shared defaults', () => {
  previewResponse('/api/auth/me').user.permissions.length = 0;
  previewResponse('/api/roles').items.length = 0;
  assert.ok(previewResponse('/api/auth/me').user.permissions.length > 0);
  assert.equal(previewResponse('/api/roles').items.length, 4);
});
