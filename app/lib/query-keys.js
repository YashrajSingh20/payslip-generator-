export const qk = {
  me: ['me'],
  runs: ['runs'],
  run: (id) => ['runs', id],
  payslips: (runId) => ['runs', runId, 'payslips'],
  payslip: (id) => ['payslips', id],
  employees: (q) => ['employees', q],
  teamPortalSync: ['team-portal-sync'],
  settings: ['settings'],
  users: ['users'],
  roles: ['roles'],
};
