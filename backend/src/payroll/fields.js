// Payroll register columns, matched to workbook headers by alias (case and
// whitespace insensitive). Types drive parsing:
//   text    trimmed string
//   date    'YYYY-MM-DD'
//   money   integer paise
//   number  plain number (days)
//   percent fraction (0.9333 for 93.33%)
//   email   lower-cased string

export const FIELDS = [
  { key: 'employeeId', label: 'Employee ID', type: 'text', aliases: ['Employee ID', 'Emp ID', 'EmployeeID', 'Employee Code', 'Emp Code'] },
  { key: 'name', label: 'Full Name', type: 'text', aliases: ['Full Name', 'Employee Name', 'Name'] },
  { key: 'pan', label: 'PAN', type: 'text', aliases: ['PAN', 'PAN Number', 'PAN No', 'PAN No.'] },
  { key: 'uan', label: 'UAN', type: 'text', aliases: ['UAN', 'UAN Number', 'UAN No', 'UAN No.', 'PF UAN'] },
  { key: 'designation', label: 'Designation', type: 'text', aliases: ['Designation', 'Role'] },
  { key: 'joiningDate', label: 'Joining Date', type: 'date', aliases: ['Joining Date', 'Date of Joining', 'DOJ'] },
  { key: 'exitDate', label: 'Exit Date', type: 'date', aliases: ['Exit Date', 'Date of Exit', 'Last Working Day'] },
  { key: 'monthStart', label: 'Month Start Date', type: 'date', aliases: ['Month Start Date', 'Payroll Start', 'Period Start'] },
  { key: 'payrollDate', label: 'Payroll Date', type: 'date', aliases: ['Payroll Date', 'Period End', 'Salary Date'] },
  { key: 'workingDays', label: 'Working Days', type: 'number', aliases: ['Total Working Days', 'Working Days'] },
  { key: 'paidLeaves', label: 'Paid Leaves', type: 'number', aliases: ['Paid Leaves', 'Paid Leave'] },
  { key: 'lop', label: 'LOP', type: 'number', aliases: ['LOP', 'Loss of Pay', 'Leave Without Pay'] },
  { key: 'daysInMonth', label: 'Days in Month', type: 'number', aliases: ['Days in Month', 'Calendar Days'] },
  { key: 'pctSalary', label: '% of Salary', type: 'percent', aliases: ['% of Salary', 'Percentage of Salary', 'Salary %'] },
  { key: 'ctc', label: 'Monthly CTC', type: 'money', aliases: ['CTC', 'Monthly CTC'] },

  { key: 'basic', label: 'Basic', type: 'money', aliases: ['Basic', 'Basic Salary'] },
  { key: 'hra', label: 'HRA', type: 'money', aliases: ['HRA'] },
  { key: 'monthlyAllowance', label: 'Monthly Allowance', type: 'money', aliases: ['Monthly Allowance'] },
  { key: 'lta', label: 'LTA', type: 'money', aliases: ['LTA'] },
  { key: 'performance', label: 'Performance Based Pay', type: 'money', aliases: ['Performance Based Pay', 'Performance Pay'] },
  { key: 'telephone', label: 'Telephone Allowance', type: 'money', aliases: ['Telephone Allowance', 'Telphone Allowance', 'Phone Allowance'] },
  { key: 'fuel', label: 'Fuel Allowance', type: 'money', aliases: ['Fuel Allowance'] },
  { key: 'specialBonus', label: 'Special Bonus', type: 'money', aliases: ['Special Bonus', 'Bonus'] },

  { key: 'basicPayable', label: 'Basic Payable', type: 'money', aliases: ['Basic Payable', 'Payable Basic', 'Basic Payable Amount'] },
  { key: 'hraPayable', label: 'HRA Payable', type: 'money', aliases: ['HRA Payable', 'Payable HRA', 'HRA Payable Amount'] },
  { key: 'monthlyAllowancePayable', label: 'Monthly Allowance Payable', type: 'money', aliases: ['Monthly Allowance Payable', 'Payable Monthly Allowance'] },
  { key: 'ltaPayable', label: 'LTA Payable', type: 'money', aliases: ['LTA Payable', 'Payable LTA'] },
  { key: 'performancePayable', label: 'Performance Payable', type: 'money', aliases: ['Performance Based Pay Payable', 'Performance Payable'] },
  { key: 'telephonePayable', label: 'Telephone Payable', type: 'money', aliases: ['Telephone Allowance Payable', 'Telphone Allowance Payable'] },
  { key: 'fuelPayable', label: 'Fuel Payable', type: 'money', aliases: ['Fuel Allowance Payable'] },
  { key: 'specialBonusPayable', label: 'Special Bonus Payable', type: 'money', aliases: ['Special Bonus Payable', 'Bonus Payable'] },
  { key: 'grossEarnings', label: 'Gross Earnings', type: 'money', aliases: ['Gross Earnings', 'Gross Salary', 'Gross Payable'] },

  { key: 'pfEmployee', label: 'PF Employee', type: 'money', aliases: ['PF Employee', 'Employee PF'] },
  { key: 'professionalTax', label: 'Professional Tax', type: 'money', aliases: ['Professional Tax', 'PT'] },
  { key: 'tds', label: 'TDS', type: 'money', aliases: ['TDS', 'Income Tax'] },
  { key: 'openingAdvance', label: 'Opening Advance', type: 'money', aliases: ['Opening Advance'] },
  { key: 'advanceDeducted', label: 'Advance Deducted', type: 'money', aliases: ['Advance Deducted', 'Advance Recovery'] },
  { key: 'totalDeductions', label: 'Total Deductions', type: 'money', aliases: ['Total Deductions', 'Deductions Total'] },
  { key: 'netPay', label: 'Net Pay', type: 'money', aliases: ['Net Pay', 'Net Payable', 'Take Home'] },
  { key: 'closingAdvance', label: 'Closing Advance', type: 'money', aliases: ['Closing Advance'] },
  { key: 'amountWords', label: 'Amount in words', type: 'text', aliases: ['Amount in words', 'Net Pay in Words'] },

  { key: 'personalEmail', label: 'Personal Email', type: 'email', aliases: ['Personal Email ID', 'Personal Email', 'Email ID', 'Email'] },
  { key: 'officialEmail', label: 'Official Email', type: 'email', aliases: ['Official Email ID', 'Company Email', 'Official Email', 'Work Email'] },
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

/** [monthly rate field, payable field, payslip label] */
export const EARNINGS = [
  ['basic', 'basicPayable', 'Basic'],
  ['hra', 'hraPayable', 'HRA'],
  ['monthlyAllowance', 'monthlyAllowancePayable', 'Monthly Allowance'],
  ['lta', 'ltaPayable', 'LTA'],
  ['performance', 'performancePayable', 'Performance Based Pay'],
  ['telephone', 'telephonePayable', 'Telephone Allowance'],
  ['fuel', 'fuelPayable', 'Fuel Allowance'],
  ['specialBonus', 'specialBonusPayable', 'Special Bonus'],
];

export const DEDUCTIONS = [
  ['pfEmployee', 'PF Employee'],
  ['professionalTax', 'Professional Tax'],
  ['tds', 'TDS'],
  ['advanceDeducted', 'Advance Deducted'],
];

export const normalizeHeader = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Maps each field to the first workbook header matching one of its aliases.
 * Returns { [fieldKey]: headerName | null }.
 */
export function detectColumns(headers) {
  const index = new Map();
  headers.forEach((h) => {
    const n = normalizeHeader(h);
    if (n && !index.has(n)) index.set(n, h);
  });
  const mapping = {};
  for (const field of FIELDS) {
    const alias = field.aliases.find((a) => index.has(normalizeHeader(a)));
    mapping[field.key] = alias ? index.get(normalizeHeader(alias)) : null;
  }
  return mapping;
}
