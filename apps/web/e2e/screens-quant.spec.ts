/**
 * Visual review of the live quant round: the setup card on the Quant page, the quant pad (the
 * first question, mid-round after a hint, the round finished) and the quant report. Run with
 * SCREENS=1 playwright test screens-quant (`ONLY=quant-pad` and `SCREEN_WIDTHS=1440` narrow it).
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus } from './fixtures';
import { QUANT_ENDED_PAD_ID, QUANT_PAD_ID } from './fixtures-quant-round';
import { setup, shoot } from './helpers';
import type { MockBackend } from './mock-api';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);
const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.some((o) => name.includes(o));

async function openPad(page: Page, b: MockBackend) {
  await page.goto(`/pads/${QUANT_PAD_ID}`);
  await expect(page.getByTestId('round-heading')).toHaveText('Question 1 of 4');
  await expect.poll(() => b.sockets.length).toBeGreaterThan(0);
  await expect(page.locator('.katex:visible').first()).toBeVisible();
  await page.waitForTimeout(400);
}

const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Pad sections' }).getByRole('tab', { name: new RegExp(name) });

for (const width of WIDTHS) {
  const phone = width < 600;
  test.describe(`quant round at ${width}px`, () => {
    test.use({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone });

    test('setup card', async ({ page }) => {
      test.skip(!want('quant-setup'));
      await setup(page);
      await page.goto('/quant');
      await page.getByTestId('round-setup').waitFor();
      await page.waitForTimeout(300);
      await shoot(page, 'quant-setup', { fullPage: true });
      const noKey = await page.context().newPage();
      await setup(noKey, (b) => {
        b.aiKey = aiKeyStatus('missing');
      });
      await noKey.goto('/quant?path=researcher');
      await noKey.getByTestId('round-key-prompt').waitFor();
      await noKey.waitForTimeout(300);
      await shoot(noKey, 'quant-setup-nokey');
      await noKey.close();
    });

    test('pad', async ({ page }) => {
      test.skip(!want('quant-pad'));
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(String(e)));
      const b = await setup(page);
      await openPad(page, b);
      await shoot(page, 'quant-pad-first');
      if (phone) {
        await tab(page, 'Question').tap();
        await shoot(page, 'quant-pad-first-question');
        await tab(page, 'Scratchpad').tap();
        await page
          .getByRole('textbox', { name: 'Scratchpad' })
          .fill('5 pairs: (2,6) (3,5) (4,4) (5,3) (6,2)\n36 outcomes');
        await shoot(page, 'quant-pad-first-scratch');
        await tab(page, 'Chat').tap();
      } else {
        await page
          .getByRole('textbox', { name: 'Scratchpad' })
          .fill('pairs summing to 8:\n(2,6) (3,5) (4,4) (5,3) (6,2)\n-> 5 / 36');
      }

      // Mid-round: a question closed, the next asked, a hint given.
      await page
        .getByLabel('Message', { exact: true })
        .fill('answer: five of the 36 pairs, so 5/36');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('round-heading')).toHaveText('Question 2 of 4');
      await page
        .getByLabel('Message', { exact: true })
        .fill('hint please, I am not sure where to start');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('hints-given')).toHaveText('1 hint so far', {
        timeout: 10_000,
      });
      await page.getByLabel('Message', { exact: true }).fill('So I light rope A at both ends?');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('interviewer-message').last()).toContainText('conditioning');
      await page.waitForTimeout(300);
      await shoot(page, 'quant-pad-hint');
      if (phone) {
        await tab(page, 'Question').tap();
        await shoot(page, 'quant-pad-hint-question');
        await tab(page, 'Chat').tap();
      }
      // Over the question's time: the quiet state.
      await b.quant.nudge(QUANT_PAD_ID);
      await expect(page.getByTestId('question-timer').first()).toHaveAttribute('data-over', 'true');
      if (!phone) await shoot(page, 'quant-pad-over');

      await b.quant.finish(QUANT_PAD_ID);
      await expect(page.getByTestId('round-heading')).toHaveText('Round finished');
      await page.waitForTimeout(300);
      if (phone) await tab(page, 'Question').tap();
      await shoot(page, 'quant-pad-finished');
      if (!phone) {
        await page.getByRole('button', { name: 'End interview' }).click();
        await shoot(page, 'quant-pad-end');
        await page.keyboard.press('Escape');
      }
      console.log('console errors:', JSON.stringify(errors, null, 1));
    });

    test('report', async ({ page }) => {
      test.skip(!want('quant-report'));
      await setup(page);
      await page.goto(`/pads/${QUANT_ENDED_PAD_ID}/report`);
      await page.getByTestId('quant-review').waitFor();
      await page.getByTestId('quant-review').locator('.katex').first().waitFor();
      await page.waitForTimeout(500);
      await shoot(page, 'quant-report', { fullPage: true });
    });
  });
}
