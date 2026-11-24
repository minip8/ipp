/**
 * Content-Security-Policy for every page (docs/ARCHITECTURE.md §9). Scripts need a per-request
 * nonce ('strict-dynamic' lets the nonced Next.js bundles load Monaco's AMD files from /monaco);
 * no 'unsafe-inline' for scripts, so an injected <script> or inline handler cannot run on a page
 * where users paste their API key. Styles keep 'unsafe-inline' because Monaco and React set
 * inline styles (a nonce in style-src would disable 'unsafe-inline').
 */
export function buildCsp(opts: { nonce: string; dev: boolean; wsUrl?: string }): string {
  const ws = opts.wsUrl ? new URL(opts.wsUrl.replace(/^ws/, 'http')).host : 'localhost:4000';
  return [
    "default-src 'self'",
    // 'self' is ignored by browsers that understand 'strict-dynamic' and kept for those that do not.
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' ws://${ws} wss://${ws}${opts.dev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://github.com https://accounts.google.com",
    "object-src 'none'",
  ].join('; ');
}

/** 128 random bits, base64. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
