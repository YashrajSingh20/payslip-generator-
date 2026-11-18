import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectColumns } from '../src/payroll/fields.js';
import { amountInWords, formatDate, formatPaise, formatPercent } from '../src/payroll/format.js';
import { auditPayslip, buildPayslips, chooseRecipient, deriveMissing, parseRow, suggestPeriod } from '../src/payroll/normalize.js';
import { payslipFileName, renderTemplate } from '../src/payroll/templates.js';
import { parseDate, parseMoney, parsePercent } from '../src/payroll/values.js';

describe('value parsing', () => {
  it('reads money into integer paise', () => {
    assert.deepEqual(parseMoney(25000.5), { value: 2500050, invalid: false });
    assert.equal(parseMoney('Rs. 1,23,456.78').value, 12345678);
    assert.equal(parseMoney('₹ 500').value, 50000);
    assert.equal(parseMoney('(1,000)').value, -100000);
    assert.equal(parseMoney(0.1 + 0.2).value, 30); // no float drift
    assert.deepEqual(parseMoney(''), { value: null, invalid: false });
    assert.deepEqual(parseMoney('n/a'), { value: null, invalid: true });
  });

  it('reads percentages as fractions', () => {
    assert.equal(parsePercent(0.9333).value, 0.9333);
    assert.equal(parsePercent(93.33).value, 0.9333);
    assert.equal(parsePercent('93.33%').value, 0.9333);
    assert.equal(parsePercent(1).value, 1);
    assert.equal(parsePercent(-5).invalid, true);
  });

  it('reads dates day-first and rejects impossible ones', () => {
    assert.equal(parseDate('2026-07-31').value, '2026-07-31');
    assert.equal(parseDate('31-07-2026').value, '2026-07-31');
    assert.equal(parseDate('01/08/26').value, '2026-08-01');
    assert.equal(parseDate('15-Jul-2026').value, '2026-07-15');
    assert.equal(parseDate(46234).value, '2026-07-31'); // Excel serial
    assert.equal(parseDate('31-02-2026').invalid, true);
  });
});

describe('column detection', () => {
  it('matches aliases case- and space-insensitively', () => {
    const mapping = detectColumns(['  EMPLOYEE   id', 'Employee Name', 'Net Payable', 'Telphone Allowance', 'Unrelated']);
    assert.equal(mapping.employeeId, '  EMPLOYEE   id');
    assert.equal(mapping.name, 'Employee Name');
    assert.equal(mapping.netPay, 'Net Payable');
    assert.equal(mapping.telephone, 'Telphone Allowance');
    assert.equal(mapping.hra, null);
  });
});

describe('deriveMissing', () => {
  const base = () => parseRow({ 'Employee ID': '1', Basic: 20000, HRA: 8000, '% of Salary': 0.5, 'PF Employee': 1200, PT: 200, 'Net Pay': 12600 },
    detectColumns(['Employee ID', 'Basic', 'HRA', '% of Salary', 'PF Employee', 'PT', 'Net Pay'])).data;

  it('prorates missing payables and sums gross and deductions, in paise', () => {
    const data = base();
    const derived = deriveMissing(data);
    assert.equal(data.basicPayable, 1000000);
    assert.equal(data.hraPayable, 400000);
    assert.equal(data.grossEarnings, 1400000);
    assert.equal(data.totalDeductions, 140000);
    assert.deepEqual(derived.sort(), ['amountWords', 'basicPayable', 'grossEarnings', 'hraPayable', 'totalDeductions']);
  });

  it('never overrides values present in the sheet and never computes net pay', () => {
    const data = { ...base(), basicPayable: 999, grossEarnings: 5, netPay: null };
    const derived = deriveMissing(data);
    assert.equal(data.basicPayable, 999);
    assert.equal(data.grossEarnings, 5);
    assert.equal(data.netPay, null);
    assert.ok(!derived.includes('basicPayable'));
    assert.ok(!derived.includes('amountWords'));
  });
});

describe('buildPayslips', () => {
  const headers = ['Employee ID', 'Full Name', 'Designation', 'Net Pay', 'Official Email ID', 'Personal Email ID', 'Payroll Date'];
  const mapping = detectColumns(headers);
  const row = (rowNumber, values) => ({ rowNumber, values: Object.fromEntries(headers.map((h, i) => [h, values[i] ?? null])) });

  it('flags blocking and warning issues', () => {
    const sheet = {
      name: 'PR-Jul-2026',
      rows: [
        row(2, ['1', 'Asha', 'Lead', 1000, 'asha@x.in', '', '2026-07-31']),
        row(3, ['2', '', 'Lead', '', 'bad-email', '', '2026-07-31']),
        row(4, ['2', 'Dup', '', 500, '', '', '2026-07-31']),
        row(5, ['', 'No id row', '', 1, '', '', '']),
      ],
    };
    const payslips = buildPayslips({ sheet, mapping });
    assert.equal(payslips.length, 3, 'rows without an Employee ID are skipped');
    const [ok, broken, dup] = payslips;
    assert.equal(ok.blockingIssueCount, 0);
    assert.equal(ok.recipientEmail, 'asha@x.in');
    const checks = broken.issues.map((i) => i.check);
    assert.ok(checks.includes('Duplicate Employee ID'));
    assert.ok(checks.includes('Missing Full Name'));
    assert.ok(checks.includes('Missing Net Pay'));
    assert.ok(checks.includes('Unreadable Official Email'));
    assert.equal(broken.recipientEmail, null);
    assert.ok(dup.issues.some((i) => i.check === 'Missing email'));
  });

  it('fills blanks from the directory and honours the recipient preference', () => {
    const sheet = { name: 's', rows: [row(2, ['7', '', '', 100, '', '', ''])] };
    const directory = new Map([['7', { fullName: 'From Master', officialEmail: 'o@x.in', personalEmail: 'p@x.in' }]]);
    const [p] = buildPayslips({ sheet, mapping, directory, preference: 'personal' });
    assert.equal(p.fullName, 'From Master');
    assert.equal(p.recipientEmail, 'p@x.in');
    assert.equal(chooseRecipient({ officialEmail: null, personalEmail: 'p@x.in' }, 'official'), 'p@x.in');
  });

  it('suggests the most common payroll month', () => {
    assert.equal(suggestPeriod([{ payrollDate: '2026-07-31' }, { payrollDate: '2026-07-31' }, { payrollDate: '2026-06-30' }]), '2026-07');
    assert.equal(suggestPeriod([], 'PR-Aug-26'), '2026-08');
    assert.equal(suggestPeriod([], 'Sheet1'), null);
  });
});

describe('formatting', () => {
  it('formats paise in the Indian grouping', () => {
    assert.equal(formatPaise(12345678), '1,23,456.78');
    assert.equal(formatPaise(null), '-');
    assert.equal(formatPercent(0.9333), '93.33%');
    assert.equal(formatDate('2026-07-01'), '01-07-26');
  });

  it('writes amounts in Indian words', () => {
    assert.equal(amountInWords(3498000), 'Rupees Thirty Four Thousand Nine Hundred Eighty Only');
    assert.equal(amountInWords(1234567890), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only');
    assert.equal(amountInWords(0), 'Rupees Zero Only');
  });
});

describe('templates', () => {
  it('replaces known tokens and leaves unknown ones', () => {
    assert.equal(renderTemplate('Hi {Name}, {Unknown}', { Name: 'Asha' }), 'Hi Asha, {Unknown}');
  });

  it('builds safe PDF file names', () => {
    const name = payslipFileName('Payslip_{Month}_{Year}_{EmployeeID}_{Name}', {
      Month: 'July', Year: '2026', EmployeeID: '10003', Name: 'Manmohan  Thakur/../x',
    });
    assert.equal(name, 'Payslip_July_2026_10003_Manmohan_Thakur..x.pdf');
  });
});

describe('auditPayslip', () => {
  const base = { employeeId: '1', name: 'Asha', designation: 'Lead', netPay: 100, officialEmail: 'a@b.in', personalEmail: null };

  it('tags each problem with the field that fixes it', () => {
    const { issues, blockingIssueCount } = auditPayslip({ data: { ...base, netPay: null, officialEmail: null }, duplicateCount: 2 });
    assert.equal(blockingIssueCount, 2);
    assert.deepEqual(issues.map((i) => i.field), ['employeeId', 'netPay', 'officialEmail']);
  });

  it('clears once values are corrected and notes the correction', () => {
    const edits = [{ field: 'netPay', from: null, to: 100, by: { name: 'Priya' } }];
    const { issues, blockingIssueCount, warningIssueCount, recipient } = auditPayslip({ data: base, edits });
    assert.equal(blockingIssueCount + warningIssueCount, 0);
    assert.equal(recipient, 'a@b.in');
    assert.match(issues.find((i) => i.check === 'Corrected in app').detail, /Net Pay changed by Priya/);
  });
});

describe('net pay consistency', () => {
  const data = { employeeId: '1', name: 'Tara', designation: 'Lead', officialEmail: 'a@b.in', grossEarnings: 4600000, totalDeductions: 200000 };
  const checks = (netPay) => auditPayslip({ data: { ...data, netPay } }).issues.map((i) => i.check);

  it('warns when net pay is not gross minus deductions', () => {
    const issue = auditPayslip({ data: { ...data, netPay: 4600000 } }).issues.find((i) => i.check === 'Net Pay mismatch');
    assert.equal(issue.severity, 'warning');
    assert.equal(issue.field, 'netPay');
    assert.match(issue.detail, /46,000\.00.*44,000\.00/);
  });

  it('allows a rupee of rounding and skips the check without totals', () => {
    assert.ok(!checks(4400000).includes('Net Pay mismatch'));
    assert.ok(!checks(4400100).includes('Net Pay mismatch'));
    assert.ok(checks(4400101).includes('Net Pay mismatch'));
    const noTotals = auditPayslip({ data: { ...data, grossEarnings: null, netPay: 1 } }).issues.map((i) => i.check);
    assert.ok(!noTotals.includes('Net Pay mismatch'));
  });
});
