/**
 * The Content-Security-Policy works with the whole app: scripts run only with the per-request
 * nonce (no 'unsafe-inline'), yet Next.js, the theme script and Monaco (AMD files from /monaco,
 * a web worker, inline styles) all load without a single violation. Run against `next dev` by
 * default; against a production build when one is listening on the test port (see DEPLOY.md).
 */
import { expect, type Page, test } from '@playwright/test';
import { ACTIVE_PAD_ID } from './fixtures';
import { setup } from './helpers';

async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test('pages carry a nonce-based CSP without unsafe-inline scripts', async ({ page }) => {
  await setup(page);
  const res = await page.goto('/settings/ai-key');
  const csp = res?.headers()['content-security-policy'] ?? '';
  const script = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
  expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
  expect(script).toContain("'strict-dynamic'");
  expect(script).not.toContain('unsafe-inline');
  // A new nonce on every request.
  const again = await page.request.get('/settings/ai-key');
  expect(again.headers()['content-security-policy']).not.toBe(csp);
  // Next's own inline scripts carry it.
  const nonce = /'nonce-([^']+)'/.exec(script)?.[1] ?? '';
  const html = await again.text();
  expect(html).toContain(
    `nonce="${/'nonce-([^']+)'/.exec(again.headers()['content-security-policy'] ?? '')?.[1]}"`,
  );
  expect(nonce).not.toBe('');
});

test('the editor (Monaco + worker), theme and chat run with no CSP violation', async ({ page }) => {
  await setup(page);
  const violations = await watchViolations(page);
  const logs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text());
  });
  await page.goto(`/pads/${ACTIVE_PAD_ID}`);
  await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
  // Typing exercises the editor worker (diffing, word ranges) and the collaborative binding.
  await page.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n// csp check');
  await expect(page.locator('.view-lines')).toContainText('// csp check');
  // Monaco started its editor worker (it wraps /monaco/editor.worker.js in a blob: worker).
  await expect.poll(() => page.workers().length).toBeGreaterThan(0);
  expect(logs.filter((t) => /web worker|Content Security Policy|Refused to/i.test(t))).toEqual([]);
  // Theme switch (next-themes' inline script ran: <html> has a theme class).
  expect(await page.evaluate(() => document.documentElement.className)).toMatch(/light|dark/);
  expect(await violations()).toEqual([]);
});

test('an injected inline handler is blocked', async ({ page }) => {
  await setup(page);
  const violations = await watchViolations(page);
  await page.goto('/settings/ai-key');
  await expect(page.getByRole('heading', { name: 'AI key' })).toBeVisible();
  const ran = await page.evaluate(async () => {
    const w = window as unknown as { __pwned?: number };
    const d = document.createElement('div');
    d.setAttribute('onclick', 'window.__pwned = 1');
    document.body.appendChild(d);
    d.click();
    await new Promise((r) => setTimeout(r, 50));
    return w.__pwned === 1;
  });
  expect(ran).toBe(false);
  expect((await violations()).join('\n')).toContain('script-src');
});
