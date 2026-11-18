#!/usr/bin/env node
// Writes samples/sample-payroll-register.xlsx: a fake July 2026 register plus an
// "Employee Master" sheet, with a few deliberate gaps to exercise the audit.
//   node backend/scripts/make-sample-workbook.mjs [output-path]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const out = path.resolve(process.argv[2] ?? 'samples/sample-payroll-register.xlsx');

const employees = [
  ['10001', 'Riya Sharma', 'Brand Manager', '2025-04-01', 120000, 31, 0, 0, 'riya.sharma@keystone.test'],
  ['10002', 'Kabir Mehta', 'Operations Lead', '2025-05-12', 95000, 31, 1, 0, 'kabir.mehta@keystone.test'],
  ['10003', 'Manmohan Thakur', 'Warehouse Supervisor', '2025-06-02', 42000, 29, 0, 2, 'manmohan.thakur@keystone.test'],
  ['10004', 'Ananya Iyer', 'Performance Marketer', '2025-08-18', 78000, 31, 2, 0, ''],
  ['10005', 'Dev Patel', 'Customer Experience Associate', '2026-07-10', 30000, 22, 0, 0, 'dev.patel@keystone.test'],
  ['10006', 'Sana Qureshi', 'Finance Executive', '2025-11-03', 55000, 31, 0, 0, 'sana.qureshi@keystone.test'],
];

const workbook = new ExcelJS.Workbook();
const register = workbook.addWorksheet('PR-Jul-2026');
register.addRow([
  'Employee ID', 'Full Name', 'Designation', 'Joining Date', 'Month Start Date', 'Payroll Date', 'Total Working Days',
  'Paid Leaves', 'LOP', 'Days in Month', '% of Salary', 'CTC', 'Basic', 'HRA', 'Monthly Allowance', 'LTA',
  'Performance Based Pay', 'Telphone Allowance', 'Fuel Allowance', 'Special Bonus', 'PF Employee', 'Professional Tax',
  'TDS', 'Opening Advance', 'Advance Deducted', 'Closing Advance', 'Net Pay', 'Official Email ID',
]);

const r2 = (n) => Math.round(n * 100) / 100;
for (const [id, name, role, joined, ctc, worked, paidLeave, lop, email] of employees) {
  const start = new Date(Date.UTC(2026, 6, 1));
  const pct = r2(worked / 31);
  const basic = ctc * 0.5;
  const hra = ctc * 0.2;
  const allowance = ctc * 0.15;
  const lta = ctc * 0.05;
  const perf = ctc * 0.05;
  const phone = 1000;
  const fuel = ctc * 0.05 - 1000;
  const gross = (basic + hra + allowance + lta + perf + phone + fuel) * pct;
  const pf = Math.min(basic * pct * 0.12, 1800);
  const pt = 200;
  const tds = ctc > 90000 ? r2(ctc * 0.08) : 0;
  const advance = id === '10003' ? 5000 : 0;
  const advanceDeducted = id === '10003' ? 2500 : 0;
  const net = r2(gross - pf - pt - tds - advanceDeducted);
  register.addRow([
    id, name, id === '10006' ? '' : role, new Date(`${joined}T00:00:00Z`), start, new Date(Date.UTC(2026, 6, 31)),
    worked, paidLeave, lop, 31, pct, ctc, basic, hra, allowance, lta, perf, phone, fuel, 0, r2(pf), pt, tds,
    advance, advanceDeducted, advance - advanceDeducted, net, email,
  ]);
}
register.getRow(1).font = { bold: true };
['D', 'E', 'F'].forEach((c) => (register.getColumn(c).numFmt = 'dd-mm-yyyy'));

const master = workbook.addWorksheet('Employee Master');
master.addRow(['Employee ID', 'Full Name', 'Official Email ID', 'Personal Email ID']);
master.addRow(['10004', 'Ananya Iyer', '', 'ananya.iyer@example.test']);
master.addRow(['10006', 'Sana Qureshi', 'sana.qureshi@keystone.test', '']);

await mkdir(path.dirname(out), { recursive: true });
await workbook.xlsx.writeFile(out);
console.log(`Wrote ${out}`);
