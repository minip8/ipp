/**
 * Runs e2e/real-api.spec.ts against a real stack: `next dev` on :3000 (root .env) and apps/api
 * on :4000. No interception. Start both first, then: playwright test -c playwright.real.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /real-(api|judge)\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  // REAL_BASE_URL points the same tests at a deployed site (e.g. https://interview.example.com).
  use: {
    baseURL: process.env.REAL_BASE_URL ?? 'http://localhost:3000',
    ignoreHTTPSErrors: process.env.REAL_IGNORE_TLS === '1',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
