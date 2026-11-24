/**
 * Core flow against the real API (no interception). See playwright.real.config.ts.
 * Skipped unless REAL_API=1. Screenshots go to e2e/.screens/real-*.png.
 *
 * The AI features run on the user's own Anthropic key. Pass one as REAL_ANTHROPIC_KEY to cover
 * them (it is pasted into the key dialog like a user would, removed again at the end, and never
 * printed); without it only the no-key states are checked.
 */
import { expect, type Page, test } from '@playwright/test';

test.skip(!process.env.REAL_API, 'set REAL_API=1 with the API on :4000 and next dev on :3000');
// Traces record typed values; this test handles a real API key.
test.use({ trace: 'off' });

const KEY = process.env.REAL_ANTHROPIC_KEY?.trim();

/** Paste the key into the open key dialog (clipboard, so it never appears in a call log). */
async function pasteKey(page: Page, submit = 'Save key') {
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox', { name: /API key/ });
  await expect(input).toHaveValue('');
  await page.evaluate((k) => navigator.clipboard.writeText(k), KEY ?? '');
  await input.focus();
  await page.keyboard.press('ControlOrMeta+V');
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await dialog.getByRole('button', { name: submit }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/.screens/real-${name}.png` });

test('sign up, no-key states, add a key, interview, edit, run, end, report; quiz', async ({
  page,
  context,
}) => {
  test.setTimeout(KEY ? 600_000 : 180_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on(
    'response',
    (r) =>
      r.url().includes('/api/') &&
      r.status() >= 400 &&
      problems.push(`${r.status()} ${r.request().method()} ${r.url()}`),
  );

  const email = `e2e-${Date.now()}@example.com`;
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Playwright Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Playwright');
  await shot(page, 'dashboard');

  // Sign out and back in to exercise sign-in too.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/sign-in?next=/new');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form [role=alert]')).toBeVisible();
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/new/);

  // New interview from the library. A new account has no key: the setup says so, and Start
  // offers to add one or to go without.
  await page.getByRole('searchbox', { name: 'Search problems' }).fill('two sum');
  await page
    .getByRole('button', { name: /Two Sum/ })
    .first()
    .click();
  await expect(page.getByTestId('ai-key-prompt')).toContainText('Runs on your own AI API key');
  await shot(page, 'new');
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page.getByRole('dialog', { name: 'Add your API key to start' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A pad whose owner has no key (as once a key expired): created directly through the API.
  const padId = await page.evaluate(async () => {
    const r = await fetch('/api/pads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problemSlug: 'two-sum', language: 'cpp' }),
    });
    return ((await r.json()) as { id: string }).id;
  });
  await page.goto(`/pads/${padId}`);
  const padUrl = page.url();

  // The shared editor loads the server-seeded scaffold.
  await expect(page.locator('.view-lines')).toContainText('class', { timeout: 30_000 });
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 30_000 });

  // No key: the interviewer panel says why it is quiet, and nothing answers.
  const chat = page.getByRole('region', { name: 'Interviewer chat' });
  const prompt = chat.getByTestId('ai-key-prompt');
  await expect(prompt).toContainText('The interviewer runs on your own AI API key');
  await page.getByLabel('Message', { exact: true }).fill('Is anyone there?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  await expect(page.getByTestId('interviewer-message')).toHaveCount(0);
  await expect(page.getByTestId('proactive-message')).toHaveCount(0);
  await shot(page, 'pad-no-key');

  if (KEY) {
    // Add the key from the panel; the interviewer joins without a reload and greets.
    await prompt.getByRole('button', { name: 'Add API key' }).click();
    await pasteKey(page);
    await expect(chat.getByTestId('ai-key-prompt')).toHaveCount(0);
    await expect(
      page.getByTestId('proactive-message').or(page.getByTestId('interviewer-message')).first(),
    ).toBeVisible({ timeout: 90_000 });
    await shot(page, 'pad-greeting');
  }

  // Ask a question and wait for a streamed reply.
  if (KEY) {
    const before = await page.getByTestId('interviewer-message').count();
    await page
      .getByLabel('Message', { exact: true })
      .fill('Can the input array contain duplicate values?');
    await page.keyboard.press('Enter');
    await expect(
      page.getByTestId('interviewer-thinking').or(page.getByTestId('streaming-message')).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('interviewer-message')).toHaveCount(before + 1, {
      timeout: 90_000,
    });
    await shot(page, 'pad-reply');
  }

  // Edit the code; it persists across a reload (server-side Yjs).
  await page.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n// marker-from-playwright');
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(page.locator('.view-lines')).toContainText('marker-from-playwright', {
    timeout: 30_000,
  });

  // Switch language: per-language buffers.
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Python' }).click();
  await expect(page.locator('.view-lines')).toContainText('class Solution:', { timeout: 15_000 });

  // Runs queue (the judge may not be running): the progress view appears.
  await page.getByTestId('run-tests').click();
  await expect(
    page.getByTestId('run-progress').or(page.getByTestId('run-result')).first(),
  ).toBeVisible({ timeout: 15_000 });
  await shot(page, 'pad-run');

  // End the interview and land on the report.
  await page.getByRole('button', { name: 'End interview' }).click();
  await page.getByRole('button', { name: 'End and see report' }).click();
  await expect(page).toHaveURL(/\/report$/, { timeout: 20_000 });
  if (KEY) {
    // The assessment is written on the owner's key.
    await expect(page.getByRole('list', { name: /Recommendation scale/ })).toBeVisible({
      timeout: 300_000,
    });
  } else {
    await expect(page.getByTestId('assessment-key-prompt')).toBeVisible({ timeout: 30_000 });
  }
  await shot(page, 'report');

  // The ended pad is read-only.
  await page.goto(padUrl);
  await expect(page.getByText('This interview has ended')).toBeVisible({ timeout: 20_000 });

  // Quiz: start a practice attempt and answer the first question.
  await page.goto('/quiz');
  await page.getByRole('button', { name: /^Operating systems/ }).click();
  await page.getByRole('button', { name: 'Start quiz' }).click();
  await expect(page.getByTestId('quiz-counter')).toContainText('Question 1 of', {
    timeout: 20_000,
  });
  const radio = page.getByRole('radio').first();
  const checkbox = page.getByRole('checkbox').first();
  if (await checkbox.isVisible().catch(() => false)) await checkbox.click();
  else if (
    await page
      .getByLabel('Your answer')
      .isVisible()
      .catch(() => false)
  )
    await page.getByLabel('Your answer').fill('Because of the reasons we discussed.');
  else await radio.click();
  if (
    await page
      .getByLabel('Output')
      .isVisible()
      .catch(() => false)
  )
    await page.getByLabel('Output').fill('1');
  await page.getByTestId('quiz-primary').click();
  await expect(page.getByRole('region', { name: 'Feedback' })).toBeVisible({ timeout: 60_000 });
  await shot(page, 'quiz');

  if (KEY) {
    // The key's settings: last four only, then remove it so it does not linger on the server.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: /AI key/ }).click();
    const saved = page.getByTestId('ai-key-saved');
    await expect(saved).toContainText(`sk-ant-…${KEY.slice(-4)}`);
    expect(await page.content()).not.toContain(KEY.slice(0, -4));
    await saved.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('textbox', { name: 'Anthropic API key' })).toHaveValue('');
  }

  console.log(`real-API problems:\n${problems.join('\n') || '(none)'}`);
});
