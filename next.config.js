// The browser only ever calls same-origin /api/*. Next proxies those requests to
// the Express API (BACKEND_ORIGIN), so the session cookie stays first-party.

function backendOrigin(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`BACKEND_ORIGIN is not a valid URL: ${raw}`);
  }
  if (url.origin !== raw.replace(/\/$/, '')) throw new Error('BACKEND_ORIGIN must be a bare origin with no path');
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL === '1' && url.protocol !== 'https:') {
    throw new Error('BACKEND_ORIGIN must use https in production');
  }
  return url.origin;
}

const apiBackendOrigin = backendOrigin(process.env.BACKEND_ORIGIN);
const frontendOnly = process.env.FRONTEND_ONLY === 'true' && !apiBackendOrigin;
if (process.env.VERCEL === '1' && !apiBackendOrigin && !frontendOnly) throw new Error('BACKEND_ORIGIN is required');

/** @type {import('next').NextConfig} */
export default {
  env: { NEXT_PUBLIC_FRONTEND_ONLY: frontendOnly ? 'true' : 'false' },
  reactStrictMode: true,
  poweredByHeader: false,
  // The floating dev-tools badge covers the mobile header's account menu.
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1', 'admin.localhost', 'payroll.localhost'],
  async rewrites() {
    return {
      beforeFiles: apiBackendOrigin
        ? [{ source: '/api/:path*', destination: `${apiBackendOrigin}/api/:path*` }]
        : [],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};
