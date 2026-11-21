// Entirely fictitious data for the public, frontend-only demonstration.
const data = {
  employeeId: 'DEMO-001', name: 'Aarav Kapoor', designation: 'Operations Executive',
  joiningDate: '2025-01-15', exitDate: null, monthStart: '2026-10-01', payrollDate: '2026-10-31',
  workingDays: 31, paidLeaves: 0, lop: 0, daysInMonth: 31, pctSalary: 1,
  pan: null, uan: null, officialEmail: 'aarav.kapoor@example.test', personalEmail: null,
  ctc: 6000000, basic: 3000000, hra: 1200000, monthlyAllowance: 900000,
  lta: 300000, performance: 300000, telephone: 100000, fuel: 200000, specialBonus: 0,
  basicPayable: 3000000, hraPayable: 1200000, monthlyAllowancePayable: 900000,
  ltaPayable: 300000, performancePayable: 300000, telephonePayable: 100000,
  fuelPayable: 200000, specialBonusPayable: 0, grossEarnings: 6000000,
  pfEmployee: 180000, professionalTax: 20000, tds: 100000, advanceDeducted: 0,
  openingAdvance: 0, closingAdvance: 0, totalDeductions: 300000, netPay: 5700000,
  amountWords: 'Rupees Fifty Seven Thousand Only',
};

export const DEMO_RUN = {
  id: 'demo-oct-2026', period: '2026-10', status: 'approved',
  sourceFileName: 'Demo payroll - fictional data.xlsx', sourceSheet: 'October 2026',
  employeeCount: 1, netPayTotalPaise: data.netPay,
  createdBy: { id: 'frontend-preview', name: 'Demo viewer' }, createdAt: '2026-11-01T04:00:00Z',
  approvedBy: { id: 'frontend-preview', name: 'Demo viewer' }, approvedAt: '2026-11-01T05:00:00Z',
  stats: { blocking: 0, warnings: 0, emailable: 1, emailsSent: 0, emailsQueued: 0, emailsFailed: 0 },
  columnMapping: { employeeId: 'Employee ID', name: 'Full Name', designation: 'Designation', netPay: 'Net Pay' },
  branding: {
    companyName: 'Keystone Commerce Private Limited', cin: '', registeredOffice: '',
    currencyPrefix: '₹', footerText: 'DEMO ONLY - Fictitious employee and amounts',
    filenamePattern: 'Demo_Payslip_{Month}_{Year}_{Name}.pdf',
  },
};

export const DEMO_PAYSLIP = {
  id: 'demo-aarav-kapoor', runId: DEMO_RUN.id, runStatus: DEMO_RUN.status, period: DEMO_RUN.period,
  employeeCode: data.employeeId, fullName: data.name, designation: data.designation,
  email: data.officialEmail, recipientEmail: data.officialEmail, emailFromDirectory: false,
  rowNumber: 2, ctcPaise: data.ctc, workingDays: data.workingDays,
  grossEarningsPaise: data.grossEarnings, totalDeductionsPaise: data.totalDeductions, netPayPaise: data.netPay,
  blockingIssueCount: 0, warningIssueCount: 0, issues: [], derivedFields: [], edits: [],
  emailStatus: null, emails: [], data,
  sourceFileName: DEMO_RUN.sourceFileName, sourceSheet: DEMO_RUN.sourceSheet,
  sourceRow: { 'Employee ID': data.employeeId, 'Full Name': data.name, Designation: data.designation, 'Net Pay': data.netPay / 100 },
  fileName: 'Demo_Payslip_October_2026_Aarav_Kapoor.pdf',
};

export const DEMO_EMPLOYEE = {
  employeeCode: data.employeeId, fullName: data.name, designation: data.designation,
  officialEmail: data.officialEmail, personalEmail: null, joiningDate: data.joiningDate,
  lastPeriod: DEMO_RUN.period, isActive: true, source: 'workbook',
};
