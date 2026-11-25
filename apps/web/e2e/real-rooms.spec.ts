/**
 * An interview room against the real API (no interception): a host with an account, and a
 * candidate in a second browser who joins by the invite link with just a name.
 * See playwright.real.config.ts; skipped unless REAL_API=1. No AI key is used.
 */
import { expect, type Page, test } from '@playwright/test';

test.skip(!process.env.REAL_API, 'set REAL_API=1 with the API on :4000 and next dev on :3000');

function watch(page: Page, who: string, problems: string[]) {
  page.on('pageerror', (e) => problems.push(`${who} pageerror: ${e.message}`));
  page.on(
    'response',
    (r) =>
      r.url().includes('/api/') &&
      r.status() >= 400 &&
      // Expected: nobody is signed in before joining, and the candidate asks for nothing else.
      !(r.status() === 401 && r.url().endsWith('/api/me')) &&
      problems.push(`${who} ${r.status()} ${r.request().method()} ${r.url()}`),
  );
}

test('host a room, invite a guest, talk, change the problem, end; the report is the host’s', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  watch(host, 'host', problems);
  watch(guest, 'guest', problems);

  await host.goto('/sign-up');
  await host.getByLabel('Name').fill('Hana Host');
  await host.getByLabel('Email').fill(`room-${Date.now()}@example.com`);
  await host.getByLabel('Password').fill('correct-horse-battery');
  await host.getByRole('button', { name: 'Create account' }).click();
  await expect(host).toHaveURL(/\/dashboard/);

  await host.getByRole('radio', { name: 'Interview someone' }).click();
  await host.getByRole('searchbox', { name: 'Search problems' }).fill('two sum');
  await host
    .getByRole('button', { name: /^Two Sum/ })
    .first()
    .click();
  await host.getByRole('radio', { name: 'Python' }).click();
  await host.getByRole('button', { name: 'Create room' }).click();
  await expect(host).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  await expect(host.locator('.view-lines')).toContainText('class Solution', { timeout: 30_000 });
  await expect(host.getByTestId('invite-banner')).toBeVisible();
  await host.getByRole('button', { name: 'Invite', exact: true }).click();
  const link = await host.getByLabel('Share link').inputValue();
  await host.keyboard.press('Escape');

  // The candidate: no account, just a name.
  await guest.goto(link);
  await expect(
    guest.getByRole('heading', { name: 'Hana Host invited you to an interview' }),
  ).toBeVisible();
  await guest.getByLabel('Your name').fill('Casey Guest');
  await guest.getByRole('button', { name: 'Join the interview' }).click();
  await expect(guest).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  await expect(guest.locator('.view-lines')).toContainText('class Solution', { timeout: 30_000 });
  await expect(guest.getByTestId('room-role')).toHaveText('· interview with Hana Host');
  await expect(guest.getByRole('tab', { name: 'Guide' })).toHaveCount(0);

  // The host is told, and they talk.
  await expect(host.getByTestId('invite-banner')).toHaveCount(0);
  await host.getByPlaceholder('Message your candidate…').fill('Welcome, Casey.');
  await host.keyboard.press('Enter');
  await expect(guest.getByText('Welcome, Casey.')).toBeVisible();
  await expect(
    guest.getByRole('region', { name: 'Chat' }).getByText('Hana Host', { exact: true }),
  ).toBeVisible();
  await guest.getByPlaceholder('Message your interviewer…').fill('Thanks! Reading it now.');
  await guest.keyboard.press('Enter');
  await expect(host.getByText('Thanks! Reading it now.')).toBeVisible();
  await expect(
    host.getByRole('region', { name: 'Chat' }).getByText('Casey Guest', { exact: true }),
  ).toBeVisible();

  // What the candidate types reaches the host's editor.
  await guest.locator('.monaco-editor').first().click();
  await guest.keyboard.press('ControlOrMeta+End');
  await guest.keyboard.type('\n# typed by the candidate');
  await expect(host.locator('.view-lines')).toContainText('typed by the candidate');

  // Host-only material and notes.
  await host.getByRole('tab', { name: 'Guide' }).click();
  await expect(host.getByRole('heading', { name: 'Interviewer notes' })).toBeVisible();
  await expect(host.getByRole('heading', { name: 'Reference solution' })).toBeVisible();
  await host.getByRole('tab', { name: 'My notes' }).click();
  await host.getByLabel('Your private notes').fill('Good start.');
  await expect(host.getByTestId('host-notes-status')).toHaveText('Saved');
  await host.getByRole('tab', { name: 'Second opinion' }).click();
  await expect(host.getByTestId('review-key-prompt')).toBeVisible();
  await host.screenshot({ path: 'e2e/.screens/real-room-host.png' });

  // Another problem: both move, and the first problem's code is no longer in the editor.
  await host.getByRole('tab', { name: 'Problem' }).click();
  await host.getByTestId('change-problem').click();
  const dialog = host.getByRole('dialog', { name: 'Change the problem' });
  await dialog.getByRole('radio', { name: /Blank editor/ }).click();
  await dialog.getByRole('button', { name: 'Change problem' }).click();
  await expect(host.getByRole('heading', { name: 'Blank editor' })).toBeVisible();
  await expect(guest.getByRole('heading', { name: 'Blank editor' })).toBeVisible();
  await expect(guest.locator('.view-lines')).toContainText('Hello from the interview room');
  await expect(guest.locator('.view-lines')).not.toContainText('typed by the candidate');
  await expect(guest.getByTestId('run-tests')).toHaveCount(0);
  await guest.screenshot({ path: 'e2e/.screens/real-room-guest.png' });
  // ...and back: the candidate's work is still there.
  await host.getByTestId('change-problem').click();
  await dialog.getByLabel('Search problems').fill('two sum');
  await dialog
    .getByRole('radio', { name: /^Two Sum/ })
    .first()
    .click();
  await dialog.getByRole('button', { name: 'Change problem' }).click();
  await expect(guest.locator('.view-lines')).toContainText('typed by the candidate');

  // A guest has no other page.
  const elsewhere = await guestCtx.newPage();
  await elsewhere.goto('/dashboard');
  await expect(elsewhere).toHaveURL(/\/sign-in/);
  await elsewhere.close();

  // End: the report is the host's, with the notes; the candidate keeps a read-only pad.
  await host.getByRole('button', { name: 'End interview' }).click();
  await host.getByRole('button', { name: 'End and see report' }).click();
  await expect(host).toHaveURL(/\/report$/);
  await expect(host.getByLabel('Your private notes')).toHaveValue('Good start.');
  await expect(host.getByText('Want a second opinion on this interview?')).toBeVisible();
  await expect(host.getByText('Problem changed to')).toHaveCount(2);
  await host.screenshot({ path: 'e2e/.screens/real-room-report.png', fullPage: true });
  await expect(guest.getByText('This interview has ended. The pad is read-only.')).toBeVisible();
  await expect(guest.getByRole('link', { name: /report/i })).toHaveCount(0);

  expect(problems).toEqual([]);
  await hostCtx.close();
  await guestCtx.close();
});
