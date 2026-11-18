import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildMimeMessage, formatAddress } from './mime.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const REQUEST_TIMEOUT_MS = 20_000;

export class MailError extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.name = 'MailError';
    this.retryable = retryable;
  }
}

/** Gmail API sender using an OAuth2 refresh token. Access tokens are cached until shortly before expiry. */
export function createGmailMailer(gmail, { fetchImpl = fetch } = {}) {
  let cached = null;

  async function accessToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: gmail.clientId,
        client_secret: gmail.clientSecret,
        refresh_token: gmail.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      // invalid_grant means the refresh token is revoked: retrying will not help.
      throw new MailError(`Gmail token refresh failed: ${body.error ?? response.status}`, { retryable: body.error !== 'invalid_grant' });
    }
    cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  return {
    provider: 'gmail',
    async send({ fromName, to, subject, text, html, attachments }) {
      const raw = buildMimeMessage({
        from: formatAddress(fromName || gmail.senderName, gmail.senderEmail),
        to,
        subject,
        text,
        html,
        attachments,
      });
      const response = await fetchImpl(SEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) cached = null;
        const retryable = response.status === 401 || response.status === 429 || response.status >= 500;
        throw new MailError(`Gmail send failed (${response.status}): ${body.error?.message ?? 'unknown error'}`, { retryable });
      }
      return { messageId: body.id };
    },
  };
}

/** Local development: writes each message as an .eml file instead of sending it. */
export function createDevMailer(logger, { dir = path.resolve('.dev-mail') } = {}) {
  return {
    provider: 'dev-mock',
    async send({ fromName, to, subject, text, html, attachments }) {
      const raw = buildMimeMessage({ from: formatAddress(fromName, 'payroll@localhost'), to, subject, text, html, attachments });
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}_${to.replace(/[^a-z0-9@._-]/gi, '_')}.eml`);
      await writeFile(file, raw);
      logger.info('dev_email_written', { to, subject, file });
      return { messageId: `dev-${Date.now()}` };
    },
  };
}

/** Returns the configured mailer, or null when email is not configured. */
export function createMailer(config, logger) {
  if (config.gmail.enabled) return createGmailMailer(config.gmail);
  if (config.dev.emailMock) return createDevMailer(logger);
  return null;
}
