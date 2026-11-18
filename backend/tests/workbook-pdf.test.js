import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { renderPayslipPdf, pdfSafe } from '../src/payroll/pdf.js';
import { cellToPrimitive, readWorkbook } from '../src/payroll/workbook.js';
import { uniqueNames } from '../src/services/payroll-service.js';
import { createRateLimiter } from '../src/auth/rate-limit.js';

async function workbookBuffer(build) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('readWorkbook', () => {
  it('finds the header row below a title and keeps date cells as calendar dates', async () => {
    const buffer = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet('PR-Jul-2026');
      ws.addRow(['Keystone payroll register July 2026']);
      ws.addRow([]);
      ws.addRow(['Employee ID', 'Full Name', 'Payroll Date', 'Net Pay', 'Net Pay']);
      ws.addRow(['10001', 'Asha', new Date(Date.UTC(2026, 6, 31)), { formula: '1000+1', result: 1001 }, 5]);
      ws.addRow([null, null, null, null, null]);
      wb.addWorksheet('Hidden').state = 'hidden';
    });
    const [sheet, ...rest] = await readWorkbook(buffer, { maxRowsPerSheet: 100 });
    assert.equal(rest.length, 0, 'hidden sheets are skipped');
    assert.equal(sheet.headerRowNumber, 3);
    assert.deepEqual(sheet.headers, ['Employee ID', 'Full Name', 'Payroll Date', 'Net Pay', 'Net Pay (2)']);
    assert.equal(sheet.rows.length, 1);
    assert.deepEqual(sheet.rows[0].values, {
      'Employee ID': '10001', 'Full Name': 'Asha', 'Payroll Date': '2026-07-31', 'Net Pay': 1001, 'Net Pay (2)': 5,
    });
  });

  it('rejects files that are not workbooks', async () => {
    await assert.rejects(readWorkbook(Buffer.from('not a zip'), { maxRowsPerSheet: 10 }), { code: 'invalid_workbook' });
  });

  it('enforces the row limit', async () => {
    const buffer = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet('S');
      ws.addRow(['Employee ID']);
      for (let i = 0; i < 5; i += 1) ws.addRow([String(i)]);
    });
    await assert.rejects(readWorkbook(buffer, { maxRowsPerSheet: 3 }), { code: 'too_many_rows' });
  });

  it('flattens rich text, hyperlinks and errors', () => {
    assert.equal(cellToPrimitive({ richText: [{ text: 'a' }, { text: 'b' }] }), 'ab');
    assert.equal(cellToPrimitive({ text: 'x@y.in', hyperlink: 'mailto:x@y.in' }), 'x@y.in');
    assert.equal(cellToPrimitive({ error: '#REF!' }), null);
  });
});

describe('renderPayslipPdf', () => {
  it('renders a one-page A4 PDF even with missing values and non-Latin text', async () => {
    const bytes = await renderPayslipPdf(
      { employeeCode: '1', fullName: 'Ravi कुमार', designation: '', data: { name: 'Ravi कुमार', netPay: 100000, amountWords: '' } },
      { period: '2026-07', branding: { companyName: 'Co', cin: '', currencyPrefix: '₹', footerText: '' } },
    );
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    const { width, height } = doc.getPage(0).getSize();
    assert.equal(Math.round(width), 595);
    assert.equal(Math.round(height), 842);
  });

  it('replaces control characters and glyphs the font lacks', () => {
    const supported = new Set(Array.from('₹ab ').map((ch) => ch.codePointAt(0)));
    assert.equal(pdfSafe('₹ab', supported), '₹ab');
    assert.equal(pdfSafe('aकb', supported), 'a?b');
    assert.equal(pdfSafe('a\u0007b'), 'a b');
  });

  it('renders every earnings, deduction and advance row, including zeros', async () => {
    const bytes = await renderPayslipPdf(
      { employeeCode: '1', fullName: 'Asha', designation: 'Lead', data: { name: 'Asha', basic: 1000000, basicPayable: 1000000, specialBonus: 0, netPay: 900000 } },
      { period: '2026-07', branding: { companyName: 'Co', cin: '', currencyPrefix: '₹', footerText: '' } },
    );
    assert.ok(bytes.length > 1000);
  });
});

describe('helpers', () => {
  it('de-duplicates zip entry names', () => {
    assert.deepEqual(uniqueNames(['a.pdf', 'A.pdf', 'b.pdf', 'a.pdf']), ['a.pdf', 'A (2).pdf', 'b.pdf', 'a (3).pdf']);
  });

  it('rate limiter resets after its window', () => {
    let t = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => t });
    assert.equal(limiter.hit('ip'), true);
    assert.equal(limiter.hit('ip'), true);
    assert.equal(limiter.hit('ip'), false);
    t = 1001;
    assert.equal(limiter.hit('ip'), true);
  });
});
