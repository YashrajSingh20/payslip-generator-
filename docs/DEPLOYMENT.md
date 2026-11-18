# Deploying Keystone Payroll on AWS

This is the runbook for putting Keystone Payroll into production and running it
afterwards. It follows the same pattern as the Keystone Team Portal API: AWS
CodeBuild builds every push to `main`, runs the database migrations, then
deploys the API to App Runner. The web app is on Vercel.

Payroll has **one environment (production)**, deployed from `main`.

```text
feature branch ─PR─▶ main ─push─▶ CodeBuild keystone-payroll-prod-api
                                    1. backend tests
                                    2. Docker image (tag = commit SHA) ─▶ ECR
                                    3. CodeBuild keystone-payroll-prod-migrations ─▶ RDS keystone_payroll
                                    4. App Runner keystone-payroll-prod-api, then GET /healthz

Browser ─▶ Vercel (payroll web app) ─/api/*─▶ App Runner API ─▶ RDS, S3 (PDFs, logos)
                                                             ├▶ Gmail API (sign-in codes, payslips)
                                                             └▶ Team Portal API (employee sync)
```

A failed test, migration or health check stops the release and the running API
is left as it was.

---

## What you need before starting

| Item | Notes |
|---|---|
| AWS CLI v2 signed in to the Keystone account, region `ap-south-1` | Permission to create IAM roles, CodeBuild, ECR, App Runner, S3, SSM and EC2 security group rules (CloudFormation `CAPABILITY_NAMED_IAM`) |
| `bash`, `openssl`, `jq`, `curl` | For the scripts (Git Bash, macOS or Linux) |
| An **AVAILABLE** AWS CodeConnections GitHub connection that can read this repo | The Team Portal's connection works once it has access to this repository |
| VPC + at least two private subnets with NAT | Same VPC as the database; NAT is needed for Gmail and the Team Portal |
| A PostgreSQL 17 instance (RDS) | Can be the Team Portal's production RDS; payroll gets its **own database** on it |
| Gmail OAuth client + refresh token | For the sender mailbox, scope `https://www.googleapis.com/auth/gmail.send` |
| A Vercel project | For the web app (root of this repo) |
| The Team Portal production API URL | For the employee sync. The Team Portal must have merged its payroll PR (see its `docs/PAYROLL_INTEGRATION.md`) |

---

## Step 1: Create the database

Connect to the RDS instance as its master user and run this, replacing both
passwords. `payroll_admin` owns the schema and is used only by the migration
job; `payroll_app` is what the running API uses and can only read and write data.

```sql
CREATE ROLE payroll_admin LOGIN PASSWORD '<admin-password>';
CREATE ROLE payroll_app   LOGIN PASSWORD '<app-password>';
CREATE DATABASE keystone_payroll OWNER payroll_admin;

\c keystone_payroll
ALTER SCHEMA public OWNER TO payroll_admin;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO payroll_app;
-- Tables and sequences the migrations create later are granted automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE payroll_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO payroll_app;
ALTER DEFAULT PRIVILEGES FOR ROLE payroll_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO payroll_app;
```

The two connection strings for step 2 are then:

```text
postgres://payroll_app:<app-password>@<rds-endpoint>:5432/keystone_payroll
postgres://payroll_admin:<admin-password>@<rds-endpoint>:5432/keystone_payroll
```

Percent-encode special characters in passwords (for example `@` → `%40`).
TLS is required and verified with the AWS RDS CA bundle that ships in the repo
(`backend/ap-south-1-rds-ca.pem`); no `sslmode` parameter is needed.

---

## Step 2: Fill in the deployment settings

```bash
cp backend/infra/production.env.example backend/infra/production.env
```

Fill in every value; the file explains where each comes from. It is
git-ignored and is read by the two scripts below. The running API never reads it.

| Setting | What it is |
|---|---|
| `GITHUB_REPOSITORY_URL`, `GITHUB_CONNECTION_ARN` | This repo and the CodeConnections connection |
| `VPC_ID`, `SUBNET_IDS` | Private subnets with NAT, same VPC as RDS |
| `DATABASE_SECURITY_GROUP_ID` | RDS security group; the stack adds one inbound 5432 rule from payroll |
| `FRONTEND_ORIGIN` | Public payroll URL on Vercel, e.g. `https://payroll.keystonecommerce.in` |
| `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_SENDER_EMAIL`, `GMAIL_SENDER_NAME` | Sending mailbox |
| `TEAM_PORTAL_ORIGIN` | Team Portal production API URL (blank turns the sync off) |
| `DATABASE_URL`, `DATABASE_ADMIN_URL` | From step 1 (secret) |
| `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` | Gmail (secret) |
| `JWT_SECRET`, `TEAM_PORTAL_SYNC_TOKEN` | Leave blank to generate (secret) |

---

## Step 3: Store the secrets

```bash
bash backend/infra/create-secrets.sh
```

This writes SSM SecureString parameters and never prints a value:

| Parameter | Used by |
|---|---|
| `/keystone-payroll/prod/database-url` | API |
| `/keystone-payroll/prod/database-admin-url` | Migration job only |
| `/keystone-payroll/prod/jwt-secret` | API (session signing) |
| `/keystone-payroll/prod/gmail-oauth-client-secret` | API |
| `/keystone-payroll/prod/gmail-oauth-refresh-token` | API |
| `/keystone-payroll/prod/team-portal-sync-token` | API |
| `/keystone-team-portal/prod/payroll-sync-token` | Team Portal API (same value) |

Re-running it is safe: existing parameters are kept unless you pass
`FORCE=true`. The two sync tokens are always made identical, reusing the Team
Portal's if it already exists. Once it has run you can delete the secret lines
from `production.env`.

---

## Step 4: Deploy the stack

```bash
bash backend/infra/deploy.sh
```

The first run takes about 15 minutes and has two phases:

1. Creates the S3 bucket, ECR repository, IAM roles, network and both CodeBuild
   projects.
2. Builds `main`: tests, Docker image, **all migrations on the empty
   database**, image push. Then creates App Runner from that image and checks
   `/healthz`.

It ends by printing the API URL. From then on **every push to `main` deploys
itself**. `deploy.sh` is only needed again when `backend/infra/template.yml`
changes; it keeps whatever image is live.

What the stack (`keystone-payroll-prod-api`) creates:

| Resource | Name |
|---|---|
| S3 bucket (private, encrypted, versioned, TLS only) | stack output `PrivateAssetBucketName` |
| ECR repository (immutable tags, scan on push, last 30 kept) | `keystone-payroll/prod-api` |
| CodeBuild build + deploy (webhook on `main`) | `keystone-payroll-prod-api` |
| CodeBuild migrations (inside the VPC) | `keystone-payroll-prod-migrations` |
| App Runner service (0.25 vCPU / 0.5 GB, 1 to 2 instances) | `keystone-payroll-prod-api` |
| Security group for the API and migration job | `keystone-payroll-prod-apprunner` |
| CloudWatch build logs (90 days) | `/aws/codebuild/keystone-payroll-prod-api` |

Environment variables App Runner gets (set by the stack, nothing to do by hand):
`NODE_ENV=production`, `APP_ENV=prod`, `DATABASE_POOL_MAX=5`,
`DATABASE_SSL_CA_FILE`, `ALLOWED_ORIGINS` and `PORTAL_URL` (= `FRONTEND_ORIGIN`),
`PORTAL_TIMEZONE=Asia/Kolkata`, the Gmail client id and sender,
`EMAIL_WORKER_ENABLED=true`, `TEAM_PORTAL_ORIGIN`, `TEAM_PORTAL_SYNC_MINUTES=60`,
`PRIVATE_ASSET_BUCKET`, `AWS_REGION`, and the SSM secrets from step 3.

---

## Step 5: Web app on Vercel

1. Import this repository into Vercel (framework Next.js, root directory = repo
   root, production branch `main`).
2. Set one environment variable for Production:

   | Variable | Value |
   |---|---|
   | `BACKEND_ORIGIN` | The App Runner URL printed by `deploy.sh` (`https://….ap-south-1.awsapprunner.com`) |

3. Add the domain you used for `FRONTEND_ORIGIN`. If you use a different domain
   later, update `FRONTEND_ORIGIN` and re-run `deploy.sh`, or every change
   request is refused by the API's origin check.

The browser only ever calls the Vercel domain; Vercel forwards `/api/*` to App
Runner server-side, so the session cookie stays first-party.

---

## Step 6: Create the first admin

Sign-in only works for emails that already exist. Create the first super admin
through the migration job (it runs inside the VPC, so no direct database access
is needed):

```bash
aws codebuild start-build --region ap-south-1 \
  --project-name keystone-payroll-prod-migrations \
  --environment-variables-override \
    name=MIGRATION_MODE,value=bootstrap-admin,type=PLAINTEXT \
    name=ADMIN_EMAIL,value=finance@keystonecommerce.in,type=PLAINTEXT \
    "name=ADMIN_NAME,value=Finance Admin,type=PLAINTEXT"
```

When the build finishes, sign in on the payroll site with that email; the
6-digit code arrives by email. Everyone else is added from **Team & access**.
`MIGRATION_MODE=list-admins` lists the current super admins.

From a machine that can reach the database you can instead run
`pnpm bootstrap-admin -- --email=… --name="…"` with `DATABASE_ADMIN_URL` and
`DATABASE_SSL_CA_FILE=backend/ap-south-1-rds-ca.pem` set.

---

## Step 7: Connect the Team Portal

The employee sync needs the Team Portal's payroll PR merged and its stack
updated so its API gets `PAYROLL_SYNC_TOKEN`. That is described in the Team
Portal repo: `docs/PAYROLL_INTEGRATION.md`. The token was already stored by
step 3 (`/keystone-team-portal/prod/payroll-sync-token`).

Until then payroll works normally: **Sync from Team Portal** shows a red dot
(hover for the reason), and employees still come from the Excel register.

---

## Check it worked

- [ ] `curl https://<app-runner-url>/healthz` returns `{"ok":true}`
- [ ] `curl https://<app-runner-url>/readyz` returns `{"ok":true}` (database reachable)
- [ ] CodeBuild `keystone-payroll-prod-migrations` log ends with `0 pending`
- [ ] You can sign in on the payroll site with the code from email
- [ ] Employees → **Sync from Team Portal** says "Synced … · N linked employees"
- [ ] Upload a register, approve a run, open a payslip PDF and email one to yourself
- [ ] The approved PDFs appear in the S3 bucket under `prod/payslip_pdf/`

---

## Running it

### Releasing changes

Merge a pull request into `main`. CodeBuild runs tests, migrations and the
deploy, then checks `/healthz`; watch it in the CodeBuild console
(`keystone-payroll-prod-api`). Before merging, `pnpm ci` should pass locally and
any new migration must work with the API that is currently live (migrations run
first).

### Migrations

- Files live in `migrations/` as `NNN_name.sql` and run in order, each in its own
  transaction; applied files are recorded in `schema_migrations`.
- `001_schema.sql` creates everything. **Never edit a migration that has been
  deployed**; add `002_….sql` instead.
- Pipeline and manual runs share a database lock, so they never overlap.
- Read-only status: start `keystone-payroll-prod-migrations` with no overrides.

### Logs

| What | Where |
|---|---|
| API | CloudWatch `/aws/apprunner/keystone-payroll-prod-api/<id>/application` (JSON lines; search by `event`) |
| Builds and migrations | CloudWatch `/aws/codebuild/keystone-payroll-prod-api`, streams `build` and `migrations` |

### Rolling back

Code: revert the commit on `main`, which redeploys the previous version.
Migrations are not reverted automatically; fix forward with a new migration.

### Rotating a secret

```bash
aws ssm put-parameter --region ap-south-1 --type SecureString --overwrite \
  --name /keystone-payroll/prod/<name> --value '<new value>'
```

Then redeploy so App Runner reads it (App Runner console → Deploy, or push to
`main`). Rotating `jwt-secret` signs everyone out. Rotating the sync token means
setting `/keystone-team-portal/prod/payroll-sync-token` to the same value and
redeploying both APIs.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `deploy.sh`: "Missing SSM SecureString …" | Run `create-secrets.sh` first |
| CodeBuild can't fetch the source | The CodeConnections connection is not AVAILABLE or can't see this repo |
| Migration job times out connecting | `DATABASE_SECURITY_GROUP_ID` missing, or the subnets can't reach RDS |
| API fails its health check after a deploy | App Runner application log: a startup config error is logged as `config_invalid` |
| "Request origin is not allowed" in the browser | `FRONTEND_ORIGIN` doesn't exactly match the Vercel domain |
| Sign-in code never arrives | Gmail secrets wrong, or the refresh token lacks `gmail.send` |
| Sync button shows a red dot | Hover for the reason: 401 = tokens differ, 503 = Team Portal not configured yet |

---

## Reference

### Local development

See the README. Local settings live in `.env` (copy `.env.example`); files go to
`backend/.dev-storage/` and emails to `backend/.dev-mail/` instead of S3 and Gmail.

### Files in S3

Same model as the Team Portal's private files. Every file has a row in
`private_objects` (purpose, key, name, type, size, SHA-256); the key never leaves
the server, and downloads are a permission check followed by a 60-second signed
link. Approved payslip PDFs are rendered once at approval and stored under
`prod/payslip_pdf/<run>/`; downloads, the ZIP and email attachments all use that
stored file. Logos uploaded in Settings go under `prod/brand_logo/`.

### Roles

Built-in: Super admin (everything, locked), Payroll manager, Approver, Auditor.
Custom roles are created under **Team & access → Roles**.

### API endpoints

Browsers call these on the web app's own origin (`/api/...`). All routes except
sign-in need the session cookie; changes also need an allowed `Origin`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/healthz` | none | Liveness (App Runner health check) |
| GET | `/readyz` | none | Database reachable |
| POST | `/api/auth/send-otp` | none | Email a sign-in code |
| POST | `/api/auth/verify-otp` | none | Exchange the code for a session cookie |
| GET | `/api/auth/me` | signed in | Current user and permissions |
| POST | `/api/auth/logout` | none | Clear the session |
| POST | `/api/imports` | payroll.manage or employees.manage | Upload an Excel file |
| GET | `/api/payroll-runs` | payroll.read | List runs |
| POST | `/api/payroll-runs` | payroll.manage | Create a draft run from an upload |
| GET | `/api/payroll-runs/:id` | payroll.read | Run summary |
| GET | `/api/payroll-runs/:id/payslips` | payroll.read | Payslips in a run |
| GET | `/api/payroll-runs/:id/payslips.zip` | payroll.read | PDFs as a ZIP (`?ids=` for a selection) |
| POST | `/api/payroll-runs/:id/approve` | payroll.approve | Approve a draft (no blocking issues) |
| DELETE | `/api/payroll-runs/:id` | payroll.manage | Delete a draft |
| POST | `/api/payroll-runs/:id/emails` | payslip.send | Queue payslip emails |
| GET | `/api/payslips/:id` | payroll.read | One payslip with checks and edit history |
| PATCH | `/api/payslips/:id` | payroll.manage | Fix flagged fields on a draft run |
| GET | `/api/payslips/:id/pdf` | payroll.read | PDF (approved: 302 to a signed S3 link) |
| GET | `/api/employees` | employees.read | Employee directory |
| POST | `/api/employees/import` | employees.manage | Import an employee master sheet |
| PATCH | `/api/employees/:code` | employees.manage | Edit an employee (Team Portal fields locked) |
| GET | `/api/team-portal-sync` | employees.read | Sync status |
| POST | `/api/team-portal-sync` | employees.manage | Sync from the Team Portal now |
| GET / PUT | `/api/settings` | read: payroll.read; write: settings.manage | Payslip and email settings |
| POST / GET / DELETE | `/api/settings/logos/:slot` | settings.manage (GET: payroll.read) | Upload, view or reset a logo |
| GET / POST | `/api/users` | users.manage | List or add users |
| PATCH | `/api/users/:id` | users.manage | Change a user's roles or status |
| GET | `/api/roles`, `/api/roles/permissions` | roles.manage or users.manage | Roles and permissions |
| POST / PATCH / DELETE | `/api/roles[/:id]` | roles.manage | Manage custom roles |

Team Portal endpoint used by payroll (server-to-server, every 60 minutes and on
**Sync from Team Portal**):

| Method | Path | Auth |
|---|---|---|
| GET | `<TEAM_PORTAL_ORIGIN>/api/integrations/employees` | `Authorization: Bearer <team-portal-sync-token>` |
