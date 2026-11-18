# Deployment

Payroll ships the same way as the Team Portal: work goes to the `test` branch
first, AWS builds and deploys it to the test environment, and once it is checked
it is merged to `main`, which deploys production. Database migrations run
automatically inside that pipeline, before the new code goes live.

```text
feature branch ──PR──▶ test ──push──▶ CodeBuild keystone-payroll-test-api
                                        1. backend tests
                                        2. Docker image tagged with the commit SHA
                                        3. CodeBuild keystone-payroll-test-migrations  ◀── migrations/*.sql
                                        4. push image, update App Runner, GET /healthz
                 test ──PR──▶ main ──push──▶ CodeBuild keystone-payroll-prod-api (same 4 steps, prod database)

Vercel (web app): test branch ▶ test URL, main ▶ production URL. /api/* is forwarded to the App Runner API.
```

A failed test, migration or health check stops the release; the running API is
not touched.

## Branches

| Branch | Deploys to | Who merges |
|---|---|---|
| `feat/...` | nothing | you |
| `test` | test API + test web app, test database | PR from a feature branch |
| `main` | production API + web app, production database | PR from `test` after checking it |

## Migrations

- Files live in `migrations/` as `NNN_short_name.sql` and run in number order,
  each in its own transaction. Applied files are recorded in `schema_migrations`,
  so each file runs once per database.
- **Never edit a file that has been merged to `test`.** Add a new file instead.
- Migrations run **before** the new API starts, while the old API is still
  serving. Each one must work with the code that is currently live: add columns
  with defaults, add tables, backfill; remove or rename things in a later release.
- Pipeline and manual runs share a database lock, so two runs never overlap.
- In AWS the job uses the admin database URL (`database-admin-url`); the API only
  ever gets the runtime URL.

There is one file today, `001_schema.sql`, which creates the whole database:
users and roles, OTP login, employees (with PAN/UAN and the Team Portal link),
settings (with uploaded logos), uploads, payroll runs, payslips (with the edit
history and stored PDF), private S3 files, the email outbox, the Team Portal sync
log, and the seeded roles and permissions.

Nothing has been deployed yet, so earlier files were folded into this one. From
the first deploy on, every change is a **new** file (`002_...sql`, `003_...sql`)
and `001_schema.sql` is never edited again.

Locally:

```bash
pnpm db:status
```

```bash
pnpm db:migrate
```

To see the state of an AWS database without changing it, start the
`keystone-payroll-<env>-migrations` CodeBuild project with no overrides (it
defaults to `MIGRATION_MODE=status`).

## API endpoints

Browsers call these on the web app's own origin (`/api/...`); Vercel forwards
them to the API. All routes except login need the `kp_session` cookie; changes
(POST/PUT/PATCH/DELETE) also need an allowed `Origin` header.

### Payroll API

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/healthz` | none | Liveness (App Runner health check) |
| GET | `/readyz` | none | Database reachable |
| POST | `/api/auth/send-otp` | none | Email a login code |
| POST | `/api/auth/verify-otp` | none | Exchange the code for a session cookie |
| GET | `/api/auth/me` | signed in | Current user and permissions |
| POST | `/api/auth/logout` | none | Clear the session |
| POST | `/api/imports` | payroll.manage or employees.manage | Upload an Excel file (base64) |
| GET | `/api/payroll-runs` | payroll.read | List runs |
| POST | `/api/payroll-runs` | payroll.manage | Create a draft run from an upload |
| GET | `/api/payroll-runs/:id` | payroll.read | Run summary |
| GET | `/api/payroll-runs/:id/payslips` | payroll.read | Payslips in a run |
| GET | `/api/payroll-runs/:id/payslips.zip` | payroll.read | All (or `?ids=`) PDFs as a ZIP |
| POST | `/api/payroll-runs/:id/approve` | payroll.approve | Approve a draft (no blocking issues) |
| DELETE | `/api/payroll-runs/:id` | payroll.manage | Delete a draft |
| POST | `/api/payroll-runs/:id/emails` | payslip.send | Queue payslip emails |
| GET | `/api/payslips/:id` | payroll.read | One payslip with checks and edit history |
| PATCH | `/api/payslips/:id` | payroll.manage | Fix flagged fields on a draft run |
| GET | `/api/payslips/:id/pdf` | payroll.read | Payslip PDF (`?download=1` to download) |
| GET | `/api/employees` | employees.read | Employee directory (`?q=`, `?cursor=`) |
| POST | `/api/employees/import` | employees.manage | Import an employee master sheet |
| PATCH | `/api/employees/:code` | employees.manage | Edit an employee (Team Portal fields locked) |
| GET | `/api/team-portal-sync` | employees.read | Sync status and last run |
| POST | `/api/team-portal-sync` | employees.manage | Sync from the Team Portal now |
| GET | `/api/settings` | payroll.read or settings.manage | Payslip and email settings |
| PUT | `/api/settings` | settings.manage | Update settings |
| POST | `/api/settings/logos/:slot` | settings.manage | Upload a PNG/JPEG logo (`primary` = left, `secondary` = right) |
| GET | `/api/settings/logos/:slot` | payroll.read or settings.manage | The uploaded logo (signed S3 link) |
| DELETE | `/api/settings/logos/:slot` | settings.manage | Back to the bundled logo |
| GET | `/api/users` | users.manage | Payroll users |
| GET | `/api/users/roles` | users.manage | Roles |
| POST | `/api/users` | users.manage | Add a user |
| PATCH | `/api/users/:id` | users.manage | Change a user's roles or status |
| GET | `/api/roles` | roles.manage or users.manage | Roles with their permissions and member counts |
| GET | `/api/roles/permissions` | roles.manage or users.manage | Every permission |
| POST | `/api/roles` | roles.manage | Create a custom role `{ name, description, permissions }` |
| PATCH | `/api/roles/:id` | roles.manage | Rename or change permissions (Super admin's are locked) |
| DELETE | `/api/roles/:id` | roles.manage | Delete a custom role nobody holds |

`GET /api/payslips/:id/pdf` answers an approved payslip with a 302 to a 60-second
signed S3 link (the stored file); drafts are rendered on the fly.

### Team Portal endpoint used by payroll

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/integrations/employees` | `Authorization: Bearer <PAYROLL_SYNC_TOKEN>` | `{ generatedAt, items: [{ id, employeeCode, name, email, isActive, joinedAt, monthlySalaryPaise }] }` |

It returns 401 for a wrong token and 503 while `PAYROLL_SYNC_TOKEN` is unset. It
is read-only and returns no phone, date of birth, blood group or payment data.
Payroll calls it server-to-server every 60 minutes and when someone presses
**Sync now**.

## Environment

### Local (`.env`, copied from `.env.example`)

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://payroll:payroll_local_only@127.0.0.1:5435/keystone_payroll` | Docker Postgres from `compose.yaml` |
| `DATABASE_SSL` | `false` | Local only |
| `JWT_SECRET` | 32+ random chars | Session signing |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | |
| `BACKEND_ORIGIN` | `http://127.0.0.1:8080` | Used by Next to forward `/api/*` |
| `GMAIL_OAUTH_*`, `GMAIL_SENDER_EMAIL` | blank | Blank + `DEV_EMAIL_MOCK=true` writes `.eml` files instead |
| `DEV_AUTH_BYPASS`, `DEV_EMAIL_MOCK` | `true` | Ignored when `NODE_ENV=production` |
| `TEAM_PORTAL_ORIGIN` | `http://127.0.0.1:8090` | Blank turns the sync off |
| `TEAM_PORTAL_SYNC_TOKEN` | 32+ random chars | Same value as the Team Portal's `PAYROLL_SYNC_TOKEN` |
| `TEAM_PORTAL_SYNC_MINUTES` | `60` | |
| `PRIVATE_ASSET_BUCKET` | blank | Blank stores files in `backend/.dev-storage`; set it to test against a real bucket |
| `AWS_REGION` | `ap-south-1` | Only used with a bucket |

### AWS (per environment, `<env>` is `test` or `prod`)

Create these SSM **SecureString** parameters in `ap-south-1` before deploying.
Values never go in Git or in the stack.

| Parameter | Used by | Value |
|---|---|---|
| `/keystone-payroll/<env>/database-url` | API | Runtime role, e.g. `postgres://payroll_app:…@<rds-host>:5432/keystone_payroll` |
| `/keystone-payroll/<env>/database-admin-url` | migration job only | Role that may run DDL on the same database |
| `/keystone-payroll/<env>/jwt-secret` | API | 32+ random chars, different per environment |
| `/keystone-payroll/<env>/gmail-oauth-client-secret` | API | Gmail OAuth |
| `/keystone-payroll/<env>/gmail-oauth-refresh-token` | API | Gmail OAuth |
| `/keystone-payroll/<env>/team-portal-sync-token` | API | 32+ random chars |

And in the Team Portal account/stack, the same token:

| Parameter | Value |
|---|---|
| `/keystone-team-portal/<env>/payroll-sync-token` | identical to `/keystone-payroll/<env>/team-portal-sync-token` |

Plain settings are stack parameters (see `backend/infra/deploy.sh`):
`FRONTEND_ORIGIN`, `VPC_ID`, `SUBNET_IDS`, `DATABASE_SECURITY_GROUP_ID`
(optional), `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_SENDER_EMAIL`, `TEAM_PORTAL_ORIGIN`.

The stack creates the S3 bucket itself and passes `PRIVATE_ASSET_BUCKET` and
`AWS_REGION` to the API; nothing to set by hand.

## Files in S3

The same model as the Team Portal's private files:

- One private, encrypted, versioned bucket per environment, TLS only, no public
  access. The API may read and write only under its own `test/` or `prod/` prefix.
- Every file has a row in `private_objects` (purpose, key, name, type, size,
  SHA-256). The key never leaves the server; pages use the row id.
- Downloads go through a permission check, then a 60-second signed link.
- **Payslip PDFs:** when a run is approved, every payslip is rendered once and
  stored under `<env>/payslip_pdf/<run>/`. Downloads, the ZIP and the email
  attachment all use that stored file, so what was approved is what is sent.
- **Logos:** Settings → Logos uploads PNG/JPEG files (2 MB max, checked by
  content) under `<env>/brand_logo/`. New runs print them; older runs keep theirs.
- Locally, with no bucket, the same code writes to `backend/.dev-storage/`.

## Roles

Team & access → Roles works like the Team Portal: built-in roles (Super admin,
Payroll manager, Approver, Auditor) can't be deleted; custom roles can be created,
renamed, given any mix of permissions and deleted once nobody holds them. Super
admin always has every permission, so no one can lock the team out.

## First user

Sign-in only works for emails already in the database, so create the first
super admin once per environment, after migrations have run:

```bash
pnpm bootstrap-admin -- --email=finance@keystonecommerce.in --name="Finance Admin"
```

```bash
pnpm bootstrap-admin -- --list
```

Against AWS, run it with that environment's admin URL in `DATABASE_ADMIN_URL`
and `DATABASE_SSL_CA_FILE=backend/ap-south-1-rds-ca.pem`, from a machine that
can reach the database. Running it again with the same email only updates the
name and re-activates the account. Everyone else is added from Team & access.

### Vercel (web app)

| Variable | Value |
|---|---|
| `BACKEND_ORIGIN` | The `AppRunnerServiceUrl` stack output for that environment (server-only) |

## First-time setup

1. **Repository.** Push this project to GitHub with `main` and `test` branches.
   CodeBuild uses the same CodeConnections GitHub connection as the Team Portal.
2. **Database.** Create a `keystone_payroll` database on the environment's RDS
   instance, an admin role (owns the schema) and a runtime role (read/write data).
3. **Secrets.** Create the SSM parameters above, and the Team Portal's
   `payroll-sync-token`.
4. **Team Portal.** Merge its `feat/payroll-employee-export` branch through `test`
   then `main`. Its stack update adds `PAYROLL_SYNC_TOKEN` to App Runner, which
   turns `/api/integrations/employees` on.
5. **Payroll test stack:**

   ```bash
   ENVIRONMENT=test DEPLOY_BRANCH=test \
   GITHUB_REPOSITORY_URL=https://github.com/keystone-commerce/<payroll-repo>.git \
   GITHUB_CONNECTION_ARN=arn:aws:codeconnections:ap-south-1:<account>:connection/<id> \
   FRONTEND_ORIGIN=https://<payroll-test>.vercel.app \
   VPC_ID=vpc-... SUBNET_IDS=subnet-a,subnet-b,subnet-c \
   GMAIL_OAUTH_CLIENT_ID=... GMAIL_SENDER_EMAIL=payroll@keystonecommerce.in \
   TEAM_PORTAL_ORIGIN=https://<team-portal-test-api> \
   bash backend/infra/deploy.sh
   ```

   The first run creates ECR and CodeBuild, builds the `test` branch (running all
   migrations on the empty database), then creates App Runner from that image.
6. **Vercel.** Set `BACKEND_ORIGIN` to the printed URL on the test project.
7. **First admin.** Create it as shown in [First user](#first-user).
8. Repeat 5–7 with `ENVIRONMENT=prod DEPLOY_BRANCH=main` and production values.

After that, every merge to `test` or `main` deploys itself, migrations included.

## Before merging to `main`

- [ ] The test deploy succeeded (CodeBuild `keystone-payroll-test-api` is green).
- [ ] New migrations ran on test (`keystone-payroll-test-migrations` log).
- [ ] Upload, review, approve and email a test run on the test site.
- [ ] Team Portal sync shows "Synced … · N linked employees" on test.
