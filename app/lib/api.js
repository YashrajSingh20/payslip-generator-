// The only fetch wrapper in the app. Every request is same-origin /api/*.

const DEFAULT_TIMEOUT_MS = 12_000;
const TRANSIENT = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(status, message, code = 'error', requestId = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const handlers = { unauthorized: null, forbidden: null };

/** 401 -> sign out locally. 403 -> refetch permissions (roles may have changed). */
export function setApiHandlers({ onUnauthorized, onForbidden }) {
  handlers.unauthorized = onUnauthorized ?? null;
  handlers.forbidden = onForbidden ?? null;
}

async function once(path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const timedOut = controller.signal.reason?.name === 'TimeoutError';
    throw new ApiError(0, timedOut ? 'The server took too long to respond.' : 'Could not reach the server. Check your connection.', timedOut ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new ApiError(
      response.status,
      typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`,
      data?.code,
      data?.requestId ?? response.headers.get('x-request-id'),
    );
    if (response.status === 401 && !path.startsWith('/api/auth/')) handlers.unauthorized?.(error);
    if (response.status === 403 && error.code === 'forbidden') handlers.forbidden?.(error);
    throw error;
  }
  return data;
}

/** Retries transient failures once, and only for reads. */
export async function api(path, options = {}) {
  const method = options.method ?? 'GET';
  if (process.env.NEXT_PUBLIC_FRONTEND_ONLY === 'true') {
    const { previewResponse } = await import('./frontend-preview');
    return previewResponse(path, method);
  }
  try {
    return await once(path, options);
  } catch (error) {
    if (method !== 'GET' || !(error instanceof ApiError) || !TRANSIENT.has(error.status)) throw error;
    await new Promise((r) => setTimeout(r, 400));
    return once(path, options);
  }
}

export const apiGet = (path, options) => api(path, options);
export const apiPost = (path, body, options) => api(path, { ...options, method: 'POST', body: body ?? {} });
export const apiPut = (path, body, options) => api(path, { ...options, method: 'PUT', body });
export const apiPatch = (path, body, options) => api(path, { ...options, method: 'PATCH', body });
export const apiDelete = (path, options) => api(path, { ...options, method: 'DELETE' });

/** Reads a File as base64 (without the data: prefix). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
