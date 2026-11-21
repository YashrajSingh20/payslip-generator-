import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { FIELDS, detectColumns } from '../src/payroll/fields.js';
import { buildPayslips } from '../src/payroll/normalize.js';
import { readWorkbook } from '../src/payroll/workbook.js';
import { DEMO_PAYSLIP } from '../../app/lib/demo-payslip.js';

const template = new URL('../../public/templates/Keystone_Payroll_Template.xlsx', import.meta.url);

test('downloadable payroll template has all recognised fields and no sample employee rows', async () => {
  const bytes = await readFile(template);
  assert.ok(bytes.length < 4 * 1024 * 1024);
  const sheets = await readWorkbook(bytes, { maxRowsPerSheet: 5000 });
  const register = sheets.find(s => s.name === 'Payroll Register');
  assert.ok(register);
  assert.equal(register.rows.length, 0);
  const mapping = detectColumns(register.headers);
  for (const field of FIELDS) assert.ok(mapping[field.key], `Missing ${field.label}`);
  assert.ok(sheets.some(s => s.name === 'Instructions'));
});

test('filled template imports one employee with the expected payslip totals', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(template));
  const register = workbook.getWorksheet('Payroll Register');
  const byLabel = new Map(FIELDS.flatMap(f => [f.label, ...f.aliases].map(label => [label, f])));
  register.getRow(1).eachCell((cell, column) => {
    const field = byLabel.get(cell.value);
    const value = DEMO_PAYSLIP.data[field.key] ?? null;
    register.getRow(2).getCell(column).value = field.type === 'money' && value !== null ? value / 100 : value;
  });
  const sheets = await readWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), { maxRowsPerSheet: 5000 });
  const sheet = sheets.find(s => s.name === 'Payroll Register');
  const slips = buildPayslips({ sheet, mapping: detectColumns(sheet.headers) });
  assert.equal(slips.length, 1);
  assert.equal(slips[0].fullName, DEMO_PAYSLIP.fullName);
  assert.equal(slips[0].data.grossEarnings, 6000000);
  assert.equal(slips[0].data.totalDeductions, 300000);
  assert.equal(slips[0].netPayPaise, 5700000);
  assert.equal(slips[0].blockingIssueCount, 0);
});
