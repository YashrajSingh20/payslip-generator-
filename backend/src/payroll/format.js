// Display formatting shared by the PDF renderer and email templates.

const MONEY = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12345678 paise -> '1,23,456.78'. Null -> '-'. */
export function formatPaise(paise) {
  if (paise === null || paise === undefined) return '-';
  return MONEY.format(paise / 100);
}

export function formatPercent(fraction) {
  if (fraction === null || fraction === undefined) return '-';
  return `${(fraction * 100).toFixed(2)}%`;
}

export function formatNumber(n) {
  if (n === null || n === undefined) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

/** 'YYYY-MM-DD' -> 'DD-MM-YY' as on the approved payslip. */
export function formatDate(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y.slice(2)}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const twoDigits = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
const threeDigits = (n) =>
  n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${twoDigits(n % 100)}` : ''}` : twoDigits(n);

function integerWords(n) {
  const parts = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${integerWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(' ');
}

/** Indian-system words for a paise amount. Text only: it never changes the amount. */
export function amountInWords(paise) {
  if (paise === null || paise === undefined) return '';
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  let words = `Rupees ${rupees ? integerWords(rupees) : 'Zero'}`;
  if (remainder) words += ` and ${twoDigits(remainder)} Paise`;
  return `${negative ? 'Minus ' : ''}${words} Only`;
}
