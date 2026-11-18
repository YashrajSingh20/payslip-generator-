import { randomBytes } from 'node:crypto';

const encodeHeader = (value) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();

const stripCrlf = (value) => String(value).replace(/[\r\n]+/g, ' ');

/** Quoted display name + address, e.g. "Keystone Payroll" <payroll@x.in> */
export function formatAddress(name, email) {
  const safeName = stripCrlf(name).replace(/["\\]/g, '');
  return safeName ? `${encodeHeader(`"${safeName}"`)} <${stripCrlf(email)}>` : stripCrlf(email);
}

/**
 * Builds an RFC 5322 message with a plain-text body, an HTML body and optional
 * attachments: [{ filename, contentType, content: Uint8Array | Buffer }].
 */
export function buildMimeMessage({ from, to, subject, text, html, attachments = [] }) {
  const mixed = `mixed_${randomBytes(12).toString('hex')}`;
  const alt = `alt_${randomBytes(12).toString('hex')}`;
  const lines = [
    `From: ${from}`,
    `To: ${stripCrlf(to)}`,
    `Subject: ${encodeHeader(stripCrlf(subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text, 'utf8').toString('base64')),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html ?? text, 'utf8').toString('base64')),
    `--${alt}--`,
  ];
  for (const a of attachments) {
    const filename = stripCrlf(a.filename).replace(/"/g, '');
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(Buffer.from(a.content).toString('base64')),
    );
  }
  lines.push(`--${mixed}--`, '');
  return lines.join('\r\n');
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Wraps a plain-text body in a minimal, client-safe HTML layout. */
export function textToHtml(text) {
  const body = escapeHtml(text).replace(/\r?\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#faf6f2;font-family:Arial,Helvetica,sans-serif;color:#2c201b;font-size:14px;line-height:1.6"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #eadfd6;border-radius:8px;padding:28px"><div style="height:4px;background:#fa4b12;margin:-28px -28px 24px;border-radius:8px 8px 0 0"></div>${body}</div></body></html>`;
}
