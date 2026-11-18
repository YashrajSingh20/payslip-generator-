import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'keystone-payroll';
const ALG = 'HS256';

const keyCache = new Map();
function keyFor(secret) {
  if (!keyCache.has(secret)) keyCache.set(secret, new TextEncoder().encode(secret));
  return keyCache.get(secret);
}

/** The token carries identity only. Permissions are read from the DB per request. */
export async function signSession({ userId, sessionVersion }, secret, ttlSeconds) {
  return new SignJWT({ sv: sessionVersion })
    .setProtectedHeader({ alg: ALG })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(keyFor(secret));
}

/** Returns { userId, sessionVersion, issuedAt } or null for any invalid token. */
export async function verifySession(token, secret) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), { issuer: ISSUER, algorithms: [ALG] });
    if (typeof payload.sub !== 'string' || !Number.isInteger(payload.sv)) return null;
    return { userId: payload.sub, sessionVersion: payload.sv, issuedAt: payload.iat };
  } catch {
    return null;
  }
}
