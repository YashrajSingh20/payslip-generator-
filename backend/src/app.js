import express from 'express';
import helmet from 'helmet';
import { HttpError } from './http-error.js';
import { createLogger } from './logger.js';
import { createOriginGuard } from './middleware/origin-guard.js';
import { createRequestContext } from './middleware/request-context.js';
import { createAccessGuard } from './rbac/guard.js';
import { createAuthRouter } from './routes/auth.js';
import { createEmployeesRouter } from './routes/employees.js';
import { createImportsRouter } from './routes/imports.js';
import { createPayrollRunsRouter } from './routes/payroll-runs.js';
import { createPayslipsRouter } from './routes/payslips.js';
import { createRolesRouter } from './routes/roles.js';
import { createSettingsRouter } from './routes/settings.js';
import { createTeamPortalSyncRouter } from './routes/team-portal-sync.js';
import { createUsersRouter } from './routes/users.js';
import { createAuthService } from './services/auth-service.js';
import { createEmployeeService } from './services/employee-service.js';
import { createImportService } from './services/import-service.js';
import { createPayrollService } from './services/payroll-service.js';
import { createRoleService } from './services/role-service.js';
import { createSettingsService } from './services/settings-service.js';
import { createTeamPortalSync } from './services/team-portal-sync.js';
import { createObjectStore } from './storage/object-store.js';
import { createPayslipDocuments } from './storage/payslip-documents.js';
import { createUserService } from './services/user-service.js';

/**
 * Builds the Express app. Every collaborator can be overridden, which is how the
 * HTTP tests inject fakes.
 */
export function createApp({
  config,
  database,
  logger = createLogger(),
  mailer = null,
  onEmailsQueued = () => {},
  onApproved = () => {},
  guard = createAccessGuard({ database, config }),
  settings = createSettingsService({ database }),
  imports = createImportService({ database, config }),
  auth = createAuthService({ database, config, mailer, logger }),
  documents = createPayslipDocuments({ database, store: createObjectStore(config), prefix: config.storage.prefix, logger }),
  payroll = createPayrollService({ database, imports, settings, mailer, documents, onEmailsQueued, onApproved }),
  employees = createEmployeeService({ database, imports }),
  users = createUserService({ database }),
  roles = createRoleService({ database }),
  teamPortalSync = createTeamPortalSync({ database, config, logger }),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(createRequestContext(logger));
  app.use(express.json({ limit: '6mb' }));
  app.use(createOriginGuard(config.allowedOrigins));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', async (_req, res) => {
    try {
      await database.ready();
      res.json({ ok: true });
    } catch (error) {
      logger.error('readiness_failed', { error });
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api/auth', createAuthRouter({ auth, guard, config }));
  app.use('/api/imports', createImportsRouter({ guard, imports, config }));
  app.use('/api/payroll-runs', createPayrollRunsRouter({ guard, payroll }));
  app.use('/api/payslips', createPayslipsRouter({ guard, payroll }));
  app.use('/api/employees', createEmployeesRouter({ guard, employees }));
  app.use('/api/team-portal-sync', createTeamPortalSyncRouter({ guard, sync: teamPortalSync }));
  app.use('/api/settings', createSettingsRouter({ guard, settings, mailer, documents, config }));
  app.use('/api/users', createUsersRouter({ guard, users }));
  app.use('/api/roles', createRolesRouter({ guard, roles }));

  app.use((_req, _res, next) => next(new HttpError(404, 'Not found', 'not_found')));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, _next) => {
    const requestId = req.id;
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, code: error.code, requestId });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'The upload is too large.', code: 'payload_too_large', requestId });
    }
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'The request body is not valid JSON.', code: 'invalid_json', requestId });
    }
    (req.log ?? logger).error('unhandled_error', { error, path: req.originalUrl });
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal_error', requestId });
  });

  return app;
}
