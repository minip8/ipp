/** Visual review screenshots. Run with SCREENS=1 pnpm test:e2e screens. */
import { test } from '@playwright/test';
import { setup, shoot } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);
const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.some((o) => name.includes(o));

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 } });

    test('public screens', async ({ page }) => {
      await setup(page, (b) => {
        b.signedIn = false;
      });
      if (want('landing')) {
        await page.goto('/');
        await page.getByRole('heading', { level: 1 }).waitFor();
        await shoot(page, 'landing', { fullPage: true });
      }
      if (want('signin')) {
        await page.goto('/sign-in');
        await page.getByLabel('Email').waitFor();
        await shoot(page, 'signin');
      }
    });

    test('app screens', async ({ page }) => {
      await setup(page);
      if (want('home')) {
        await page.goto('/');
        await page.getByRole('button', { name: 'Account menu' }).waitFor();
        await shoot(page, 'home-signed-in');
      }
      if (want('dashboard')) {
        await page.goto('/dashboard');
        await page.getByRole('region', { name: 'In progress' }).waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'dashboard', { fullPage: true });
      }
      if (want('dashboard-history')) {
        await page.goto('/dashboard?view=history');
        await page.getByRole('region', { name: 'Finished interviews' }).waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'dashboard-history', { fullPage: true });
      }
      // The Quant page, on each path (`ONLY=quant-page`).
      if (want('quant-page')) {
        await page.goto('/quant');
        await page.getByTestId('quant-step').first().waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'quant-page-trader', { fullPage: true });
        await page.goto('/quant?path=researcher');
        await page.getByTestId('quant-step').first().waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'quant-page-researcher', { fullPage: true });
      }
      if (want('new')) {
        await page.goto('/dashboard');
        await page.getByRole('button', { name: /^Two Sum/ }).click();
        await page.waitForTimeout(600);
        await shoot(page, 'new', { fullPage: true });
        // The library narrowed to what the user has solved.
        await page
          .getByRole('radiogroup', { name: 'Status' })
          .getByRole('radio', { name: /^Solved/ })
          .click();
        await page.getByRole('button', { name: /^LRU Cache/ }).click();
        await page.waitForTimeout(400);
        await shoot(page, 'new-solved');
      }
      // Past quizzes with their delete buttons, and the confirmation (`ONLY=quiz-history`).
      if (want('quiz-history')) {
        await page.goto('/quiz?view=history');
        await page.getByRole('region', { name: 'Past quizzes' }).waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'quiz-history', { fullPage: true });
        await page.getByRole('button', { name: /^Delete exam: / }).click();
        await page.getByRole('dialog').waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'quiz-history-delete');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Clear history' }).click();
        await page.getByRole('dialog').waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'quiz-history-clear');
      }
      if (want('drill-history')) {
        await page.goto('/quant/drill');
        await page.getByTestId('drill-runs').waitFor();
        await page
          .getByTestId('drill-runs')
          .getByRole('listitem')
          .nth(2)
          .getByRole('button', { name: /^Delete run: / })
          .click();
        await page.getByRole('dialog').waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'drill-history-delete');
      }
    });
  });
}
