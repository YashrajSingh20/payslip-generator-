import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_USER, previewResponse } from '../app/lib/frontend-preview.js';

test('preview opens every main screen without a database', () => {
  assert.ok(PREVIEW_USER.permissions.includes('users.manage'));
  assert.deepEqual(previewResponse('/api/payroll-runs'), { items: [] });
  assert.deepEqual(previewResponse('/api/employees?limit=100&q=hello'), { items: [], total: 0, nextCursor: null });
  assert.deepEqual(previewResponse('/api/users'), { items: [] });
  assert.equal(previewResponse('/api/roles').items.length, 4);
  assert.equal(previewResponse('/api/settings').emailProvider, null);
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
