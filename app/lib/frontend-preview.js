// Used only by an explicitly enabled frontend-only build. No real session or API access.
import { DEMO_EMPLOYEE, DEMO_PAYSLIP, DEMO_RUN } from './demo-payslip.js';
export const PREVIEW_USER = {
  id: 'frontend-preview',
  name: 'Demo viewer',
  email: 'demo@example.test',
  permissions: [
    'payroll.read', 'payroll.manage', 'payroll.approve', 'payslip.send',
    'employees.read', 'employees.manage', 'settings.manage', 'users.manage', 'roles.manage',
  ],
};

const ROLES = [
  ['super_admin', 'Super admin'], ['payroll_manager', 'Payroll manager'],
  ['approver', 'Approver'], ['auditor', 'Auditor'],
].map(([key, name]) => ({
  id: key, key, name, description: '', isSystem: true,
  locked: key === 'super_admin', holders: 0,
  permissions: key === 'super_admin' ? PREVIEW_USER.permissions : ['payroll.read', 'employees.read'],
}));

export function previewResponse(path, method = 'GET') {
  if (path === '/api/auth/logout' && method === 'POST') return { ok: true };
  if (method !== 'GET') throw new Error('This is a UI preview. Uploads, changes and emails are unavailable until the service is connected.');
  const pathname = new URL(path, 'https://preview.example.test').pathname;
  switch (pathname) {
    case '/api/auth/me': return structuredClone({ user: PREVIEW_USER });
    case '/api/payroll-runs': return structuredClone({ items: [DEMO_RUN] });
    case `/api/payroll-runs/${DEMO_RUN.id}`: return structuredClone(DEMO_RUN);
    case `/api/payroll-runs/${DEMO_RUN.id}/payslips`: return structuredClone({ items: [DEMO_PAYSLIP] });
    case `/api/payslips/${DEMO_PAYSLIP.id}`: return structuredClone(DEMO_PAYSLIP);
    case '/api/employees': {
      const query = new URL(path, 'https://preview.example.test').searchParams.get('q')?.trim().toLowerCase() ?? '';
      const items = Object.values(DEMO_EMPLOYEE).some((v) => typeof v === 'string' && v.toLowerCase().includes(query)) ? [DEMO_EMPLOYEE] : [];
      return structuredClone({ items, total: items.length, nextCursor: null });
    }
    case '/api/users': return { items: [] };
    case '/api/roles': return structuredClone({ items: ROLES });
    case '/api/team-portal-sync': return { enabled: false };
    case '/api/settings': return {
      companyName: 'Keystone Commerce Private Limited', cin: '', registeredOffice: '',
      currencyPrefix: '₹', footerText: 'LIWIP | Live With Pride.',
      filenamePattern: 'Payslip_{Month}_{Year}_{EmployeeID}_{Name}.pdf',
      emailFromName: 'Keystone Commerce Payroll', recipientPreference: 'official',
      emailSubject: 'Payslip for {Month} {Year}',
      emailBody: 'Dear {Name},\n\nPlease find attached your payslip for {Month} {Year}.\n\nRegards,\nKeystone Commerce Payroll',
      logoPrimaryObjectId: null, logoSecondaryObjectId: null, emailProvider: null,
    };
    default: throw new Error('This screen needs the payroll service, which is not connected to this preview.');
  }
}
