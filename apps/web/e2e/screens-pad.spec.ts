/** Visual review of the pad. Run with SCREENS=1 playwright test screens-pad. */
import { expect, test } from '@playwright/test';
import { ACTIVE_PAD_ID, RUNS } from './fixtures';
import { setup, shoot } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');
const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.some((o) => name.includes(o));

test.use({ viewport: { width: 1440, height: 900 } });

test('pad screens', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const backend = await setup(page);
  await page.goto(`/pads/${ACTIVE_PAD_ID}`);
  await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
  await page.waitForTimeout(500);
  if (want('pad-initial')) await shoot(page, 'pad-initial');

  if (want('pad-wrong')) {
    backend.nextRun = (id) => RUNS.wrongAnswer(id);
    await page.getByTestId('run-tests').click();
    await expect(page.getByTestId('run-result')).toBeVisible();
    await shoot(page, 'pad-wrong');
  }
  if (want('pad-compile')) {
    backend.nextRun = (id) => RUNS.compileError(id);
    await page.getByTestId('run-file').click();
    await expect(page.getByTestId('run-result')).toContainText('Compile error');
    await shoot(page, 'pad-compile');
  }
  if (want('pad-submit')) {
    backend.nextRun = (id) => RUNS.submitPartial(id);
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('run-result')).toContainText('Hidden tests');
    await shoot(page, 'pad-submit');
  }
  if (want('pad-chat')) {
    await page.getByLabel('Message', { exact: true }).fill('Should I use a hash map here?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    await shoot(page, 'pad-streaming');
    await expect(page.getByTestId('interviewer-thinking')).toHaveCount(0, { timeout: 10_000 });
    await backend.streamReply(
      'You have been quiet for a bit. What are you thinking about for the duplicate case?',
      { kind: 'proactive', intent: 'nudge' },
    );
    await page.waitForTimeout(300);
    await shoot(page, 'pad-chat');
  }
  if (want('pad-board')) {
    await page.getByRole('tab', { name: 'Whiteboard' }).click();
    await page.waitForTimeout(300);
    await shoot(page, 'pad-board');
  }
  if (want('pad-dialogs')) {
    await page.getByRole('tab', { name: 'main.cpp' }).click();
    await page.getByRole('button', { name: 'Editor settings' }).click();
    await shoot(page, 'pad-settings');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await shoot(page, 'pad-shortcuts');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'End interview' }).click();
    await shoot(page, 'pad-end');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Invite' }).click();
    await shoot(page, 'pad-share');
    await page.keyboard.press('Escape');
  }
  console.log('console errors:', JSON.stringify(errors, null, 1));
});
