export const SESSION_COOKIE = 'kp_session';

export function readCookie(req, name) {
  const header = req.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cookieOptions(config) {
  return { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' };
}

export function setSessionCookie(res, token, config) {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(config),
    maxAge: config.auth.sessionTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res, config) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(config));
}
