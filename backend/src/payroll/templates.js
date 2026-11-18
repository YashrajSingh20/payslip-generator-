import { formatPaise } from './format.js';
import { periodParts } from './values.js';

export const TEMPLATE_TOKENS = ['Name', 'EmployeeID', 'Month', 'Year', 'NetPay', 'Currency', 'Designation'];

export function tokensFor(payslip, run) {
  const { month, year } = periodParts(run.period);
  return {
    Name: payslip.fullName,
    EmployeeID: payslip.employeeCode,
    Month: month,
    Year: year,
    NetPay: formatPaise(payslip.netPayPaise ?? payslip.data?.netPay),
    Currency: run.branding.currencyPrefix,
    Designation: payslip.designation,
  };
}

/** Replaces {Token} placeholders. Unknown tokens are left untouched. */
export function renderTemplate(template, tokens) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in tokens ? String(tokens[key] ?? '') : match));
}

const fileSafe = (value) =>
  String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, '_');

/** 'Payslip_{Month}_{Year}_{EmployeeID}_{Name}.pdf' -> 'Payslip_July_2026_10003_Manmohan_Thakur.pdf' */
export function payslipFileName(pattern, tokens) {
  const safeTokens = Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, fileSafe(v)]));
  let name = renderTemplate(pattern, safeTokens).replace(/[\\/:*?"<>|]/g, '').trim();
  if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
  return name.length > 180 ? `${name.slice(0, 176)}.pdf` : name;
}
