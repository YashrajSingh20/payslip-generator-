-- Keystone Payroll: core schema.
-- Money is stored as integer paise. Calendar dates are DATE (returned to Node as 'YYYY-MM-DD').

-- ---------------------------------------------------------------------------
-- Users and RBAC
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  name             text NOT NULL CHECK (btrim(name) <> ''),
  is_active        boolean NOT NULL DEFAULT true,
  -- Bumped to invalidate every outstanding session for the user.
  session_version  integer NOT NULL DEFAULT 1,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  description  text NOT NULL
);

CREATE TABLE role_permissions (
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key  text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_roles (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE VIEW user_effective_permissions AS
  SELECT DISTINCT ur.user_id, rp.permission_key
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id;

-- ---------------------------------------------------------------------------
-- Email OTP sign-in (codes are stored hashed, never in plain text)
-- ---------------------------------------------------------------------------
CREATE TABLE auth_otps (
  id           bigserial PRIMARY KEY,
  email        text NOT NULL,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_otps_email_created_idx ON auth_otps (email, created_at DESC);

-- ---------------------------------------------------------------------------
-- Employee directory (Employee ID from the payroll register is the natural key)
-- ---------------------------------------------------------------------------
CREATE TABLE employees (
  employee_code   text PRIMARY KEY CHECK (btrim(employee_code) <> ''),
  full_name       text NOT NULL,
  designation     text,
  joining_date    date,
  exit_date       date,
  official_email  text,
  personal_email  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Printed on payslips; kept so a blank register cell can be filled from an earlier month.
  pan             text,
  uan             text,
  -- Employees synced from the Team Portal (matched on employee_code). For those
  -- rows the Team Portal owns name, official email, joining date and active
  -- status; the payroll register still supplies designation and pay.
  source          text NOT NULL DEFAULT 'payroll' CHECK (source IN ('payroll', 'team_portal')),
  team_portal_user_id text UNIQUE,
  is_active       boolean NOT NULL DEFAULT true,
  portal_monthly_salary_paise bigint,
  synced_at       timestamptz
);
CREATE INDEX employees_name_idx ON employees (lower(full_name));

-- ---------------------------------------------------------------------------
-- Private files in S3 (same model as the Team Portal's private_objects).
-- Files are referenced by opaque ids; the object key never leaves the server.
-- Guarded routes exchange an id for a short-lived signed URL.
--   payslip_pdf  the PDF of an approved payslip, written once on approval
--   brand_logo   a logo uploaded in Settings and printed on payslips
-- ---------------------------------------------------------------------------
CREATE TABLE private_objects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  purpose          text NOT NULL CHECK (purpose IN ('payslip_pdf', 'brand_logo')),
  object_key       text NOT NULL UNIQUE,
  original_name    text NOT NULL,
  content_type     text NOT NULL,
  byte_size        integer NOT NULL CHECK (byte_size > 0),
  checksum_sha256  text NOT NULL CHECK (checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  status           text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'deleting')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX private_objects_purpose_idx ON private_objects (purpose, created_at DESC);

-- ---------------------------------------------------------------------------
-- Payslip and email settings (single row)
-- ---------------------------------------------------------------------------
CREATE TABLE payroll_settings (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  company_name          text NOT NULL,
  cin                   text NOT NULL DEFAULT '',
  currency_prefix       text NOT NULL DEFAULT '₹',
  footer_text           text NOT NULL DEFAULT '',
  filename_pattern      text NOT NULL,
  email_from_name       text NOT NULL,
  email_subject         text NOT NULL,
  email_body            text NOT NULL,
  recipient_preference  text NOT NULL DEFAULT 'official'
                        CHECK (recipient_preference IN ('official', 'personal')),
  updated_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  registered_office     text NOT NULL DEFAULT '',
  -- Uploaded logos (null = the bundled Keystone and Liwip logos).
  logo_primary_object_id   uuid REFERENCES private_objects(id) ON DELETE SET NULL,
  logo_secondary_object_id uuid REFERENCES private_objects(id) ON DELETE SET NULL
);

INSERT INTO payroll_settings (
  company_name, cin, currency_prefix, footer_text, filename_pattern,
  email_from_name, email_subject, email_body, recipient_preference, registered_office
) VALUES (
  'Keystone Commerce Private Limited',
  'U47912DL2025PTC455970',
  '₹',
  'LIWIP | Live With Pride.',
  'Payslip_{Month}_{Year}_{EmployeeID}_{Name}.pdf',
  'Keystone Commerce Payroll',
  'Payslip for {Month} {Year} | Keystone Commerce Private Limited',
  E'Dear {Name},\n\nPlease find attached your salary payslip for {Month} {Year}.\n\nNet Pay: {Currency} {NetPay}\n\nPlease contact Finance & Accounts / HR in case of any discrepancy.\n\nRegards,\nKeystone Commerce Private Limited',
  'official',
  'Innov8 Ras Vilas, D-1, Lower Ground Floor, Salcon Rasvilas, Saket District Center, New Delhi – 110017'
);

-- ---------------------------------------------------------------------------
-- Uploaded workbooks, parsed once on the server and kept briefly so the user can
-- pick a sheet without uploading again.
-- ---------------------------------------------------------------------------
CREATE TABLE workbook_imports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name   text NOT NULL,
  file_size   integer NOT NULL CHECK (file_size > 0),
  sha256      text NOT NULL,
  sheets      jsonb NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workbook_imports_created_idx ON workbook_imports (created_at);

-- ---------------------------------------------------------------------------
-- Payroll runs and payslips
-- ---------------------------------------------------------------------------
CREATE TABLE payroll_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period               text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  source_file_name     text NOT NULL,
  source_sheet         text NOT NULL,
  source_sha256        text NOT NULL,
  -- Settings are copied onto the run so an approved payslip never changes when
  -- someone edits the company settings later.
  branding             jsonb NOT NULL,
  column_mapping       jsonb NOT NULL,
  employee_count       integer NOT NULL DEFAULT 0,
  net_pay_total_paise  bigint NOT NULL DEFAULT 0,
  created_by           uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  approved_by          uuid REFERENCES users(id),
  approved_at          timestamptz,
  CHECK ((status = 'approved') = (approved_at IS NOT NULL AND approved_by IS NOT NULL))
);
CREATE INDEX payroll_runs_period_idx ON payroll_runs (period DESC, created_at DESC);
-- Only one approved run per month.
CREATE UNIQUE INDEX payroll_runs_one_approved_per_period ON payroll_runs (period) WHERE status = 'approved';

CREATE TABLE payslips (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  row_number              integer NOT NULL,
  employee_code           text NOT NULL,
  full_name               text NOT NULL DEFAULT '',
  designation             text NOT NULL DEFAULT '',
  recipient_email         text,
  net_pay_paise           bigint,
  gross_earnings_paise    bigint,
  total_deductions_paise  bigint,
  -- Normalised payslip fields (money in paise, dates as YYYY-MM-DD).
  data                    jsonb NOT NULL,
  derived_fields          text[] NOT NULL DEFAULT '{}',
  issues                  jsonb NOT NULL DEFAULT '[]',
  blocking_issue_count    integer NOT NULL DEFAULT 0,
  warning_issue_count     integer NOT NULL DEFAULT 0,
  -- Exact cell values as read from the workbook, for audit.
  source_row              jsonb NOT NULL,
  -- Fixes made in the app on a draft run: [{ field, from, to, by: { id, name }, at }].
  edits                   jsonb NOT NULL DEFAULT '[]',
  -- Stored PDF, written once the run is approved.
  pdf_object_id           uuid REFERENCES private_objects(id) ON DELETE SET NULL,
  UNIQUE (run_id, row_number)
);
CREATE INDEX payslips_run_employee_idx ON payslips (run_id, employee_code);
CREATE INDEX payslips_employee_idx ON payslips (employee_code);
CREATE INDEX payslips_pdf_pending_idx ON payslips (run_id) WHERE pdf_object_id IS NULL;

-- ---------------------------------------------------------------------------
-- Durable email outbox. Rows are written in the same transaction as the business
-- action and delivered by the outbox worker with retries.
-- ---------------------------------------------------------------------------
CREATE TABLE email_outbox (
  id                   bigserial PRIMARY KEY,
  kind                 text NOT NULL CHECK (kind IN ('payslip')),
  payslip_id           uuid REFERENCES payslips(id) ON DELETE CASCADE,
  to_email             text NOT NULL,
  from_name            text NOT NULL,
  subject              text NOT NULL,
  body_text            text NOT NULL,
  attachment_name      text,
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts             integer NOT NULL DEFAULT 0,
  max_attempts         integer NOT NULL DEFAULT 5,
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  locked_at            timestamptz,
  last_error           text,
  provider_message_id  text,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  CHECK (kind <> 'payslip' OR payslip_id IS NOT NULL)
);
CREATE INDEX email_outbox_due_idx ON email_outbox (next_attempt_at) WHERE status IN ('pending', 'sending');
CREATE INDEX email_outbox_payslip_idx ON email_outbox (payslip_id, id DESC);

-- ---------------------------------------------------------------------------
-- Team Portal employee sync log: one row per attempt, for the "last synced"
-- status and troubleshooting.
-- ---------------------------------------------------------------------------
CREATE TABLE team_portal_syncs (
  id           bigserial PRIMARY KEY,
  trigger      text NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  counts       jsonb NOT NULL DEFAULT '{}',
  error        text
);
CREATE INDEX team_portal_syncs_started_idx ON team_portal_syncs (started_at DESC);

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------
-- Permissions guard specific code paths, so they are seeded here and mirrored by
-- the P constants in backend/src/rbac/permissions.js.
INSERT INTO permissions (key, description) VALUES
  ('payroll.read',     'View payroll runs, payslips and settings'),
  ('payroll.manage',   'Upload payroll registers, create and delete draft runs'),
  ('payroll.approve',  'Approve a draft payroll run'),
  ('payslip.send',     'Email payslips to employees'),
  ('employees.read',   'View the employee directory'),
  ('employees.manage', 'Import and edit employee records'),
  ('settings.manage',  'Edit payslip branding and email templates'),
  ('users.manage',     'Invite users and assign roles'),
  ('roles.manage',     'Create roles and choose their permissions');

INSERT INTO roles (key, name, description, is_system) VALUES
  ('super_admin',     'Super admin',     'Full access, including users and settings', true),
  ('payroll_manager', 'Payroll manager', 'Prepares payroll runs and sends payslips',   true),
  ('approver',        'Approver',        'Reviews and approves payroll runs',          true),
  ('auditor',         'Auditor',         'Read-only access to payroll and employees',  true);

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r
JOIN permissions p ON
  r.key = 'super_admin'
  OR (r.key = 'payroll_manager' AND p.key IN ('payroll.read', 'payroll.manage', 'payslip.send', 'employees.read', 'employees.manage'))
  OR (r.key = 'approver'        AND p.key IN ('payroll.read', 'payroll.approve', 'employees.read'))
  OR (r.key = 'auditor'         AND p.key IN ('payroll.read', 'employees.read'));
