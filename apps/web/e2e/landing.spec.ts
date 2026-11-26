/**
 * The landing page speaks to both audiences on its first screen: the headline, a coding pad and a
 * quant question side by side on a wide screen, stacked on a phone. The quant preview's math is
 * typeset on the server, so the page ships KaTeX's stylesheet but not its script.
 */
import { expect, type Page, test } from '@playwright/test';
import { setup } from './helpers';

const HEADLINE = 'Practice the interview, not just the question.';

/** Whether any script the page loaded is KaTeX (its parser's error message is in its source). */
const katexScriptLoaded = (page: Page) =>
  page.evaluate(async () => {
    const scripts = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.includes('/_next/') && n.endsWith('.js'));
    const texts = await Promise.all(scripts.map((s) => fetch(s).then((r) => r.text())));
    return texts.some((t) => t.includes('KaTeX parse error'));
  });

async function noSideScroll(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);
}

test.describe('signed out', () => {
  test.beforeEach(async ({ page }) => {
    await setup(page, (b) => {
      b.signedIn = false;
    });
  });

  test('the headline and both previews, side by side in the first screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADLINE);
    await expect(page.getByText('Coding · Quant · Systems')).toBeVisible();
    const pad = page.getByTestId('pad-preview');
    const quant = page.getByTestId('quant-preview');
    await expect(pad).toBeVisible();
    await expect(quant).toBeVisible();
    await expect(pad).toContainText('Two Sum');
    await expect(quant).toContainText('Numeric answer');
    await expect(quant).toContainText('Correct');
    await expect(quant).toContainText('A stick is broken at two uniformly random points');

    // Side by side at 1440, both starting within the first 900px.
    const a = await pad.boundingBox();
    const b = await quant.boundingBox();
    if (!a || !b) throw new Error('no preview');
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    expect(a.y).toBeLessThan(900);

    // Pictures, not content: hidden from screen readers.
    await expect(pad).toHaveAttribute('aria-hidden', 'true');
    await expect(quant).toHaveAttribute('aria-hidden', 'true');

    // The actions lead to the account pages.
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Create an account' }),
    ).toHaveAttribute('href', '/sign-up');
    await expect(page.getByRole('link', { name: 'I have an account' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  test('the formula is typeset on the server, without the KaTeX script', async ({ page }) => {
    // In the HTML as served, before any script runs.
    const html = await (await page.request.get('/')).text();
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');

    await page.goto('/');
    const quant = page.getByTestId('quant-preview');
    await expect(quant.locator('.katex-display')).toHaveCount(1);
    expect(await quant.locator('.katex').count()).toBeGreaterThan(4);
    // Laid out by KaTeX's stylesheet (its fonts are in use), not shown as source.
    await expect(quant).not.toContainText('\\tfrac');
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() =>
        [...document.fonts].some((f) => f.family === 'KaTeX_Main' && f.status === 'loaded'),
      ),
    ).toBe(true);
    expect(await katexScriptLoaded(page)).toBe(false);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('stacks the previews with no sideways scroll', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADLINE);
      const pad = page.getByTestId('pad-preview');
      const quant = page.getByTestId('quant-preview');
      await expect(pad).toBeAttached();
      await expect(quant).toBeAttached();
      const a = await pad.boundingBox();
      const b = await quant.boundingBox();
      if (!a || !b) throw new Error('no preview');
      expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
      for (const box of [a, b]) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
      }
      await noSideScroll(page);
    });
  });
});

test('signed in, the hero leads to each side of the app', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Start a coding interview' })).toHaveAttribute(
    'href',
    '/dashboard',
  );
  await main.getByRole('link', { name: 'Quant questions' }).click();
  await expect(page).toHaveURL('/quant');
  await expect(page.getByRole('heading', { level: 1, name: 'Quant' })).toBeVisible();
});
