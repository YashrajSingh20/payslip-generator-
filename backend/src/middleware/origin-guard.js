import { HttpError } from '../http-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence: any state-changing request must carry an Origin header from the
 * allowed frontend origins. Browsers always send Origin on cross-site POSTs.
 */
export function createOriginGuard(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin || !allowed.has(origin)) {
      return next(new HttpError(403, 'Request origin is not allowed', 'origin_not_allowed'));
    }
    next();
  };
}
