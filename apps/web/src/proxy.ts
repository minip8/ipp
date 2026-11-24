/**
 * Per-request CSP nonce (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * Next.js reads the nonce from the request's Content-Security-Policy header and puts it on its
 * own scripts; the root layout passes it to the one other inline script (next-themes).
 */
import { type NextRequest, NextResponse } from 'next/server';
import { buildCsp, newNonce } from './lib/csp';

export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    wsUrl: process.env.NEXT_PUBLIC_WS_URL,
  });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API rewrite, build assets or Monaco's static files.
      source: '/((?!api/|_next/static|_next/image|monaco/|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
