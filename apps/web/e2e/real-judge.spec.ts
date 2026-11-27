/**
 * Runs through the real judge (API on :4000, judge worker consuming judge:jobs, next dev on :3000).
 * Skipped unless REAL_API=1. Uses the Two Sum reference solution from packages/content.
 */
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

test.skip(!process.env.REAL_API, 'set REAL_API=1 with the full stack running');

const solution = readFileSync(
  new URL('../../../packages/content/problems/two-sum/solution.py', import.meta.url),
  'utf8',
);

async function setCode(page: Page, code: string) {
  await page.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  // Paste rather than type: typed text would pick up the editor's auto-indent and bracket closing.
  await page.evaluate((text) => navigator.clipboard.writeText(text), code);
  await page.keyboard.press('ControlOrMeta+V');
  await page.waitForTimeout(500);
}

test('run, run tests and submit against the real judge', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Judge Tester');
  await page.getByLabel('Email').fill(`judge-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // No AI here (it would need an API key): a room on the problem, just the judge.
  await page.goto('/software/interviews?mode=host');
  await page.getByRole('searchbox', { name: 'Search problems' }).fill('two sum');
  await page
    .getByRole('button', { name: /Two Sum/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Python' }).click();
  await expect(page.locator('.view-lines')).toContainText('class Solution:', { timeout: 15_000 });

  // A correct solution: Run prints main's output, samples and hidden tests pass.
  await setCode(page, solution);
  await page.getByTestId('run-file').click();
  await expect(page.getByTestId('run-result')).toContainText('[0, 1]', { timeout: 60_000 });
  await page.screenshot({ path: 'e2e/.screens/real-judge-run.png' });

  await page.waitForTimeout(2500);
  await page.getByTestId('run-tests').click();
  await expect(page.getByTestId('run-result')).toContainText(/3 \/ 3 tests passed/, {
    timeout: 60_000,
  });

  await page.waitForTimeout(2500);
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('run-result')).toContainText(/13 \/ 13 tests passed/, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('run-result')).toContainText(/Hidden tests/);
  await page.screenshot({ path: 'e2e/.screens/real-judge-accepted.png' });

  // A wrong solution: the failing sample shows expected vs actual.
  await setCode(page, solution.replace('return [seen[target - x], i]', 'return [i, i]'));
  await page.waitForTimeout(2500);
  await page.getByTestId('run-tests').click();
  await expect(page.getByTestId('run-result')).toContainText(/Wrong answer/i, { timeout: 60_000 });
  await expect(page.getByTestId('run-result')).toContainText(/0 \/ 3 tests passed/);
  await page.screenshot({ path: 'e2e/.screens/real-judge-wrong.png' });

  // A syntax error is reported against the candidate's line.
  await setCode(page, solution.replace('seen = {}', 'seen = {'));
  await page.waitForTimeout(2500);
  await page.getByTestId('run-tests').click();
  await expect(page.getByTestId('run-result')).toContainText(/Compile error|SyntaxError/i, {
    timeout: 60_000,
  });
  await page.screenshot({ path: 'e2e/.screens/real-judge-compile.png' });
});
