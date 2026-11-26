/**
 * Visual review of the tracks: the first-visit question, the header in each track (and its
 * phone menu), and each tab in both tracks under the same names, to compare side by side:
 * Interviews (practising, hosting, history, with pads under way), Practice (quizzes, Software's
 * problems, history), Roadmap (study path and topic maps). Run with SCREENS=1 playwright test
 * screens-tracks (`ONLY=interviews` and `SCREEN_WIDTHS=1440` narrow it).
 */
import { type Page, test } from '@playwright/test';
import { setup, shoot } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);
const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.some((o) => name.includes(o));

const settle = (page: Page) => page.waitForTimeout(300);

for (const width of WIDTHS) {
  const phone = width < 600;
  test.describe(`tracks at ${width}px`, () => {
    test.use({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone });

    test('first visit', async ({ page }) => {
      test.skip(!want('track-chooser'));
      await setup(page, (b) => {
        b.track = null;
      });
      await page.goto('/dashboard');
      await page.getByTestId('track-chooser').waitFor();
      await settle(page);
      await shoot(page, 'track-chooser');
    });

    test('the tabs in both tracks', async ({ page }) => {
      await setup(page, (b) => {
        // Pads of both tracks, under way and finished.
        b.useRoomBank();
        b.quant.listOnDashboard();
        b.quantRooms.listOnDashboard();
      });
      for (const track of ['software', 'quant'] as const) {
        if (want(`${track}-interviews`)) {
          await page.goto(`/${track}/interviews`);
          await page.getByRole('heading', { level: 1, name: 'Interviews' }).waitFor();
          await (track === 'quant'
            ? page.getByTestId('round-setup')
            : page.getByRole('region', { name: 'Problem library' })
          ).waitFor();
          await settle(page);
          await shoot(page, `${track}-interviews`, { fullPage: !phone });
          await page.goto(`/${track}/interviews?mode=host`);
          await (track === 'quant'
            ? page.getByTestId('bank-row').first()
            : page.getByRole('region', { name: 'Problem library' })
          ).waitFor();
          await settle(page);
          await shoot(page, `${track}-interviews-host`, { fullPage: !phone });
          await page.goto(`/${track}/interviews?view=history`);
          await page.getByRole('region', { name: 'Finished interviews' }).waitFor();
          await settle(page);
          await shoot(page, `${track}-interviews-history`, { fullPage: true });
        }
        if (want(`${track}-practice`)) {
          await page.goto(`/${track}/practice`);
          await page.getByTestId('topic-grid').waitFor();
          await settle(page);
          await shoot(page, `${track}-practice`, { fullPage: true });
          await page.goto(`/${track}/practice?view=history`);
          await page.getByRole('region', { name: 'Past quizzes' }).waitFor();
          await settle(page);
          await shoot(page, `${track}-practice-history`, { fullPage: true });
          if (track === 'software') {
            await page.goto('/software/practice?view=problems');
            await page.getByRole('region', { name: 'Problem library' }).waitFor();
            await settle(page);
            await shoot(page, 'software-practice-problems', { fullPage: !phone });
            await page.getByRole('button', { name: /^Trapping Rain Water/ }).click();
            await page.getByTestId('problem-card').getByRole('link').waitFor();
            await settle(page);
            await shoot(page, 'software-practice-problem', { fullPage: !phone });
          }
        }
        if (want(`${track}-roadmap`)) {
          await page.goto(`/${track}/roadmap`);
          await page.getByTestId('path-step').first().waitFor();
          await settle(page);
          await shoot(page, `${track}-roadmap-path`, { fullPage: true });
          await page.goto(`/${track}/roadmap?view=maps`);
          await page.locator('[data-topic-row]').waitFor();
          await page.waitForTimeout(600);
          await shoot(page, `${track}-roadmap-maps`, { fullPage: true });
        }
      }
      if (want('quant-roadmap-researcher')) {
        await page.goto('/quant/roadmap?path=researcher');
        await page.getByTestId('path-step').first().waitFor();
        await settle(page);
        await shoot(page, 'quant-roadmap-researcher');
      }
    });

    test('header', async ({ page }) => {
      test.skip(!want('header'));
      await setup(page);
      for (const track of ['software', 'quant'] as const) {
        await page.goto(`/${track}/practice`);
        await page.getByTestId('topic-grid').waitFor();
        await settle(page);
        await page.setViewportSize({ width, height: 120 });
        await shoot(page, `header-${track}`);
        await page.setViewportSize({ width, height: phone ? 844 : 900 });
      }
      if (phone) {
        await page.getByRole('button', { name: /^Track: / }).tap();
        await page.getByRole('menu').waitFor();
        await settle(page);
        await shoot(page, 'header-track-menu');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Account menu' }).tap();
        await page.getByRole('menu').waitFor();
        await settle(page);
        await shoot(page, 'header-account-menu');
      }
    });
  });
}
