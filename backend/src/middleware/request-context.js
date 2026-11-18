import { randomUUID } from 'node:crypto';

const INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Gives each request an id and logs one structured line when it finishes. */
export function createRequestContext(logger) {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
    req.log = logger.child({ requestId: req.id });
    res.set('x-request-id', req.id);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/healthz') return;
      req.log.info('http_request', {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        userId: req.actor?.id,
      });
    });
    next();
  };
}
