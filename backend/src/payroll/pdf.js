import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, popGraphicsState, pushGraphicsState, rgb, setCharacterSpacing } from 'pdf-lib';
import { DEDUCTIONS, EARNINGS } from './fields.js';
import { formatNumber, formatPaise, formatPercent } from './format.js';
import { monthName, periodParts } from './values.js';

// A4 in points.
const W = 595.28;
const H = 841.89;
const MX = 40;
const CW = W - MX * 2;

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ember: hex('#fa4b12'),
  cocoa: hex('#351707'),
  ink: hex('#1d1511'),
  ink2: hex('#4b403a'),
  muted: hex('#8b7f77'),
  line: hex('#ebe4dd'),
  cream: hex('#faf6f1'),
  sand: hex('#f2ece5'),
  white: rgb(1, 1, 1),
};

const ASSETS = new URL('../../assets/', import.meta.url);
let assets;
function loadAssets() {
  assets ??= {
    keystone: readFileSync(new URL('logo-keystone.png', ASSETS)),
    liwip: readFileSync(new URL('logo-liwip-light.png', ASSETS)),
    regular: readFileSync(new URL('fonts/PlusJakartaSans-Regular.ttf', ASSETS)),
    medium: readFileSync(new URL('fonts/PlusJakartaSans-Medium.ttf', ASSETS)),
    semibold: readFileSync(new URL('fonts/PlusJakartaSans-SemiBold.ttf', ASSETS)),
    bold: readFileSync(new URL('fonts/PlusJakartaSans-Bold.ttf', ASSETS)),
  };
  return assets;
}

/** Strips control characters and replaces glyphs the font lacks (e.g. Devanagari) with '?'. */
export function pdfSafe(text, supported) {
  return Array.from(String(text ?? ''))
    .map((ch) => {
      const code = ch.codePointAt(0);
      if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return ' ';
      return !supported || supported.has(code) ? ch : '?';
    })
    .join('');
}

/** 'YYYY-MM-DD' -> '01 Jul 2026' */
function longDate(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d} ${monthName(iso).slice(0, 3)} ${y}`;
}

/** Pay period as one short phrase: '01 – 30 Sep 2026', or full dates across months. */
function periodRange(start, end) {
  if (!start || !end) return start || end ? longDate(start || end) : '-';
  if (start.slice(0, 7) === end.slice(0, 7)) return `${start.slice(8)} – ${longDate(end)}`;
  return `${longDate(start)} – ${longDate(end)}`;
}

const hasValue = (v) => v !== null && v !== undefined;

const embedImage = (doc, bytes) => (bytes[0] === 0xff && bytes[1] === 0xd8 ? doc.embedJpg(bytes) : doc.embedPng(bytes));

function createCanvas(page, fonts) {
  const toY = (top) => H - top;
  const supported = new Set(fonts.regular.getCharacterSet());

  function fit(str, font, size, maxWidth) {
    let s = pdfSafe(str, supported);
    if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
    return `${s.trimEnd()}…`;
  }

  const c = {
    /** Filled rectangle, optionally with rounded corners. */
    rect(x, top, w, h, { fill, radius = 0 } = {}) {
      if (!radius) {
        page.drawRectangle({ x, y: toY(top + h), width: w, height: h, color: fill });
        return;
      }
      const r = Math.min(radius, w / 2, h / 2);
      const path = `M ${x + r} ${top} H ${x + w - r} Q ${x + w} ${top} ${x + w} ${top + r} V ${top + h - r} Q ${x + w} ${top + h} ${x + w - r} ${top + h} H ${x + r} Q ${x} ${top + h} ${x} ${top + h - r} V ${top + r} Q ${x} ${top} ${x + r} ${top} Z`;
      page.drawSvgPath(path, { x: 0, y: H, color: fill });
    },
    line(x1, top, x2, { color = C.line, thickness = 0.6 } = {}) {
      page.drawLine({ start: { x: x1, y: toY(top) }, end: { x: x2, y: toY(top) }, thickness, color });
    },
    /** Draws text with its cap-top at `top`. Returns the text width. */
    text(str, x, top, { size = 8.5, weight = 'regular', color = C.ink, align = 'left', width = CW, tracking = 0 } = {}) {
      const font = fonts[weight];
      const s = fit(str, font, size, width - tracking * String(str ?? '').length);
      const tw = font.widthOfTextAtSize(s, size) + tracking * Math.max(0, s.length - 1);
      const dx = align === 'right' ? width - tw : align === 'center' ? (width - tw) / 2 : 0;
      if (tracking) page.pushOperators(pushGraphicsState(), setCharacterSpacing(tracking));
      page.drawText(s, { x: x + dx, y: toY(top + size * 0.74), size, font, color });
      if (tracking) page.pushOperators(popGraphicsState());
      return tw;
    },
    eyebrow(str, x, top, opts = {}) {
      return c.text(String(str).toUpperCase(), x, top, { size: 6.6, weight: 'semibold', color: C.muted, tracking: 0.9, ...opts });
    },
    image(img, x, top, w, h) {
      page.drawImage(img, { x, y: toY(top + h), width: w, height: h });
    },
  };
  return c;
}

/**
 * A titled list of amounts with column headers, thin separators and a total row.
 * Returns the y position below it.
 */
function amountTable(c, { x, top, width, title, columns, rows, total }) {
  const ROW_H = 17.5;
  const amountW = 86;
  const labelW = width - amountW * columns.length;

  c.text(title, x, top, { size: 10, weight: 'bold' });
  columns.forEach((col, i) => c.eyebrow(col, x + labelW + amountW * i, top + 2.5, { align: 'right', width: amountW }));
  let y = top + 18;
  c.line(x, y, x + width, { color: C.ink, thickness: 0.8 });

  if (!rows.length) {
    c.text('None', x, y + 6.5, { size: 8.5, color: C.muted });
    y += ROW_H;
    c.line(x, y, x + width);
  }
  for (const [label, ...amounts] of rows) {
    c.text(label, x, y + 5.8, { size: 8.4, color: C.ink2, width: labelW - 8 });
    amounts.forEach((v, i) => c.text(v, x + labelW + amountW * i, y + 5.8, { size: 8.4, weight: 'medium', align: 'right', width: amountW }));
    y += ROW_H;
    c.line(x, y, x + width);
  }
  if (total) {
    y += 4;
    c.rect(x, y, width, 22, { fill: C.cream, radius: 5 });
    c.text(total[0], x + 8, y + 7.2, { size: 8.8, weight: 'bold', width: labelW });
    c.text(total[1], x, y + 7.2, { size: 8.8, weight: 'bold', align: 'right', width: width - 8 });
    y += 22;
  }
  return y;
}

/**
 * Renders one payslip as a vector A4 PDF.
 * @param payslip { data, employeeCode, fullName, designation }
 * @param run     { period: 'YYYY-MM', branding: { companyName, cin, currencyPrefix, footerText },
 *                  logos?: { primary?: Buffer, secondary?: Buffer } }  uploaded PNG/JPEG logos;
 *                  the bundled Keystone and Liwip logos are used when absent.
 */
export async function renderPayslipPdf(payslip, run) {
  const d = payslip.data;
  const branding = run.branding;
  const { month, year } = periodParts(run.period);
  const prefix = branding.currencyPrefix || '₹';
  // Every component is printed; a blank cell reads as 0.00, like the source register.
  const money = (v) => formatPaise(v ?? 0);
  const cash = (v) => (hasValue(v) ? `${prefix}${prefix.length > 1 ? ' ' : ''}${formatPaise(v)}` : '-');

  const files = loadAssets();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Payslip ${month} ${year} - ${payslip.fullName || payslip.employeeCode}`);
  doc.setAuthor(branding.companyName);
  doc.setCreator('Keystone Payroll');
  doc.setProducer('Keystone Payroll');

  const page = doc.addPage([W, H]);
  const [regular, medium, semibold, bold, ksImg, liwipImg] = await Promise.all([
    doc.embedFont(files.regular, { subset: true }),
    doc.embedFont(files.medium, { subset: true }),
    doc.embedFont(files.semibold, { subset: true }),
    doc.embedFont(files.bold, { subset: true }),
    embedImage(doc, run.logos?.primary ?? files.keystone),
    embedImage(doc, run.logos?.secondary ?? files.liwip),
  ]);
  const c = createCanvas(page, { regular, medium, semibold, bold });

  // Header: brand bar, both logos.
  c.rect(0, 0, W, 5, { fill: C.ember });
  // Each logo fits a box, so an uploaded logo of any shape keeps the layout.
  const fit = (img, maxW, maxH) => {
    const scale = Math.min(maxW / img.width, maxH / img.height);
    return { w: img.width * scale, h: img.height * scale };
  };
  const ks = fit(ksImg, 190, 28);
  c.image(ksImg, MX, 30 + (28 - ks.h) / 2, ks.w, ks.h);
  const lw = fit(liwipImg, 150, 34);
  c.image(liwipImg, W - MX - lw.w, 27 + (34 - lw.h) / 2, lw.w, lw.h);

  // Title block.
  let y = 86;
  c.eyebrow('Salary slip', MX, y, { color: C.ember });
  c.text(`${month} ${year}`, MX, y + 12, { size: 22, weight: 'bold' });
  c.text(branding.companyName, MX + CW / 2, y, { size: 9, weight: 'semibold', align: 'right', width: CW / 2 });
  if (branding.cin) c.text(`CIN: ${branding.cin}`, MX + CW / 2, y + 14, { size: 7.4, color: C.muted, align: 'right', width: CW / 2 });
  if (branding.registeredOffice) {
    c.text(`Registered office: ${branding.registeredOffice}`, MX, y + 42, { size: 7.2, color: C.muted, align: 'right' });
  }
  y += branding.registeredOffice ? 58 : 52;
  c.line(MX, y, MX + CW);

  // Employee details: label/value pairs, four per row, in a soft panel.
  const details = [
    ['Employee ID', payslip.employeeCode],
    ['Employee name', d.name || payslip.fullName],
    ['Designation', d.designation || payslip.designation],
    ['Joining date', longDate(d.joiningDate)],
    ['Exit date', longDate(d.exitDate)],
    ['Payroll period', periodRange(d.monthStart, d.payrollDate)],
    ['Working days', formatNumber(d.workingDays)],
    ['Paid leaves / LOP', `${formatNumber(d.paidLeaves)} / ${formatNumber(d.lop)}`],
    ['PAN', d.pan ? d.pan.toUpperCase() : '-'],
    ['UAN', d.uan || '-'],
    ['Days in month', formatNumber(d.daysInMonth)],
    ['% of salary', formatPercent(d.pctSalary)],
  ];
  const COLS = 4;
  const rowsNeeded = Math.ceil(details.length / COLS);
  const PAD = 14;
  const cellW = (CW - PAD * 2) / COLS;
  const DETAIL_ROW = 29;
  y += 14;
  c.rect(MX, y, CW, PAD * 2 + rowsNeeded * DETAIL_ROW - 8, { fill: C.cream, radius: 8 });
  details.forEach(([label, value], i) => {
    const cx = MX + PAD + (i % COLS) * cellW;
    const cy = y + PAD + Math.floor(i / COLS) * DETAIL_ROW;
    c.eyebrow(label, cx, cy, { width: cellW - 10 });
    c.text(value || '-', cx, cy + 10, { size: 9.4, weight: 'semibold', width: cellW - 10 });
  });
  y += PAD * 2 + rowsNeeded * DETAIL_ROW - 8 + 14;

  // Net pay panel.
  const HERO_H = 86;
  c.rect(MX, y, CW, HERO_H, { fill: C.cocoa, radius: 10 });
  c.rect(MX, y + 14, 3, HERO_H - 28, { fill: C.ember });
  c.eyebrow('Net pay', MX + 20, y + 14, { color: hex('#c9b8ab') });
  c.text('AMOUNT IN WORDS', MX + 20, y + 55, { size: 6.2, weight: 'semibold', color: hex('#a8968a'), width: CW * 0.58, tracking: 0.7 });
  c.text(cash(d.netPay), MX + 20, y + 26, { size: 22, weight: 'bold', color: C.white, width: CW * 0.55 });
  c.text(d.amountWords || '-', MX + 20, y + 65, { size: 7.6, color: hex('#d9cbc0'), width: CW * 0.58 });
  const statX = MX + CW * 0.62;
  const statW = CW * 0.38 - 20;
  [['Monthly CTC', d.ctc], ['Gross earnings', d.grossEarnings], ['Total deductions', d.totalDeductions], ['Net payable', d.netPay]].forEach(([label, v], i) => {
    const sy = y + 15 + i * 16;
    c.text(label, statX, sy, { size: 8, color: hex('#c9b8ab'), width: statW });
    c.text(cash(v), statX, sy, { size: 9, weight: 'semibold', color: C.white, align: 'right', width: statW });
  });
  y += HERO_H + 18;

  // Earnings: every component, including zeros.
  const earningRows = EARNINGS.map(([rate, payable, label]) => [label, money(d[rate]), money(d[payable])]);
  y = amountTable(c, {
    x: MX, top: y, width: CW, title: 'Earnings',
    columns: ['Monthly rate', 'Payable amount'],
    rows: earningRows,
    total: ['Gross earnings', cash(d.grossEarnings)],
  });

  // Deductions and the advance summary side by side, every row always shown.
  y += 18;
  const deductionRows = DEDUCTIONS.map(([k, label]) => [label, money(d[k])]);
  const GAP = 20;
  const colW = (CW - GAP) / 2;
  const leftBottom = amountTable(c, {
    x: MX, top: y, width: colW, title: 'Deductions / Recoveries',
    columns: ['Amount'],
    rows: deductionRows,
    total: ['Total deductions', cash(d.totalDeductions)],
  });
  const rightBottom = amountTable(c, {
    x: MX + colW + GAP, top: y, width: colW, title: 'Advance summary',
    columns: ['Amount'],
    rows: [
      ['Opening Advance', money(d.openingAdvance)],
      ['Advance Deducted', money(d.advanceDeducted)],
      ['Closing Advance', money(d.closingAdvance)],
    ],
  });
  y = Math.max(leftBottom, rightBottom);

  // Footer.
  c.text('This is a computer-generated payslip and does not require a signature.', MX, H - 52, { size: 7, color: C.muted, align: 'center' });
  c.rect(0, H - 26, W, 26, { fill: C.cocoa });
  c.text(branding.companyName, MX, H - 16.5, { size: 7, color: hex('#d9cbc0'), width: CW / 2 });
  c.text(branding.footerText, MX + CW / 2, H - 16.5, { size: 7, color: hex('#d9cbc0'), align: 'right', width: CW / 2 });

  return doc.save();
}
