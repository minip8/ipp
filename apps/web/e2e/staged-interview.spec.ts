/**
 * A staged interview end to end on the mock: started from the builder, each stage's pad shows
 * where it sits and moves on to the next ("End stage", then "Next: …"), the last stage's End
 * opens the interview's page with every stage's report and the overall recommendation. Also:
 * ending early (the rest skipped), resuming between stages from the Interviews tab, a refused
 * next stage, a report still being written, the history's rows and deleting one, a one-stage
 * interview behaving as a pad, and a technical questions stage's wording.
 */
import { expect, type Page, test } from '@playwright/test';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

const presets = (page: Page) => page.getByRole('radiogroup', { name: 'Presets' });
const chip = (page: Page) => page.getByTestId('stage-chip');
const padUrl = /\/pads\/[0-9a-f-]{36}$/;

/** Starts the track's preset from the builder and waits for the first stage's pad. */
async function startPreset(page: Page, track: 'software' | 'quant', preset: string) {
  await page.goto(`/${track}/interviews?preset=${preset}`);
  await expect(presets(page).getByRole('radio', { checked: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await expect(page).toHaveURL(padUrl);
}

/** The pad's End (top bar), confirmed with the dialog's button. */
async function endFromTopBar(page: Page, button: string, confirm: string) {
  await page.getByRole('banner').getByRole('button', { name: button }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: confirm }).click();
  await expect(dialog).toBeHidden();
}

const quantPad = (page: Page) =>
  expect(page.getByTestId('quant-workspace')).toBeVisible({ timeout: 20_000 });

test('a whole interview: three stages, each moving on to the next, then its results', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const b = await setup(page);
  // A custom plan: technical questions, a coding problem, then a game.
  await page.goto('/software/interviews?preset=technical-screen');
  await page.getByRole('button', { name: 'Add market-making game' }).click();
  await expect(presets(page).getByRole('radio', { name: /^Custom/ })).toBeChecked();
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await expect(page).toHaveURL(padUrl);
  const first = page.url();

  // Stage 1: technical questions, a quant pad with no path.
  await quantPad(page);
  await expect(chip(page)).toHaveText('Stage 1 of 3');
  await expect(page.getByTestId('quant-badge')).toHaveText('Technical');
  await chip(page).click();
  await expect(page.getByRole('dialog')).toContainText('Custom interview');
  await expect(page.getByRole('dialog')).toContainText(
    'Next: Random medium problem · C++ · 45 min',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('banner').getByRole('button', { name: 'End stage' }).click();
  const end = page.getByRole('dialog', { name: 'End this stage?' });
  await expect(end).toContainText('Next up: Random medium problem · C++ · 45 min');
  await end.getByRole('button', { name: 'End stage' }).click();
  // The pad stays, read-only, with the way on.
  await expect(page.getByTestId('stage-ended')).toContainText('Stage 1 of 3 is over');
  expect(page.url()).toBe(first);
  const next = page.getByTestId('next-stage');
  await expect(next).toHaveText('Next: Random medium problem · C++ · 45 min');
  await next.click();

  // Stage 2: the coding problem it drew.
  await expect(page).not.toHaveURL(first);
  await expect(page).toHaveURL(padUrl);
  await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
  await expect(chip(page)).toHaveText('Stage 2 of 3');
  await endFromTopBar(page, 'End stage', 'End stage');
  await expect(page.getByTestId('next-stage')).toHaveText('Next: Market-making game · 15 min');
  await page.getByTestId('next-stage').click();

  // Stage 3, the last: its End ends the interview and opens its page.
  await expect(page).toHaveURL(padUrl);
  await quantPad(page);
  await expect(chip(page)).toHaveText('Stage 3 of 3');
  await page.getByRole('banner').getByRole('button', { name: 'End interview' }).click();
  const last = page.getByRole('dialog', { name: 'End the last stage?' });
  await last.getByRole('button', { name: 'End and see the results' }).click();
  await expect(page).toHaveURL(/\/interviews\/[0-9a-f-]{36}$/);

  // The interview's page: every stage's report in brief, and the overall result.
  await expect(page.getByRole('heading', { level: 1, name: 'Custom interview' })).toBeVisible();
  await expect(page.getByTestId('interview-meta')).toContainText('Software');
  await expect(page.getByTestId('interview-meta')).toContainText('3 stages, 80 min planned');
  const stages = page.getByTestId('interview-stage');
  await expect(stages).toHaveCount(3);
  await expect(stages.getByTestId('stage-status')).toHaveText(['Done', 'Done', 'Done']);
  await expect(stages.nth(1).getByTestId('interview-stage-summary')).toHaveText(
    /^[A-Z].* · C\+\+ · 45 min$/,
  );
  await expect(stages.nth(0).getByTestId('recommendation')).toHaveText('Lean hire');
  await expect(stages.nth(1).getByTestId('recommendation')).toHaveText('Hire');
  await expect(stages.nth(1).getByTestId('score-bars')).toContainText('Problem solving');
  await expect(stages.nth(0).getByTestId('score-bars')).toContainText('Structuring');
  await expect(stages.nth(1).getByRole('link', { name: /Full report/ })).toHaveAttribute(
    'href',
    /\/pads\/[0-9a-f-]{36}\/report$/,
  );
  // 20 min of lean hire, 45 of hire, 15 of lean hire: hire, by arithmetic.
  const overall = page.getByTestId('interview-overall');
  await expect(overall.getByText('Hire', { exact: true }).first()).toBeVisible();
  await expect(overall.getByTestId('overall-note')).toContainText('not an AI’s judgement');
  await expect(overall.getByTestId('recommendation')).toHaveText([
    'Lean hire',
    'Hire',
    'Lean hire',
  ]);
  await expect(page.getByTestId('interview-hub')).toHaveCount(0);
  expect(b.interviews.list[0]?.ended).toBe(true);

  // A stage's report leads back to the interview.
  await stages
    .nth(1)
    .getByRole('link', { name: /Full report/ })
    .click();
  await expect(page.getByTestId('report-stage')).toHaveText('Stage 2 of 3');
  await page.getByRole('main').getByRole('link', { name: 'Custom interview' }).click();
  await expect(page).toHaveURL(/\/interviews\/[0-9a-f-]{36}$/);
});

test('ending early: the stages not started are skipped', async ({ page }) => {
  await setup(page);
  await startPreset(page, 'quant', 'trader');
  await quantPad(page);
  await endFromTopBar(page, 'End stage', 'End stage');
  await page.getByRole('button', { name: 'End interview here' }).click();
  const dialog = page.getByRole('dialog', { name: 'End the interview here?' });
  await expect(dialog).toContainText('The 2 stages after this one are skipped.');
  await dialog.getByRole('button', { name: 'End interview' }).click();
  await expect(page).toHaveURL(/\/interviews\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('stage-status')).toHaveText(['Done', 'Skipped', 'Skipped']);
  await expect(page.getByTestId('interview-stage').nth(1)).toContainText('Not taken');
  // The overall result is the one stage's.
  await expect(page.getByTestId('interview-overall').getByTestId('recommendation')).toHaveText([
    'Lean hire',
  ]);
});

test('resuming between stages from the Interviews tab', async ({ page }) => {
  const b = await setup(page);
  await startPreset(page, 'quant', 'trader');
  await quantPad(page);
  await endFromTopBar(page, 'End stage', 'End stage');
  await page.goto('/quant/interviews');
  const row = page.getByTestId('active-interview');
  await expect(row).toContainText('Trader');
  await expect(row).toContainText('Stage 1 of 3');
  // Not under way: Continue opens the interview's page, which starts the next stage.
  await row.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/interviews\/[0-9a-f-]{36}$/);
  const hub = page.getByTestId('interview-hub');
  await expect(hub).toContainText('1 stage done, 2 to go');
  await expect(page.getByTestId('stage-status')).toHaveText(['Done', 'Up next', 'Up next']);
  await hub.getByRole('button', { name: 'Start stage 2: Market-making game · 15 min' }).click();
  await expect(page).toHaveURL(padUrl);
  await quantPad(page);
  await expect(chip(page)).toHaveText('Stage 2 of 3');
  // Under way: the row's Continue opens the pad itself.
  await page.goto('/quant/interviews');
  await expect(page.getByTestId('active-interview')).toContainText('Stage 2 of 3');
  await expect(
    page.getByTestId('active-interview').getByRole('link', { name: 'Continue' }),
  ).toHaveAttribute('href', `/pads/${b.interviews.list[0]?.padIds[1]}`);
  // Its stages' pads are never rows of their own, in either track.
  await expect(page.getByTestId('active-pad')).toHaveCount(0);
  await page.goto('/software/interviews');
  await expect(page.getByTestId('active-pad')).toHaveText([/Two Sum/]);
  await expect(page.getByTestId('active-interview')).toHaveCount(0);
});

test('a next stage the server refuses is said, and tried again', async ({ page }) => {
  const b = await setup(page);
  await startPreset(page, 'quant', 'trader');
  await quantPad(page);
  b.interviews.unavailable.add(1);
  await endFromTopBar(page, 'End stage', 'End stage');
  await page.getByTestId('next-stage').click();
  await expect(page.getByTestId('next-stage-error')).toContainText('Stage 2 cannot start');
  await expect(page.getByTestId('next-stage')).toHaveText(/^Try again: Market-making game/);
  b.interviews.unavailable.clear();
  await page.getByTestId('next-stage').click();
  await expect(chip(page)).toHaveText('Stage 2 of 3', { timeout: 20_000 });
});

/** An ended three-stage interview and a one-stage one, played two and five days ago. */
function seedHistory(b: MockBackend) {
  const day = 86_400_000;
  b.interviews.seed({
    track: 'software',
    title: 'Onsite loop',
    preset: 'onsite-loop',
    stages: [
      { kind: 'coding', difficulty: 'medium', language: 'cpp', durationMin: 45 },
      { kind: 'questions', topics: ['operating-systems', 'concurrency'], durationMin: 30 },
      { kind: 'coding', difficulty: 'hard', language: 'cpp', durationMin: 60 },
    ],
    started: 3,
    ended: true,
    accepted: [0],
    startedAt: new Date(Date.now() - 2 * day).toISOString(),
  });
  b.interviews.seed({
    track: 'software',
    title: 'Two Sum',
    stages: [{ kind: 'coding', problemSlug: 'two-sum', language: 'python', durationMin: 30 }],
    started: 1,
    ended: true,
    startedAt: new Date(Date.now() - 5.5 * day).toISOString(),
  });
}

test('history: an interview is one row, a one-stage one reads as its pad; deleting', async ({
  page,
}) => {
  const b = await setup(page, seedHistory);
  await page.goto('/software/interviews?view=history');
  const table = page.getByRole('table');
  // Four pads of their own, the staged interview and the one-stage one, newest first.
  await expect(table.getByRole('row')).toHaveCount(7);
  await expect(
    page.locator('main dl > div').filter({ hasText: 'Interviews' }).locator('dd'),
  ).toHaveText('6');
  // LRU Cache and Merge Intervals on their own, and the staged interview's first stage.
  await expect(
    page.locator('main dl > div').filter({ hasText: 'Solved' }).locator('dd'),
  ).toHaveText('3');
  const staged = table.getByTestId('history-interview');
  await expect(staged).toHaveCount(1);
  await expect(staged).toContainText('Onsite loop');
  await expect(staged.getByTestId('stage-kinds')).toContainText('3 stages');
  await expect(staged.getByTestId('recommendation')).toHaveText('Overall Hire');
  await expect(staged.getByRole('link', { name: 'Onsite loop', exact: true })).toHaveAttribute(
    'href',
    `/interviews/${b.interviews.list[1]?.id}`,
  );
  const single = table.getByRole('row', { name: /Two Sum/ });
  await expect(single).toContainText('Python');
  await expect(single.getByRole('link', { name: 'Two Sum', exact: true })).toHaveAttribute(
    'href',
    `/pads/${b.interviews.list[0]?.padIds[0]}/report`,
  );
  // No stage's pad is a row of its own.
  await expect(table).not.toContainText('Operating systems, Concurrency');

  await staged.getByRole('button', { name: 'Delete interview: Onsite loop' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete “Onsite loop”?' });
  await expect(dialog).toContainText('the 3 stages you started in it');
  await dialog.getByRole('button', { name: 'Delete interview' }).click();
  await expect(dialog).toBeHidden();
  await expect(table.getByTestId('history-interview')).toHaveCount(0);
  expect(
    b.requests.some((r) => r.method === 'DELETE' && r.path.startsWith('/api/interviews/')),
  ).toBe(true);
  expect(b.interviews.list).toHaveLength(1);
});

test('a report still being written is polled until it is ready', async ({ page }) => {
  const b = await setup(page, seedHistory);
  const staged = b.interviews.list[1];
  b.interviews.setReport(2, 'pending', staged?.id);
  await page.goto(`/interviews/${staged?.id}`);
  const third = page.getByTestId('interview-stage').nth(2);
  await expect(third).toContainText('Writing the assessment…');
  await expect(page.getByTestId('interview-overall')).toContainText('Hire');
  b.interviews.reports.clear();
  b.interviews.recommendations.set(staged?.padIds[2] ?? '', 'strong_hire');
  await expect(third.getByTestId('recommendation')).toHaveText('Strong hire', { timeout: 10_000 });
});

test('a one-stage interview behaves as a pad of its own', async ({ page }) => {
  const b = await setup(page);
  await startPreset(page, 'quant', 'quant-round');
  await quantPad(page);
  await expect(chip(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to interviews' })).toHaveAttribute(
    'href',
    '/quant/interviews',
  );
  await endFromTopBar(page, 'End interview', 'End and see report');
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}\/report$/);
  await expect(page.getByTestId('report-stage')).toHaveCount(0);
  expect(b.interviews.list[0]?.ended).toBe(true);
  // Deleting it from its report deletes the interview.
  await page.getByRole('button', { name: 'Delete interview' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete interview' }).click();
  await expect(page).toHaveURL(/\/quant\/interviews$/);
  expect(b.interviews.list).toHaveLength(0);
});

test('a technical questions stage says so in its pad and its report', async ({ page }) => {
  await setup(page);
  await page.goto('/software/interviews?preset=technical-screen');
  await page.getByRole('button', { name: 'Remove stage 2' }).click();
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await expect(page).toHaveURL(padUrl);
  await quantPad(page);
  const badge = page.getByTestId('quant-badge');
  await expect(badge).toHaveText('Technical');
  await expect(badge).toHaveAttribute('title', 'Technical questions');
  await endFromTopBar(page, 'End interview', 'End and see report');
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByRole('main')).toContainText('Technical questions report');
  await expect(page.getByRole('main').getByTestId('quant-badge')).toHaveText('Technical');
});
