/**
 * Visual review of the live quant round: the setup card on the Quant page, the quant pad (the
 * first question, mid-round after a hint, the round finished), a market-making game (fresh, with
 * problems in the form, traded, live, settled) and its review in the report, the dashboard
 * listing quant pads and the quant report. Run with
 * SCREENS=1 playwright test screens-quant (`ONLY=quant-pad` and `SCREEN_WIDTHS=1440` narrow it).
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus } from './fixtures';
import {
  QUANT_ENDED_PAD_ID,
  QUANT_GAME_ENDED_PAD_ID,
  QUANT_GAME_PAD_ID,
  QUANT_PAD_ID,
  VERDICTS,
} from './fixtures-quant-round';
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
      // Closed for time: the earlier question says so.
      await b.quant.timeout(QUANT_PAD_ID);
      await expect(page.getByTestId('round-heading')).toHaveText('Question 3 of 4');

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

    test('dashboard', async ({ page }) => {
      test.skip(!want('quant-dashboard'));
      await setup(page, (b) => b.quant.listOnDashboard());
      await page.goto('/dashboard');
      await page.getByRole('region', { name: 'In progress' }).waitFor();
      await page.waitForTimeout(300);
      await shoot(page, 'quant-dashboard');
      await page.goto('/dashboard?view=history');
      await page.getByRole('region', { name: 'Finished interviews' }).waitFor();
      await page.waitForTimeout(300);
      await shoot(page, 'quant-dashboard-history');
    });

    test('game', async ({ page }) => {
      test.skip(!want('quant-game'));
      const b = await setup(page);
      await page.goto(`/pads/${QUANT_GAME_PAD_ID}`);
      await expect(page.getByTestId('round-heading')).toHaveText('Question 2 of 4');
      await expect.poll(() => b.sockets.length).toBeGreaterThan(0);
      await page.waitForTimeout(400);
      await shoot(page, 'quant-game-fresh');
      if (phone) await tab(page, 'Question').tap();
      const p = page.getByTestId('game-panel');
      if (phone) await shoot(page, 'quant-game-fresh-question');
      // A market with problems, said beside each field.
      await p.getByLabel('Bid', { exact: true }).fill('11.3');
      await p.getByLabel('Offer', { exact: true }).fill('10');
      await p.getByLabel('Size', { exact: true }).fill('8');
      await shoot(page, 'quant-game-invalid');
      // Two markets: the first lifted, the second lifted with the first die shown.
      await p.getByLabel('Bid', { exact: true }).fill('9.5');
      await p.getByLabel('Offer', { exact: true }).fill('11.5');
      await p.getByLabel('Size', { exact: true }).fill('2');
      await p.getByLabel('Size', { exact: true }).press('Enter');
      await expect(page.getByTestId('quote-status')).toHaveAttribute('data-state', 'traded');
      await p.getByRole('button', { name: 'Move the market up a tick' }).click();
      await p.getByLabel('Bid', { exact: true }).press('Enter');
      await expect(p.getByTestId('game-position')).toHaveText('Short 2');
      await shoot(page, 'quant-game-traded');
      // A live market waiting.
      await p.getByLabel('Bid', { exact: true }).fill('12');
      await p.getByLabel('Offer', { exact: true }).fill('14');
      b.quant.gameReply = 'off';
      await p.getByLabel('Bid', { exact: true }).press('Enter');
      await expect(page.getByTestId('quote-status')).toHaveAttribute('data-state', 'working');
      await page.waitForTimeout(300);
      await shoot(page, 'quant-game-live');
      if (phone) {
        await tab(page, 'Chat').tap();
        await shoot(page, 'quant-game-chat');
      }
      // The question closes: the game settles.
      await b.quant.close(QUANT_GAME_PAD_ID, VERDICTS.good, 'Die 2 is a 2 and Die 3 a 5: 13.');
      await expect(page.getByTestId('round-heading')).toHaveText('Question 3 of 4');
      if (phone) await tab(page, 'Question').tap();
      await page.waitForTimeout(400);
      await shoot(page, 'quant-game-settled');
    });

    test('game report', async ({ page }) => {
      test.skip(!want('quant-game-report'));
      await setup(page);
      await page.goto(`/pads/${QUANT_GAME_ENDED_PAD_ID}/report`);
      await page.getByTestId('game-review').waitFor();
      await page.getByTestId('quant-review').locator('.katex').first().waitFor();
      await page.waitForTimeout(500);
      await page.getByTestId('game-review').scrollIntoViewIfNeeded();
      await shoot(page, 'quant-game-report-review');
      await shoot(page, 'quant-game-report', { fullPage: true });
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
