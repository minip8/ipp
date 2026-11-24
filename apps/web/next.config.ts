import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import { z } from 'zod';

// One env file at the repo root (docs/ARCHITECTURE.md §2). Existing variables win.
const rootEnv = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const isProd = process.env.NODE_ENV === 'production';

const Env = z.object({
  API_INTERNAL_URL: isProd ? z.url() : z.url().default('http://localhost:4000'),
  NEXT_PUBLIC_WS_URL: isProd
    ? z.string().regex(/^wss?:\/\//)
    : z.string().default('ws://localhost:4000'),
});
const env = Env.parse(process.env);

// The Content-Security-Policy is set per request with a script nonce in src/proxy.ts.

const config: NextConfig = {
  reactStrictMode: true,
  // Lets the Playwright dev server run beside a normal `next dev` without sharing build output.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@ipp/contracts'],
  env: { NEXT_PUBLIC_WS_URL: env.NEXT_PUBLIC_WS_URL },
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${env.API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
        ],
      },
    ];
  },
};

export default config;
