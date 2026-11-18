# Keystone Payroll

Monthly payroll runs and payslips for Keystone Commerce. Upload the Excel payroll
register, review what the sheet does and doesn't contain, approve the run, then
download or email each employee their own PDF payslip.

Built on the Keystone Team Portal stack: Next.js 16 frontend at the root, Express 5
API in `backend/`, PostgreSQL 17 with raw SQL, email OTP sign-in, and DB-backed RBAC.

## How it works

1. **Upload**: the browser sends the `.xlsx` to `POST /api/imports`. The server parses
   every visible sheet (finds the header row, keeps dates as calendar dates) and matches
   columns by alias, e.g. `Telphone Allowance` → Telephone Allowance.
2. **Create draft**: pick the payroll sheet and month. Each row becomes a payslip:
   - Money is stored as integer paise. Values in the sheet are used as-is.
   - Only blanks are filled: payable = monthly rate × % of salary, gross = sum of
     payables, total deductions = PF + PT + TDS + advance, and amount in words.
     Every filled value is flagged in the UI. **Net pay is never calculated.**
   - Missing emails are filled from an `Employee Master` sheet in the same workbook,
     then from the employee directory.
   - Checks: duplicate ID, missing name or net pay (blocking); missing or invalid
     email, missing designation, unreadable cells (warning).
3. **Approve**: someone with `payroll.approve` locks the run. Blocking issues prevent
   approval, and only one run per month can be approved. Branding is copied onto the run,
   so later settings edits never change an approved payslip.
4. **Send**: payslip emails go into a Postgres outbox inside the same transaction. A
   worker delivers them via the Gmail API with retries and backoff. Sending twice skips
   anyone already emailed unless "send again" is ticked.

PDFs are vector A4 files rendered on the server with `pdf-lib`, following the approved
July payslip layout. They have selectable text and are about 45 KB each.

### Roles

| Role | Can |
|---|---|
| `super_admin` | Everything, including users and settings |
| `payroll_manager` | Upload registers, create/delete drafts, send payslips, edit employees |
| `approver` | Review and approve runs |
| `auditor` | Read-only |

Preparing and approving are separate roles (maker/checker).

## Local development

Needs Node 22+, pnpm (via corepack) and Docker.

```bash
cp .env.example .env      # then set JWT_SECRET (command in the file)
pnpm install
pnpm --dir backend install --ignore-workspace
pnpm db:up                # Postgres 17 on localhost:5435
pnpm db:migrate
pnpm seed:dev             # admin@ / payroll@ / approver@ / auditor@keystone.test
pnpm --dir backend dev    # API on :8080
pnpm dev                  # web on :3000
```

With `DEV_AUTH_BYPASS=true` the sign-in code is always `123456`. With
`DEV_EMAIL_MOCK=true` (and Gmail not configured) emails are written to
`backend/.dev-mail/*.eml`, which you can open in any mail client.

A sample register with deliberate gaps lives at `samples/sample-payroll-register.xlsx`.
Regenerate it with `node backend/scripts/make-sample-workbook.mjs`.

To create a real first admin (any environment):

```bash
pnpm bootstrap-admin -- --email=you@keystonecommerce.in --name="Your Name"
```

### Gmail setup

Fill these four in `.env`, or email stays off:

- `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET`: a Google Cloud OAuth client
- `GMAIL_OAUTH_REFRESH_TOKEN`: a refresh token for the sender mailbox with the
  `https://www.googleapis.com/auth/gmail.send` scope
- `GMAIL_SENDER_EMAIL`: that mailbox

When Gmail is configured, sign-in codes are emailed for real (unless `DEV_AUTH_BYPASS`
is on) and payslips are sent from that mailbox.

## Checks

```bash
pnpm test                 # frontend unit tests
pnpm --dir backend test   # domain, workbook, PDF, HTTP/RBAC tests
pnpm check:routes         # every route starts with a guard call
pnpm run ci               # all of the above + next build + secret scan
```

## Layout

```text
app/                 Next.js UI (single-page shell, hash routes)
  components/        one file per module + shadcn-style primitives
  lib/               api.js (only fetch wrapper), auth, React Query, formatting
backend/src/
  payroll/           fields/aliases, value parsing, derivation + audit, workbook reader, PDF
  services/          business logic (one factory per domain)
  routes/            Express routers; guard call is always the first statement
  email/             MIME builder, Gmail client, outbox worker
migrations/          numbered SQL, applied in order by scripts/db-migrate.mjs
```

## Not built yet

- AWS infrastructure (CloudFormation, CodeBuild) and the RDS CA bundle in the image
- BullMQ/Valkey wake-ups for the outbox (the worker polls Postgres and is nudged in-process)
- Uploading workbooks to S3 via presigned URLs (they are sent as base64, max 4 MB)
- Employee self-service (employees signing in to see their own payslips)
- Playwright E2E tests

## Deployment

Production runs on AWS (App Runner, RDS, S3, CodeBuild) with the web app on
Vercel; every push to `main` tests, migrates and deploys. The full runbook,
including the database setup, secrets and first admin, is in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Deployment inputs:
[backend/infra/production.env.example](backend/infra/production.env.example).
