/** An expected failure that is safe to show to the client. */
export class HttpError extends Error {
  constructor(status, message, code = defaultCode(status)) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function defaultCode(status) {
  return (
    {
      400: 'bad_request',
      401: 'unauthenticated',
      403: 'forbidden',
      404: 'not_found',
      409: 'conflict',
      413: 'payload_too_large',
      422: 'unprocessable',
      429: 'rate_limited',
      503: 'unavailable',
    }[status] ?? 'error'
  );
}

export const badRequest = (message, code) => new HttpError(400, message, code);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message, code) => new HttpError(409, message, code);
