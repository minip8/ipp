/** Visual review of the pad. Run with SCREENS=1 playwright test screens-pad. */
import { expect, type Page, test } from '@playwright/test';
import { ACTIVE_PAD_ID, RUNS } from './fixtures';
import { setup, shoot } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');
const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.some((o) => name.includes(o));

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('pad screens', async ({ page }) => desktopScreens(page));
});

async function desktopScreens(page: Page) {
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
}

/** The phone layout: one pane at a time, each captured (names end in -390). */
test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('pad screens', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    const pane = (name: RegExp) =>
      page.getByRole('tablist', { name: 'Pad sections' }).getByRole('tab', { name }).tap();
    const backend = await setup(page);
    await page.goto(`/pads/${ACTIVE_PAD_ID}`);
    await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    if (want('pad-initial')) await shoot(page, 'pad-phone-problem');

    await pane(/^Code/);
    await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
    await page.waitForTimeout(300);
    if (want('pad-initial')) await shoot(page, 'pad-phone-code');

    if (want('pad-wrong')) {
      backend.nextRun = (id) => RUNS.wrongAnswer(id);
      await page.getByTestId('run-tests').tap();
      await expect(page.getByTestId('run-result')).toBeVisible();
      await shoot(page, 'pad-phone-console-wrong');
    }
    if (want('pad-submit')) {
      await pane(/^Code/);
      backend.nextRun = (id) => RUNS.submitPartial(id);
      await page.getByTestId('submit').tap();
      await expect(page.getByTestId('run-result')).toContainText('Hidden tests');
      await shoot(page, 'pad-phone-console-submit');
      await page.getByRole('tab', { name: /Custom tests/ }).tap();
      await page.getByRole('button', { name: 'Add test' }).tap();
      await shoot(page, 'pad-phone-console-custom');
    }
    if (want('pad-chat')) {
      await pane(/^Code/);
      await backend.streamReply('Before you go on: what happens with duplicates like [3, 3]?', {
        kind: 'proactive',
        intent: 'nudge',
      });
      await expect(page.getByTestId('chat-tab-unread')).toBeVisible();
      await shoot(page, 'pad-phone-chat-unread');
      await pane(/^Chat/);
      await page.getByLabel('Message', { exact: true }).fill('Should I use a hash map here?');
      await shoot(page, 'pad-phone-chat');
    }
    if (want('pad-board')) {
      await pane(/^Code/);
      await page.getByRole('tab', { name: 'Whiteboard' }).tap();
      await page.waitForTimeout(300);
      await shoot(page, 'pad-phone-board');
      await page.getByRole('tab', { name: /main\.cpp/ }).tap();
    }
    if (want('pad-dialogs')) {
      const menu = () => page.getByRole('button', { name: 'More actions' }).tap();
      await menu();
      await shoot(page, 'pad-phone-menu');
      await page.getByRole('menuitem', { name: 'Editor settings' }).tap();
      await shoot(page, 'pad-phone-settings');
      await page.keyboard.press('Escape');
      await menu();
      await page.getByRole('menuitem', { name: 'End interview' }).tap();
      await shoot(page, 'pad-phone-end');
      await page.keyboard.press('Escape');
      await menu();
      await page.getByRole('menuitem', { name: 'Invite' }).tap();
      await shoot(page, 'pad-phone-share');
      await page.keyboard.press('Escape');
    }
    console.log('console errors:', JSON.stringify(errors, null, 1));
  });
});
