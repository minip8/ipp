/** Visual review screenshots for the report. Run with SCREENS=1 playwright test screens-report. */
import { test } from '@playwright/test';
import { ACTIVE_PAD_ID, ENDED_PAD_ID, REPORT_PENDING, REPORT_READY } from './fixtures';
import { setup, shoot } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);

for (const width of WIDTHS) {
  test.describe(`report at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 }, hasTouch: width < 600 });

    test('ready', async ({ page }) => {
      await setup(page);
      await page.goto(`/pads/${ENDED_PAD_ID}/report`);
      await page.getByText('Strengths').waitFor();
      await page.getByTestId('playback-code').locator('.shiki').waitFor();
      await shoot(page, 'report', { fullPage: true });
      await page.getByRole('slider', { name: 'Playback position' }).focus();
      await page.keyboard.press('Home');
      for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
      await page.getByTestId('playback-code').hover();
      await page.waitForTimeout(400);
      await page.getByTestId('playback-code').scrollIntoViewIfNeeded();
      await shoot(page, 'report-scrubbed');
    });

    test('states', async ({ page }) => {
      const b = await setup(page, (b) => {
        b.report = REPORT_PENDING;
      });
      await page.goto(`/pads/${ENDED_PAD_ID}/report`);
      await page.getByText('Writing your assessment').waitFor();
      await shoot(page, 'report-pending');
      b.report = { ...REPORT_READY, assessment: null };
      await page.reload();
      await page.getByText('No AI assessment').waitFor();
      await shoot(page, 'report-noassessment');
      await page.goto(`/pads/${ACTIVE_PAD_ID}/report`);
      await page.getByText('still in progress').waitFor();
      await shoot(page, 'report-active');
      await page.goto('/pads/00000000-0000-4000-8000-00000000dead/report');
      await page.getByText("don't have access").waitFor();
      await shoot(page, 'report-404');
    });
  });
}
