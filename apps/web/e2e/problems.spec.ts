/**
 * Software's Practice tab, Problems view: the problem library (the interview setup's own list,
 * with its filters and status marks) beside a card for the chosen problem, which starts it on
 * your own (no interviewer) or opens the Interviews tab's setup with that problem chosen.
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus } from './fixtures';
import { setup } from './helpers';

const library = (page: Page) => page.getByRole('region', { name: 'Problem library' });
const row = (page: Page, name: RegExp) => library(page).getByRole('button', { name });
const card = (page: Page) => page.getByTestId('problem-card');

test('lists the library with its filters and marks, the chosen problem in a card', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/software/practice');
  await page.getByRole('tab', { name: 'Problems' }).click();
  await expect(page).toHaveURL(/\/software\/practice\?view=problems$/);
  await expect(library(page).locator('button[aria-pressed]')).toHaveCount(15);
  // No random pick here: that belongs to setting up an interview.
  await expect(page.getByRole('button', { name: 'Pick a random problem' })).toHaveCount(0);
  await expect(card(page)).toContainText('No problem selected');

  // The marks and the status filter, as in the interview setup.
  await expect(row(page, /^LRU Cache/).getByTestId('problem-status')).toHaveAttribute(
    'data-status',
    'solved',
  );
  const status = page.getByRole('radiogroup', { name: 'Status' });
  await status.getByRole('radio', { name: /^Attempted/ }).click();
  await expect(library(page).locator('button[aria-pressed]')).toHaveCount(3);
  await page.getByRole('tab', { name: /^DSA/ }).click();
  await page.getByRole('radio', { name: 'Hard', exact: true }).click();
  await expect(library(page).locator('button[aria-pressed]')).toHaveCount(1);
  await page.getByRole('switch', { name: 'Show topics' }).click();
  await expect(row(page, /^Trapping Rain Water/)).toContainText('Two pointers');

  await row(page, /^Trapping Rain Water/).click();
  await expect(row(page, /^Trapping Rain Water/)).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page).getByTestId('selected-problem')).toHaveText('Trapping Rain Water');
  await expect(card(page).getByTestId('problem-card-status')).toHaveText('Attempted, not solved');
  await expect(card(page)).toContainText('Hard');
  // The start of the statement.
  await expect(card(page).locator('.prose, p').first()).toBeVisible();
  // Kept in the URL, so a reload keeps it.
  await expect(page).toHaveURL(/\/software\/practice\?view=problems&problem=trapping-rain-water$/);
  await page.reload();
  await expect(card(page).getByTestId('selected-problem')).toHaveText('Trapping Rain Water');
});

test('solving on your own opens a pad with no interviewer and no clock, without a key', async ({
  page,
}) => {
  const b = await setup(page, (m) => {
    m.aiKey = aiKeyStatus('missing');
  });
  await page.goto('/software/practice?view=problems');
  await row(page, /^Word Ladder/).click();
  await card(page).getByRole('button', { name: 'Solve on your own' }).click();
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  const create = b.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
  expect(create?.body).toMatchObject({
    problemSlug: 'word-ladder',
    durationMin: null,
    interviewer: { enabled: false },
  });
  // A pad of its own, not a staged interview.
  expect(b.requests.some((r) => r.method === 'POST' && r.path === '/api/interviews')).toBe(false);
});

test('the card’s action opens the builder with a plan on the problem', async ({ page }) => {
  const b = await setup(page);
  await page.goto('/software/practice?view=problems');
  await row(page, /^Word Ladder/).click();
  await expect(card(page).getByTestId('problem-card-status')).toHaveText('Not attempted');
  const action = card(page).getByRole('link', { name: 'Set up an interview' });
  await expect(action).toHaveAttribute('href', '/software/interviews?problem=word-ladder');
  await action.click();
  await expect(page).toHaveURL(/\/software\/interviews\?problem=word-ladder$/);
  // One coding stage on it.
  await expect(page.getByTestId('stage-summary')).toHaveText(['Word Ladder · C++ · 45 min']);
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  const create = b.requests.find((r) => r.method === 'POST' && r.path === '/api/interviews');
  expect(create?.body).toMatchObject({
    stages: [{ kind: 'coding', problemSlug: 'word-ladder' }],
  });
  // Hosting someone on it instead: the room setup has it chosen.
  await page.goto('/software/interviews?problem=word-ladder&mode=host');
  await expect(page.locator('#interview-setup').getByTestId('selected-problem')).toHaveText(
    'Word Ladder',
  );
});

test('the library loads only when the view is opened, and keeps its filters after', async ({
  page,
}) => {
  const b = await setup(page);
  await page.goto('/software/practice');
  await expect(page.getByTestId('topic-grid')).toBeVisible();
  expect(b.requests.some((r) => r.path === '/api/problems')).toBe(false);
  await page.getByRole('tab', { name: 'Problems' }).click();
  await page.getByRole('searchbox', { name: 'Search problems' }).fill('lru');
  await expect(library(page).locator('button[aria-pressed]')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Quizzes' }).click();
  await page.getByRole('tab', { name: 'Problems' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search problems' })).toHaveValue('lru');
  await expect(library(page).locator('button[aria-pressed]')).toHaveCount(1);
});

test('Quant has no Problems view; a link to one lands on its quizzes', async ({ page }) => {
  await setup(page);
  await page.goto('/quant/practice?view=problems');
  await expect(page.getByRole('tab', { name: 'Problems' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Quizzes' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('topic-grid')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('a bar leads from the chosen row to its card', async ({ page }) => {
    await setup(page);
    await page.goto('/software/practice?view=problems');
    await row(page, /^Two Sum/).tap();
    const bar = page.getByRole('button', { name: 'View problem' });
    await expect(bar).toBeVisible();
    await bar.tap();
    await expect(card(page).getByRole('link', { name: 'Set up an interview' })).toBeInViewport();
    await expect(bar).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
