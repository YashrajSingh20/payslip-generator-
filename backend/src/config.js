// Every environment variable is parsed and validated here, and nowhere else.
import { fileURLToPath } from 'node:url';

const MIN_JWT_SECRET_LENGTH = 32;

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const errors = [];

  const str = (key, fallback = '') => (env[key] ?? fallback).toString().trim();
  const bool = (key, fallback = false) => {
    const raw = str(key);
    if (!raw) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    errors.push(`${key} must be "true" or "false"`);
    return fallback;
  };
  const positiveInt = (key, fallback) => {
    const raw = str(key);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      errors.push(`${key} must be a positive integer`);
      return fallback;
    }
    return n;
  };
  // Dev bypasses are impossible in production, whatever the env says.
  const devFlag = (key) => !production && bool(key, false);

  const allowedOrigins = str('ALLOWED_ORIGINS', production ? '' : 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin) errors.push(`ALLOWED_ORIGINS entry must be a bare origin: ${origin}`);
      if (production && url.protocol !== 'https:') errors.push(`ALLOWED_ORIGINS must be https in production: ${origin}`);
    } catch {
      errors.push(`ALLOWED_ORIGINS entry is not a URL: ${origin}`);
    }
  }
  if (!allowedOrigins.length) errors.push('ALLOWED_ORIGINS is required');

  const databaseUrl = str('DATABASE_URL');
  if (!databaseUrl) errors.push('DATABASE_URL is required');
  const databaseSsl = bool('DATABASE_SSL', true);
  if (production && !databaseSsl) errors.push('DATABASE_SSL=false is not allowed in production');

  const jwtSecret = str('JWT_SECRET');
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }

  const gmail = {
    clientId: str('GMAIL_OAUTH_CLIENT_ID'),
    clientSecret: str('GMAIL_OAUTH_CLIENT_SECRET'),
    refreshToken: str('GMAIL_OAUTH_REFRESH_TOKEN'),
    senderEmail: str('GMAIL_SENDER_EMAIL').toLowerCase(),
    senderName: str('GMAIL_SENDER_NAME', 'Keystone Commerce Payroll'),
  };
  // A half-configured integration stays off.
  gmail.enabled = Boolean(gmail.clientId && gmail.clientSecret && gmail.refreshToken && gmail.senderEmail);

  // Team Portal roster sync. Off unless both the origin and the token are set.
  const teamPortalOrigin = str('TEAM_PORTAL_ORIGIN').replace(/\/$/, '');
  const teamPortalToken = str('TEAM_PORTAL_SYNC_TOKEN');
  if (teamPortalOrigin) {
    try {
      const url = new URL(teamPortalOrigin);
      if (production && url.protocol !== 'https:') errors.push('TEAM_PORTAL_ORIGIN must use https in production');
    } catch {
      errors.push('TEAM_PORTAL_ORIGIN is not a valid URL');
    }
  }
  if (teamPortalToken && teamPortalToken.length < 32) errors.push('TEAM_PORTAL_SYNC_TOKEN must be at least 32 characters');
  const teamPortal = {
    enabled: Boolean(teamPortalOrigin && teamPortalToken),
    origin: teamPortalOrigin,
    token: teamPortalToken,
    intervalMinutes: positiveInt('TEAM_PORTAL_SYNC_MINUTES', 60),
    timeoutMs: positiveInt('TEAM_PORTAL_TIMEOUT_MS', 15000),
  };

  // Private file storage. S3 when PRIVATE_ASSET_BUCKET is set (always in AWS);
  // a local folder in development so nothing else is needed to run the app.
  const bucket = str('PRIVATE_ASSET_BUCKET');
  if (production && !bucket) errors.push('PRIVATE_ASSET_BUCKET is required in production');
  const storage = {
    bucket,
    region: str('AWS_REGION', 'ap-south-1'),
    prefix: str('APP_ENV', production ? 'production' : 'local'),
    localRoot: str('LOCAL_STORAGE_DIR', fileURLToPath(new URL('../.dev-storage/', import.meta.url))),
    archiveIntervalMs: positiveInt('PAYSLIP_ARCHIVE_POLL_MS', 30000),
  };

  const config = {
    nodeEnv,
    production,
    appEnv: str('APP_ENV', production ? 'production' : 'local'),
    port: positiveInt('PORT', 8080),
    allowedOrigins,
    portalUrl: str('PORTAL_URL', allowedOrigins[0] ?? ''),
    portalTimezone: str('PORTAL_TIMEZONE', 'Asia/Kolkata'),
    database: {
      url: databaseUrl,
      ssl: databaseSsl,
      sslCaFile: str('DATABASE_SSL_CA_FILE'),
      poolMax: positiveInt('DATABASE_POOL_MAX', 10),
    },
    auth: {
      jwtSecret,
      sessionTtlDays: positiveInt('SESSION_TTL_DAYS', 7),
      otpTtlMinutes: positiveInt('OTP_TTL_MINUTES', 10),
      otpMaxAttempts: 5,
      otpMaxRequestsPer15Min: 5,
    },
    gmail,
    teamPortal,
    email: {
      workerEnabled: bool('EMAIL_WORKER_ENABLED', true),
      pollMs: positiveInt('EMAIL_OUTBOX_POLL_MS', 5000),
      batchSize: positiveInt('EMAIL_WORKER_BATCH_SIZE', 10),
    },
    storage,
    uploads: {
      maxWorkbookBytes: positiveInt('MAX_WORKBOOK_BYTES', 4 * 1024 * 1024),
      maxRowsPerSheet: positiveInt('MAX_ROWS_PER_SHEET', 5000),
    },
    dev: {
      authBypass: devFlag('DEV_AUTH_BYPASS'),
      emailMock: devFlag('DEV_EMAIL_MOCK'),
    },
  };

  if (errors.length) {
    const error = new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
    error.configErrors = errors;
    throw error;
  }
  return Object.freeze(config);
}
