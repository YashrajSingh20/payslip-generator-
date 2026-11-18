/**
 * Fixed-window in-memory limiter, per process. It is a first line of defence for
 * unauthenticated endpoints; the per-email OTP limit is enforced in the DB.
 */
export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map();

  function sweep(t) {
    if (hits.size < 10_000) return;
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
  }

  return {
    /** Returns true when the call is allowed. */
    hit(key) {
      const t = now();
      sweep(t);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    },
  };
}
