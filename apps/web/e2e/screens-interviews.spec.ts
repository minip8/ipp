/**
 * Visual review of staged interviews: the builder in each track (its default preset, and a
 * custom plan with a stage open for editing, and the problem dialog), a stage's pad (its top bar
 * under way, and once ended with the way on), and the interview's page (between stages, and
 * finished with its results). Run with SCREENS=1 playwright test screens-interviews
 * (`ONLY=builder` and `SCREEN_WIDTHS=1440` narrow it).
 */
import { expect, type Page, test } from '@playwright/test';
import { setup, shoot } from './helpers';
import type { MockBackend } from './mock-api';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);
const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.some((o) => name.includes(o));

const settle = (page: Page) => page.waitForTimeout(350);

const day = 86_400_000;

/** Opens a stage's editor by its text, which phones use (their Edit button is hidden). */
const edit = (page: Page, n: number) =>
  page
    .getByTestId('plan-stage')
    .nth(n - 1)
    .locator('button[aria-controls]')
    .first()
    .click();

/** A software interview between stages, and an ended quant one with every stage reported. */
function seed(b: MockBackend) {
  b.interviews.seed({
    track: 'quant',
    title: 'Trader',
    preset: 'trader',
    stages: [
      { kind: 'questions', topics: ['probability', 'brainteasers'], durationMin: 20 },
      { kind: 'game', durationMin: 15 },
      { kind: 'questions', topics: ['betting-market-making', 'options'], durationMin: 20 },
    ],
    started: 3,
    ended: true,
    startedAt: new Date(Date.now() - day).toISOString(),
  });
  b.interviews.seed({
    track: 'software',
    title: 'Onsite loop',
    preset: 'onsite-loop',
    stages: [
      { kind: 'coding', difficulty: 'medium', language: 'python', durationMin: 45 },
      {
        kind: 'questions',
        topics: ['python', 'operating-systems', 'concurrency'],
        durationMin: 30,
      },
      { kind: 'coding', difficulty: 'hard', language: 'python', durationMin: 60 },
    ],
    started: 1,
    accepted: [0],
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  });
}

for (const width of WIDTHS) {
  const phone = width < 600;
  test.describe(`staged interviews at ${width}px`, () => {
    test.use({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone });

    test('builder', async ({ page }) => {
      test.skip(!want('builder'));
      await setup(page, seed);
      for (const track of ['software', 'quant'] as const) {
        await page.goto(`/${track}/interviews`);
        await page.getByRole('radiogroup', { name: 'Presets' }).waitFor();
        await settle(page);
        await shoot(page, `builder-${track}`, { fullPage: true });
      }
      // A custom plan: the quant developer's, a game added, the questions stage open.
      await page.goto('/quant/interviews?preset=quant-developer');
      await page.getByRole('button', { name: 'Add market-making game' }).click();
      await edit(page, 3);
      await page.getByTestId('topic-picker').waitFor();
      await settle(page);
      await shoot(page, 'builder-custom', { fullPage: true });
      await edit(page, 1);
      await page.getByRole('radio', { name: 'Choose a problem' }).click();
      await page.getByRole('dialog').getByRole('region', { name: 'Problem library' }).waitFor();
      await settle(page);
      await shoot(page, 'builder-problem-dialog');
    });

    test('stage pad', async ({ page }) => {
      test.skip(!want('stage-pad'));
      const b = await setup(page, seed);
      const software = b.interviews.list[0];
      const quant = b.interviews.list[1];
      // The coding stage just ended: the way on.
      await page.goto(`/pads/${software?.padIds[0]}`);
      await page.getByTestId('stage-ended').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      await settle(page);
      await shoot(page, 'stage-pad-ended');
      // A stage under way: start the next one and look at its top bar.
      await page.getByTestId('next-stage').click();
      await expect(page.getByTestId('quant-workspace')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('stage-chip').waitFor();
      await settle(page);
      await shoot(page, 'stage-pad-quant');
      await page.getByTestId('stage-chip').click();
      await settle(page);
      await shoot(page, 'stage-pad-chip');
      await page.keyboard.press('Escape');
      if (!phone) {
        await page.getByRole('banner').getByRole('button', { name: 'End stage' }).click();
        await page.getByRole('dialog').waitFor();
        await settle(page);
        await shoot(page, 'stage-pad-end');
      }
      await page.goto(`/pads/${quant?.padIds[2]}`);
      await expect(page.getByTestId('quant-workspace')).toBeVisible({ timeout: 20_000 });
      await settle(page);
      await shoot(page, 'stage-pad-last-ended');
    });

    test('interview page', async ({ page }) => {
      test.skip(!want('interview-page'));
      const b = await setup(page, seed);
      await page.goto(`/interviews/${b.interviews.list[0]?.id}`);
      await page.getByTestId('interview-hub').waitFor();
      await page.getByTestId('score-bars').first().waitFor();
      await settle(page);
      await shoot(page, 'interview-between', { fullPage: true });
      await page.goto(`/interviews/${b.interviews.list[1]?.id}`);
      await page.getByTestId('interview-overall').waitFor();
      await expect(page.getByTestId('score-bars')).toHaveCount(3);
      await page.waitForTimeout(800);
      await shoot(page, 'interview-finished', { fullPage: true });
      await page.goto('/software/interviews?view=history');
      await page.getByRole('region', { name: 'Finished interviews' }).waitFor();
      await page.goto('/quant/interviews?view=history');
      await page.getByRole('region', { name: 'Finished interviews' }).waitFor();
      await settle(page);
      await shoot(page, 'interviews-history-staged', { fullPage: true });
      await page.goto('/software/interviews');
      await page.getByTestId('active-interview').waitFor();
      await settle(page);
      await shoot(page, 'interviews-under-way');
    });
  });
}
