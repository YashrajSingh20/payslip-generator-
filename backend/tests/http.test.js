import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signSession } from '../src/auth/jwt.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';

const ORIGIN = 'http://localhost:3000';
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused',
  JWT_SECRET: 'x'.repeat(40),
  ALLOWED_ORIGINS: ORIGIN,
});

const USER_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

/** A fake database that answers the guard's user lookup. */
function fakeDatabase({ permissions = [], active = true, sessionVersion = 1 } = {}) {
  return {
    async query(text) {
      if (text.includes('FROM users u') && text.includes('user_effective_permissions')) {
        return { rows: active ? [{ id: USER_ID, email: 'a@x.in', name: 'A', session_version: sessionVersion, permissions }] : [] };
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    },
    transaction: (fn) => fn({ query: async () => ({ rows: [] }) }),
    ready: async () => true,
  };
}

const cookieFor = async (sv = 1) => `kp_session=${await signSession({ userId: USER_ID, sessionVersion: sv }, config.auth.jwtSecret, 3600)}`;

function appWith({ permissions, payroll = {}, ...dbOptions } = {}) {
  return createApp({
    config,
    database: fakeDatabase({ permissions, ...dbOptions }),
    logger: silentLogger,
    payroll: {
      listRuns: async () => [],
      approve: async () => ({ id: RUN_ID }),
      getRun: async () => ({ id: RUN_ID, status: 'approved' }),
      ...payroll,
    },
  });
}

describe('HTTP basics', () => {
  it('serves /healthz without the database and sets security headers', async () => {
    const res = await request(appWith()).get('/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.ok(res.headers['x-request-id']);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(appWith()).get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'not_found');
    assert.ok(res.body.requestId);
    assert.equal(res.headers['cache-control'], 'private, no-store');
  });
});

describe('access control', () => {
  it('rejects requests without a session', async () => {
    const res = await request(appWith()).get('/api/payroll-runs');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'unauthenticated');
  });

  it('rejects a tampered or stale session', async () => {
    const app = appWith({ permissions: ['payroll.read'], sessionVersion: 2 });
    const stale = await request(app).get('/api/payroll-runs').set('Cookie', await cookieFor(1));
    assert.equal(stale.status, 401);
    const garbage = await request(app).get('/api/payroll-runs').set('Cookie', 'kp_session=abc.def.ghi');
    assert.equal(garbage.status, 401);
  });

  it('rejects deactivated users', async () => {
    const res = await request(appWith({ permissions: ['payroll.read'], active: false })).get('/api/payroll-runs').set('Cookie', await cookieFor());
    assert.equal(res.status, 401);
  });

  it('returns 403 when the permission is missing', async () => {
    const res = await request(appWith({ permissions: ['payroll.read'] }))
      .post(`/api/payroll-runs/${RUN_ID}/approve`)
      .set('Origin', ORIGIN)
      .set('Cookie', await cookieFor());
    assert.equal(res.status, 403);
  });

  it('allows the action with the permission', async () => {
    let approvedBy = null;
    const app = appWith({
      permissions: ['payroll.read', 'payroll.approve'],
      payroll: { approve: async (actor) => { approvedBy = actor.id; } },
    });
    const res = await request(app).post(`/api/payroll-runs/${RUN_ID}/approve`).set('Origin', ORIGIN).set('Cookie', await cookieFor());
    assert.equal(res.status, 200);
    assert.equal(approvedBy, USER_ID);
  });

  it('blocks state-changing requests from other origins (CSRF)', async () => {
    const app = appWith({ permissions: ['payroll.approve'] });
    const cookie = await cookieFor();
    const missing = await request(app).post(`/api/payroll-runs/${RUN_ID}/approve`).set('Cookie', cookie);
    assert.equal(missing.status, 403);
    assert.equal(missing.body.code, 'origin_not_allowed');
    const evil = await request(app).post(`/api/payroll-runs/${RUN_ID}/approve`).set('Origin', 'https://evil.example').set('Cookie', cookie);
    assert.equal(evil.status, 403);
  });

  it('treats malformed ids as not found', async () => {
    const res = await request(appWith({ permissions: ['payroll.read'] })).get('/api/payroll-runs/not-a-uuid').set('Cookie', await cookieFor());
    assert.equal(res.status, 404);
  });
});

describe('config', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'y'.repeat(40), ALLOWED_ORIGINS: 'https://payroll.example.com' };

  it('ignores dev bypasses in production', () => {
    const prod = loadConfig({ ...base, NODE_ENV: 'production', PRIVATE_ASSET_BUCKET: 'b', DEV_AUTH_BYPASS: 'true', DEV_EMAIL_MOCK: 'true' });
    assert.equal(prod.dev.authBypass, false);
    assert.equal(prod.dev.emailMock, false);
  });

  it('needs an S3 bucket in production and uses a local folder otherwise', () => {
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), /PRIVATE_ASSET_BUCKET/);
    const dev = loadConfig(base);
    assert.equal(dev.storage.bucket, '');
    assert.match(dev.storage.localRoot, /\.dev-storage/);
  });

  it('refuses weak secrets, plain-text DB in production and http origins in production', () => {
    assert.throws(() => loadConfig({ ...base, JWT_SECRET: 'short' }), /JWT_SECRET/);
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', DATABASE_SSL: 'false' }), /DATABASE_SSL/);
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://x.com' }), /https/);
  });

  it('keeps Gmail off unless every credential is present', () => {
    assert.equal(loadConfig({ ...base, GMAIL_OAUTH_CLIENT_ID: 'id', GMAIL_SENDER_EMAIL: 'a@b.in' }).gmail.enabled, false);
    assert.equal(loadConfig({
      ...base, GMAIL_OAUTH_CLIENT_ID: 'id', GMAIL_OAUTH_CLIENT_SECRET: 's', GMAIL_OAUTH_REFRESH_TOKEN: 'r', GMAIL_SENDER_EMAIL: 'a@b.in',
    }).gmail.enabled, true);
  });
});
