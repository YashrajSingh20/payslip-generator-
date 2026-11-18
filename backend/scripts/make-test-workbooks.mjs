#!/usr/bin/env node
// Writes two fake August 2026 registers for testing the full flow:
//   samples/test-payroll-aug-2026-clean.xlsx        no blocking issues, ready to approve
//   samples/test-payroll-aug-2026-with-issues.xlsx  same people with deliberate problems
// All addresses use the reserved .test domain, so nothing can reach a real inbox.
//   node backend/scripts/make-test-workbooks.mjs [output-dir]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const outDir = path.resolve(process.argv[2] ?? 'samples');
const DAYS = 31; // August 2026

// code, name, designation, joining date, monthly CTC, paid days, paid leave, LOP, official email
const PEOPLE = [
  ['20101', 'Aarav Kapoor', 'Category Manager', '2024-02-05', 110000, 31, 1, 0],
  ['20102', 'Meera Nair', 'Senior Designer', '2024-09-16', 85000, 31, 0, 0],
  ['20103', 'Rohan Desai', 'Supply Chain Analyst', '2025-01-20', 65000, 30, 2, 1],
  ['20104', 'Ishita Bose', 'Content Strategist', '2025-03-03', 58000, 31, 0, 0],
  ['20105', 'Vikram Rathore', 'Warehouse Manager', '2023-11-13', 72000, 28, 0, 3],
  ['20106', 'Neha Joshi', 'HR Generalist', '2025-06-09', 50000, 31, 1, 0],
  ['20107', 'Arjun Malhotra', 'Backend Engineer', '2024-07-01', 140000, 31, 0, 0],
  ['20108', 'Tara Fernandes', 'Customer Support Lead', '2025-02-24', 46000, 31, 2, 0],
  ['20109', 'Kunal Verma', 'Accounts Executive', '2025-10-06', 38000, 31, 0, 0],
  ['20110', 'Priya Sengupta', 'Social Media Associate', '2026-08-11', 32000, 21, 0, 0],
];

const HEADERS = [
  'Employee ID', 'Full Name', 'Designation', 'PAN', 'UAN', 'Joining Date', 'Month Start Date', 'Payroll Date',
  'Total Working Days', 'Paid Leaves', 'LOP', 'Days in Month', '% of Salary', 'CTC',
  'Basic', 'HRA', 'Monthly Allowance', 'LTA', 'Performance Based Pay', 'Telephone Allowance', 'Fuel Allowance', 'Special Bonus',
  'Basic Payable', 'HRA Payable', 'Monthly Allowance Payable', 'LTA Payable', 'Performance Payable',
  'Telephone Allowance Payable', 'Fuel Allowance Payable', 'Special Bonus Payable', 'Gross Earnings',
  'PF Employee', 'Professional Tax', 'TDS', 'Opening Advance', 'Advance Deducted', 'Closing Advance',
  'Total Deductions', 'Net Pay', 'Official Email ID',
];

const r2 = (n) => Math.round(n * 100) / 100;
const email = (name) => `${name.toLowerCase().replace(/\s+/g, '.')}@keystone.test`;
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
// Fake but well-formed: 5 letters, 4 digits, 1 letter (4th letter P = individual).
const pan = (code, name) => `${'ABC'}P${name.split(' ').pop()[0].toUpperCase()}${code.slice(-4)}${'KLMNPQRSTV'[Number(code.slice(-1))]}`;

function rowFor([code, name, role, joined, ctc, paid, paidLeave, lop]) {
  const pct = r2(paid / DAYS);
  const rates = {
    basic: ctc * 0.5, hra: ctc * 0.2, allowance: ctc * 0.15, lta: ctc * 0.05,
    perf: ctc * 0.05, phone: 1000, fuel: ctc * 0.05 - 1000,
    bonus: code === '20107' ? 15000 : 0,
  };
  const payable = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, r2(v * pct)]));
  const gross = r2(Object.values(payable).reduce((a, b) => a + b, 0));
  const pf = r2(Math.min(payable.basic * 0.12, 1800));
  const pt = 200;
  const tds = ctc >= 100000 ? r2(ctc * 0.09) : ctc >= 70000 ? r2(ctc * 0.04) : 0;
  const opening = code === '20105' ? 12000 : 0;
  const recovered = code === '20105' ? 4000 : 0;
  const deductions = r2(pf + pt + tds + recovered);
  return [
    code, name, role, pan(code, name), `1009${code}${code.slice(-3)}`, utc(joined), utc('2026-08-01'), utc('2026-08-31'),
    paid, paidLeave, lop, DAYS, pct, ctc,
    rates.basic, rates.hra, rates.allowance, rates.lta, rates.perf, rates.phone, rates.fuel, rates.bonus,
    payable.basic, payable.hra, payable.allowance, payable.lta, payable.perf, payable.phone, payable.fuel, payable.bonus, gross,
    pf, pt, tds, opening, recovered, opening - recovered,
    deductions, r2(gross - deductions), email(name),
  ];
}

function build(rows, { master = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PR-Aug-2026');
  ws.addRow(['Keystone Commerce · Payroll register · August 2026']).font = { bold: true, size: 13 };
  ws.addRow([]);
  const header = ws.addRow(HEADERS);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D1511' } };
  rows.forEach((r) => ws.addRow(r));
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
  HEADERS.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(12, h.length + 2);
    if (/Date$/.test(h)) col.numFmt = 'dd-mm-yyyy';
    else if (h === '% of Salary') col.numFmt = '0.00%';
    else if (i >= 13 && i <= 38) col.numFmt = '#,##0.00';
  });
  ws.getColumn(2).width = 20;
  ws.getColumn(40).width = 30;

  if (master.length) {
    const m = wb.addWorksheet('Employee Master');
    m.addRow(['Employee ID', 'Full Name', 'Official Email ID', 'Personal Email ID']).font = { bold: true };
    master.forEach((r) => m.addRow(r));
  }
  return wb;
}

await mkdir(outDir, { recursive: true });

// 1. Clean: every row is complete.
const clean = PEOPLE.map(rowFor);
await build(clean).xlsx.writeFile(path.join(outDir, 'test-payroll-aug-2026-clean.xlsx'));

// 2. With issues: copy and break specific rows.
const col = (h) => HEADERS.indexOf(h);
const broken = PEOPLE.map(rowFor);
broken[1][col('Official Email ID')] = '';                  // Meera: no email in sheet, filled from Employee Master (personal)
broken[3][col('Official Email ID')] = '';                  // Ishita: no email anywhere -> warning, can't be emailed
broken[5][col('Designation')] = '';                        // Neha: missing designation -> warning
broken[7][col('Net Pay')] = null;                          // Tara: no net pay -> BLOCKING
broken[8][col('Employee ID')] = '20101';                   // Kunal reuses Aarav's ID -> BLOCKING (both rows)
broken[9][col('Official Email ID')] = 'priya.sengupta@';   // Priya: malformed email -> warning
await build(broken, { master: [['20102', 'Meera Nair', '', 'meera.nair.personal@keystone.test']] })
  .xlsx.writeFile(path.join(outDir, 'test-payroll-aug-2026-with-issues.xlsx'));

console.log(`Wrote test workbooks to ${outDir}`);
