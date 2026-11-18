import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { createEmailOutboxWorker } from './email/outbox-worker.js';
import { createMailer } from './email/mailer.js';
import { createLogger } from './logger.js';
import { reauditDraftRuns } from './services/payroll-service.js';
import { createSettingsService } from './services/settings-service.js';
import { createTeamPortalSync, startTeamPortalSyncWorker } from './services/team-portal-sync.js';
import { createObjectStore } from './storage/object-store.js';
import { createPayslipDocuments, startPayslipArchiveWorker } from './storage/payslip-documents.js';

const SHUTDOWN_TIMEOUT_MS = 45_000;

const logger = createLogger({ base: { service: 'payroll-api' } });

let config;
try {
  config = loadConfig();
} catch (error) {
  logger.error('config_invalid', { errors: error.configErrors ?? [error.message] });
  process.exit(1);
}

const database = createDatabase(config, logger);
const mailer = createMailer(config, logger);
const workers = [];
let emailWorker = null;
let archiveWorker = null;

const documents = createPayslipDocuments({
  database, store: createObjectStore(config), prefix: config.storage.prefix, logger: logger.child({ worker: 'payslip-archive' }),
});

const teamPortalSync = createTeamPortalSync({ database, config, logger: logger.child({ worker: 'team-portal-sync' }) });

const app = createApp({
  config,
  database,
  logger,
  mailer,
  teamPortalSync,
  documents,
  onEmailsQueued: () => emailWorker?.nudge(),
  onApproved: () => archiveWorker?.nudge(),
});

const server = app.listen(config.port, () => {
  logger.info('server_listening', {
    port: config.port,
    appEnv: config.appEnv,
    email: mailer?.provider ?? 'disabled',
    devAuthBypass: config.dev.authBypass,
    storage: config.storage.bucket ? `s3://${config.storage.bucket}/${config.storage.prefix}` : 'local',
  });
  archiveWorker = startPayslipArchiveWorker({ documents, intervalMs: config.storage.archiveIntervalMs, logger });
  workers.push(archiveWorker);
  // Audit rules may have changed since drafts were uploaded; approved runs stay frozen.
  reauditDraftRuns({ database, settings: createSettingsService({ database }) })
    .then((count) => logger.info('draft_runs_reaudited', { count }))
    .catch((error) => logger.error('draft_reaudit_failed', { error: error.message }));
  if (config.teamPortal.enabled) {
    workers.push(startTeamPortalSyncWorker({ sync: teamPortalSync, intervalMinutes: config.teamPortal.intervalMinutes, logger }));
  }
  if (mailer && config.email.workerEnabled) {
    emailWorker = createEmailOutboxWorker({
      database,
      mailer,
      documents,
      logger: logger.child({ worker: 'email-outbox' }),
      pollMs: config.email.pollMs,
      batchSize: config.email.batchSize,
    }).start();
    workers.push(emailWorker);
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_started', { signal });
  setTimeout(() => {
    logger.error('shutdown_forced');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  await new Promise((resolve) => server.close(resolve));
  await Promise.allSettled(workers.map((w) => w.close()));
  await database.close().catch(() => {});
  logger.info('shutdown_complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
