import { DEDUCTIONS, EARNINGS, FIELD_BY_KEY, FIELDS } from './fields.js';
import { amountInWords, formatPaise } from './format.js';
import { isBlank, isEmail, PARSERS } from './values.js';

export const SEVERITY = Object.freeze({ BLOCKING: 'blocking', WARNING: 'warning', INFO: 'info' });

/** Parses one sheet row into typed payslip fields using the column mapping. */
export function parseRow(values, mapping) {
  const data = {};
  const invalid = [];
  for (const field of FIELDS) {
    const header = mapping[field.key];
    const raw = header ? values[header] : null;
    const parsed = PARSERS[field.type](raw);
    data[field.key] = parsed.value;
    if (parsed.invalid) invalid.push({ key: field.key, raw });
  }
  return { data, invalid };
}

/**
 * Fills only what the register did not supply; a value present in the sheet
 * always wins. Every derived field is recorded so the UI can flag it.
 *
 *   payable          = monthly rate x % of salary (100% when % is blank)
 *   gross earnings   = sum of payable earnings
 *   total deductions = PF + professional tax + TDS + advance deducted
 *   amount in words  = words for the Excel net pay
 *
 * Net pay is never calculated.
 */
export function deriveMissing(data) {
  const derived = [];
  const pct = data.pctSalary ?? 1;

  for (const [rateKey, payableKey] of EARNINGS) {
    if (data[payableKey] === null && data[rateKey] !== null) {
      data[payableKey] = Math.round(data[rateKey] * pct);
      derived.push(payableKey);
    }
  }

  if (data.grossEarnings === null) {
    const payables = EARNINGS.map(([, k]) => data[k]).filter((v) => v !== null);
    if (payables.length) {
      data.grossEarnings = payables.reduce((a, b) => a + b, 0);
      derived.push('grossEarnings');
    }
  }

  if (data.totalDeductions === null) {
    const deductions = DEDUCTIONS.map(([k]) => data[k]).filter((v) => v !== null);
    if (deductions.length) {
      data.totalDeductions = deductions.reduce((a, b) => a + b, 0);
      derived.push('totalDeductions');
    }
  }

  if (!data.amountWords && data.netPay !== null) {
    data.amountWords = amountInWords(data.netPay);
    derived.push('amountWords');
  }

  return derived;
}

export function chooseRecipient({ officialEmail, personalEmail }, preference) {
  const [first, second] = preference === 'personal' ? [personalEmail, officialEmail] : [officialEmail, personalEmail];
  return first || second || null;
}

const issue = (severity, check, detail, field = null) => ({ severity, check, detail, ...(field && { field }) });

/** Differences up to ₹1 are rounding, not a mismatch. */
const NET_PAY_TOLERANCE_PAISE = 100;

/** Fields a payroll manager may correct on a draft run: only those the audit can block or warn on. */
export const CORRECTABLE_FIELDS = ['employeeId', 'name', 'designation', 'netPay', 'officialEmail', 'personalEmail'];

/**
 * Source-completeness checks for one payslip.
 *
 * @param data            typed payslip fields (after directory fill and derivation)
 * @param invalidKeys     fields whose Excel cell could not be read
 * @param derived         fields the app computed
 * @param duplicateCount  rows in the run sharing this Employee ID
 * @param edits           corrections made in the app [{ field, from, to, by, at }]
 */
export function auditPayslip({ data, invalidKeys = [], derived = [], duplicateCount = 1, edits = [], preference = 'official' }) {
  const issues = [];
  for (const key of invalidKeys) {
    const field = FIELD_BY_KEY.get(key);
    if (field) issues.push(issue(SEVERITY.WARNING, `Unreadable ${field.label}`, `The Excel value is not a valid ${field.type}; shown as blank.`, key));
  }

  const recipient = chooseRecipient(data, preference);

  if (duplicateCount > 1) issues.push(issue(SEVERITY.BLOCKING, 'Duplicate Employee ID', `${data.employeeId} appears ${duplicateCount} times in this run.`, 'employeeId'));
  if (!data.name) issues.push(issue(SEVERITY.BLOCKING, 'Missing Full Name', 'Full Name is blank in Excel and the employee directory.', 'name'));
  if (data.netPay === null) issues.push(issue(SEVERITY.BLOCKING, 'Missing Net Pay', 'Net Pay is not in Excel. It is never calculated, so this payslip cannot be issued.', 'netPay'));
  else if (data.netPay < 0) issues.push(issue(SEVERITY.BLOCKING, 'Negative Net Pay', 'Net Pay is below zero.', 'netPay'));

  // Excel may carry adjustments the register doesn't itemise, so this warns rather than blocks.
  const expected = data.grossEarnings !== null && data.totalDeductions !== null ? data.grossEarnings - data.totalDeductions : null;
  if (data.netPay !== null && data.netPay >= 0 && expected !== null && Math.abs(data.netPay - expected) > NET_PAY_TOLERANCE_PAISE) {
    issues.push(issue(SEVERITY.WARNING, 'Net Pay mismatch',
      `Net Pay is ₹${formatPaise(data.netPay)} but Gross Earnings minus Total Deductions is ₹${formatPaise(expected)}.`, 'netPay'));
  }

  const emailField = preference === 'personal' ? 'personalEmail' : 'officialEmail';
  if (!recipient) issues.push(issue(SEVERITY.WARNING, 'Missing email', 'No official or personal email for this Employee ID. The payslip cannot be emailed.', emailField));
  else if (!isEmail(recipient)) {
    const bad = recipient === data.officialEmail ? 'officialEmail' : 'personalEmail';
    issues.push(issue(SEVERITY.WARNING, 'Invalid email', `${recipient} is not a valid address.`, bad));
  }
  if (!data.designation) issues.push(issue(SEVERITY.WARNING, 'Missing Designation', 'Designation is blank.', 'designation'));

  const derivedPayables = derived.filter((k) => k.endsWith('Payable'));
  if (derivedPayables.length) {
    issues.push(issue(SEVERITY.INFO, 'Payable amounts derived', `${derivedPayables.length} payable amount(s) computed as monthly rate x % of salary.`));
  }
  if (derived.includes('grossEarnings')) issues.push(issue(SEVERITY.INFO, 'Gross Earnings derived', 'Computed as the sum of payable earnings.'));
  if (derived.includes('totalDeductions')) issues.push(issue(SEVERITY.INFO, 'Total Deductions derived', 'Computed as PF + Professional Tax + TDS + Advance Deducted.'));
  if (edits.length) {
    const labels = [...new Set(edits.map((e) => FIELD_BY_KEY.get(e.field)?.label ?? e.field))];
    const who = [...new Set(edits.map((e) => e.by?.name).filter(Boolean))];
    issues.push(issue(SEVERITY.INFO, 'Corrected in app', `${labels.join(', ')} changed${who.length ? ` by ${who.join(', ')}` : ''}; differs from the Excel file.`));
  }

  return {
    issues,
    recipient: recipient && isEmail(recipient) ? recipient : null,
    blockingIssueCount: issues.filter((i) => i.severity === SEVERITY.BLOCKING).length,
    warningIssueCount: issues.filter((i) => i.severity === SEVERITY.WARNING).length,
  };
}

/**
 * Turns a parsed sheet into payslip records plus a source-completeness audit.
 *
 * @param sheet       { name, rows: [{ rowNumber, values }] }
 * @param mapping     { fieldKey: header | null }
 * @param directory   Map<employeeCode, { fullName, designation, joiningDate, exitDate, officialEmail, personalEmail }>
 *                    used to fill blanks (workbook master sheet first, then the employee directory)
 * @param preference  'official' | 'personal'
 */
export function buildPayslips({ sheet, mapping, directory = new Map(), preference = 'official' }) {
  const rows = sheet.rows.filter((r) => !isBlank(mapping.employeeId ? r.values[mapping.employeeId] : null));
  const parsed = rows.map((row) => ({ row, ...parseRow(row.values, mapping) }));

  const idCounts = new Map();
  for (const p of parsed) {
    const id = p.data.employeeId ?? '';
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  return parsed.map(({ row, data, invalid }) => {
    const known = directory.get(data.employeeId) ?? {};
    for (const key of ['name', 'designation', 'joiningDate', 'exitDate', 'officialEmail', 'personalEmail', 'pan', 'uan']) {
      const directoryKey = key === 'name' ? 'fullName' : key;
      if (data[key] === null && known[directoryKey]) data[key] = known[directoryKey];
    }

    const derived = deriveMissing(data);
    const audit = auditPayslip({
      data, invalidKeys: invalid.map((i) => i.key), derived, duplicateCount: idCounts.get(data.employeeId), preference,
    });

    return {
      rowNumber: row.rowNumber,
      employeeCode: data.employeeId,
      fullName: data.name ?? '',
      designation: data.designation ?? '',
      recipientEmail: audit.recipient,
      netPayPaise: data.netPay,
      grossEarningsPaise: data.grossEarnings,
      totalDeductionsPaise: data.totalDeductions,
      data,
      derivedFields: derived,
      issues: audit.issues,
      blockingIssueCount: audit.blockingIssueCount,
      warningIssueCount: audit.warningIssueCount,
      sourceRow: row.values,
    };
  });
}

/** Most common payroll month among the rows ('YYYY-MM'), or null. */
export function suggestPeriod(payslipsOrData, sheetName = '') {
  const counts = new Map();
  for (const item of payslipsOrData) {
    const data = item.data ?? item;
    const date = data.payrollDate ?? data.monthStart;
    if (date) counts.set(date.slice(0, 7), (counts.get(date.slice(0, 7)) ?? 0) + 1);
  }
  if (counts.size) return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const match = sheetName.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_-]*'?(\d{2,4})/i);
  if (!match) return null;
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[1].toLowerCase()) + 1;
  const year = match[2].length === 2 ? `20${match[2]}` : match[2];
  return `${year}-${String(month).padStart(2, '0')}`;
}
