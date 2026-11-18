import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { signSession } from '../auth/jwt.js';
import { HttpError } from '../http-error.js';
import { textToHtml } from '../email/mime.js';

const DEV_OTP = '123456';

export function createAuthService({ database, config, mailer, logger }) {
  const hashCode = (email, code) => createHmac('sha256', config.auth.jwtSecret).update(`${email}:${code}`).digest('hex');

  async function sendOtp(email) {
    const { rows: recent } = await database.query(
      `SELECT count(*)::int AS n FROM auth_otps WHERE email = $1 AND created_at > now() - interval '15 minutes'`,
      [email],
    );
    if (recent[0].n >= config.auth.otpMaxRequestsPer15Min) {
      throw new HttpError(429, 'Too many codes requested. Please wait a few minutes and try again.', 'otp_rate_limited');
    }

    const { rows } = await database.query('SELECT name FROM users WHERE email = $1 AND is_active', [email]);
    const user = rows[0];
    // Same response whether or not the address has an account, so the endpoint
    // cannot be used to discover who has access.
    if (!user) {
      logger.info('otp_requested_unknown_email');
      return;
    }

    const code = config.dev.authBypass ? DEV_OTP : String(randomInt(0, 1_000_000)).padStart(6, '0');
    await database.query(
      `INSERT INTO auth_otps (email, code_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [email, hashCode(email, code), config.auth.otpTtlMinutes],
    );

    if (config.dev.authBypass) {
      logger.info('dev_otp_issued', { email, code });
      return;
    }
    if (!mailer) throw new HttpError(503, 'Email is not configured, so sign-in codes cannot be sent.', 'email_unavailable');

    // Sent directly rather than through the outbox: the code must not be stored
    // in plain text, and it is useless once it is late.
    const text = `Hi ${user.name},\n\nYour Keystone Payroll sign-in code is ${code}.\n\nIt expires in ${config.auth.otpTtlMinutes} minutes. If you did not ask for it, you can ignore this email.`;
    await mailer.send({
      fromName: config.gmail.senderName || 'Keystone Payroll',
      to: email,
      subject: `${code} is your Keystone Payroll sign-in code`,
      text,
      html: textToHtml(text),
    });
  }

  async function verifyOtp(email, code) {
    return database.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, code_hash, attempts FROM auth_otps
          WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1
          FOR UPDATE`,
        [email],
      );
      const otp = rows[0];
      const invalid = new HttpError(400, 'That code is incorrect or has expired.', 'otp_invalid');
      if (!otp) throw invalid;
      if (otp.attempts >= config.auth.otpMaxAttempts) {
        throw new HttpError(429, 'Too many incorrect attempts. Request a new code.', 'otp_locked');
      }

      const expected = Buffer.from(otp.code_hash, 'hex');
      const actual = Buffer.from(hashCode(email, code), 'hex');
      if (!timingSafeEqual(expected, actual)) {
        await tx.query('UPDATE auth_otps SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
        return { error: invalid };
      }

      await tx.query('UPDATE auth_otps SET consumed_at = now() WHERE id = $1', [otp.id]);
      const { rows: users } = await tx.query(
        `UPDATE users SET last_login_at = now() WHERE email = $1 AND is_active RETURNING id, session_version`,
        [email],
      );
      if (!users[0]) throw invalid;
      const token = await signSession(
        { userId: users[0].id, sessionVersion: users[0].session_version },
        config.auth.jwtSecret,
        config.auth.sessionTtlDays * 86_400,
      );
      return { token };
    }).then((result) => {
      // The failed-attempt counter must be committed before the error is raised.
      if (result.error) throw result.error;
      return result.token;
    });
  }

  return { sendOtp, verifyOtp };
}

export function serializeActor(actor) {
  return { id: actor.id, email: actor.email, name: actor.name, permissions: [...actor.permissions].sort() };
}
