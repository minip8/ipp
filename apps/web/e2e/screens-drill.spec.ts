/**
 * Visual review screenshots for the mental math drill: setup, a run, results (and the run's
 * countdown, a "not a number" note and a percentage answer). Run with
 * SCREENS=1 playwright test screens-drill (`ONLY=drill-run` narrows it).
 */
import { DRILL_CATEGORIES, type DrillConfig } from '@ipp/contracts';
import { expect, type Page, test } from '@playwright/test';
import { add, DrillDeck, decimalPlaces, decimalText, rat } from '../src/features/drill/logic';
import { setup, shoot } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);
const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.some((o) => name.includes(o));

const CONFIG: DrillConfig = {
  durationSec: 120,
  level: 'standard',
  categories: [...DRILL_CATEGORIES],
};
const SEED = 2024;

async function answer(page: Page, text: string) {
  const field = page.getByTestId('drill-answer');
  await field.fill(text);
  await field.press('Enter');
}

for (const width of WIDTHS) {
  test.describe(`drill at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 } });

    test('setup, run and results', async ({ page }) => {
      await page.clock.install();
      await setup(page);
      const deck = new DrillDeck(SEED, CONFIG.level, CONFIG.categories);
      if (want('drill-setup')) {
        await page.goto('/quant/practice/drill');
        await page.getByTestId('drill-runs').waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'drill-setup', { fullPage: true });
      }
      if (want('drill-empty')) {
        const first = await page.context().newPage();
        await first.clock.install();
        await setup(first, (b) => {
          b.drillRuns = [];
        });
        await first.goto('/quant/practice/drill');
        await first.getByText('No runs yet').waitFor();
        await shoot(first, 'drill-setup-empty', { fullPage: true });
        await first.close();
      }
      if (!want('drill-run') && !want('drill-results')) return;
      await page.goto(`/quant/practice/drill?seed=${SEED}`);
      await page.getByRole('button', { name: 'Start' }).click();
      await expect(page.getByTestId('drill-question')).toHaveText('3');
      if (want('drill-run')) await shoot(page, 'drill-run-countdown');
      await page.clock.fastForward(3000);
      await expect(page.getByTestId('drill-question')).toHaveText(deck.at(0).text);
      // A few answers in: right, wrong, then one typed and a percentage on screen if any.
      for (let i = 0; i < 6; i++) {
        const q = deck.at(i);
        const wrong =
          decimalPlaces(q.answer) === null
            ? `${q.answer.num + 1n}/${q.answer.den}`
            : decimalText(add(q.answer, rat(1)));
        await answer(page, i % 4 === 3 ? wrong : q.answerText);
        await expect(page.getByTestId('drill-question')).toHaveText(deck.at(i + 1).text);
      }
      await page.clock.fastForward(17_000);
      if (want('drill-run')) {
        await page.getByTestId('drill-answer').fill(deck.at(6).answerText.slice(0, 2));
        await shoot(page, 'drill-run');
        await answer(page, 'abc');
        await expect(page.getByTestId('drill-mark')).toHaveText('Not a number');
        await shoot(page, 'drill-run-invalid');
        // The first percentage-change question further on, with its % after the field.
        let i = 6;
        while (deck.at(i).form !== 'percent') {
          await answer(page, deck.at(i).answerText);
          i++;
        }
        await expect(page.getByTestId('drill-question')).toHaveText(deck.at(i).text);
        await page.getByTestId('drill-answer').fill(decimalText(deck.at(i).answer));
        await shoot(page, 'drill-run-percent');
        // A wrong answer marked under the field.
        await answer(page, decimalText(add(deck.at(i).answer, rat(3))));
        await expect(page.getByTestId('drill-mark')).toContainText('Wrong');
        await shoot(page, 'drill-run-wrong');
      }
      await page.getByRole('button', { name: /^Skip/ }).click();
      await page.getByRole('button', { name: /^Skip/ }).click();
      await page.clock.fastForward(120_000);
      await page.getByTestId('drill-results').waitFor();
      await page.getByText('Saved to your history.').waitFor();
      if (want('drill-results')) await shoot(page, 'drill-results', { fullPage: true });
    });

    test('the card on Quant practice', async ({ page }) => {
      test.skip(!want('drill-card'), 'not asked for');
      await setup(page);
      await page.goto('/quant/practice');
      await page.getByTestId('drill-card').waitFor();
      await page.waitForTimeout(300);
      await shoot(page, 'drill-card-quant', { fullPage: true });
    });
  });
}
