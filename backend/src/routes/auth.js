import { Router } from 'express';
import { clearSessionCookie, setSessionCookie } from '../auth/cookies.js';
import { createRateLimiter } from '../auth/rate-limit.js';
import { HttpError } from '../http-error.js';
import { serializeActor } from '../services/auth-service.js';
import * as v from '../validate.js';

export function createAuthRouter({ auth, guard, config }) {
  const router = Router();
  const ipLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 30 });
  const limitIp = (req) => {
    if (!ipLimiter.hit(req.ip)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.', 'rate_limited');
  };

  router.post('/send-otp', async (req, res) => {
    limitIp(req);
    const email = v.email(v.body(req).email, 'Email');
    await auth.sendOtp(email);
    res.json({ ok: true });
  });

  router.post('/verify-otp', async (req, res) => {
    limitIp(req);
    const input = v.body(req);
    const email = v.email(input.email, 'Email');
    const code = v.string(input.code, 'Code', { max: 6 });
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the 6-digit code.', 'otp_invalid');
    const token = await auth.verifyOtp(email, code);
    setSessionCookie(res, token, config);
    const actor = await guard.loadActorFromToken(token);
    res.json({ user: serializeActor(actor) });
  });

  router.get('/me', async (req, res) => {
    const actor = await guard.requireUser(req);
    res.json({ user: serializeActor(actor) });
  });

  router.post('/logout', async (_req, res) => {
    clearSessionCookie(res, config);
    res.json({ ok: true });
  });

  return router;
}
