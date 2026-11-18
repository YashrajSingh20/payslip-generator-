// Mirrors the roles and permissions seeded in migrations/001_schema.sql. Each key guards a specific code path.
export const P = Object.freeze({
  PAYROLL_READ: 'payroll.read',
  PAYROLL_MANAGE: 'payroll.manage',
  PAYROLL_APPROVE: 'payroll.approve',
  PAYSLIP_SEND: 'payslip.send',
  EMPLOYEES_READ: 'employees.read',
  EMPLOYEES_MANAGE: 'employees.manage',
  SETTINGS_MANAGE: 'settings.manage',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
});
