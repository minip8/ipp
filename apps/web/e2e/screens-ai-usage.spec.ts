/**
 * Visual review screenshots for the "Daily limit" section of the AI key settings: the defaults,
 * and the user's own caps with a model whose calls cannot be priced. Run with
 * SCREENS=1 playwright test screens-ai-usage.
 */
import { test } from '@playwright/test';
import { setup, shoot } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);

for (const width of WIDTHS) {
  test.describe(`daily limit at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 } });

    test('defaults, then the user’s own caps', async ({ page }) => {
      const backend = await setup(page);
      await page.goto('/settings/ai-key');
      await page.getByTestId('ai-usage-today').waitFor();
      await page.waitForTimeout(300);
      await shoot(page, 'ai-limit-defaults', { fullPage: true });

      backend.aiUsage.limits = { costMicros: 5_000_000, tokens: 2_000_000, messages: null };
      await page.reload();
      await page.getByTestId('ai-usage-today').waitFor();
      await page.waitForTimeout(300);
      await shoot(page, 'ai-limit-own', { fullPage: true });
    });
  });
}
