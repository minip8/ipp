import { expect, test } from '@playwright/test';
import { ACTIVE_PAD_ID, COLLAB_PAD_ID, ENDED_PAD_ID } from './fixtures';
import { setup } from './helpers';

const history = (page: import('@playwright/test').Page) => page.getByRole('table').getByRole('row');
/** Finished interviews are in the History view of the Interviews page. */
const HISTORY = '/software/interviews?view=history';

test('owner deletes a finished interview from history after confirming', async ({ page }) => {
  const backend = await setup(page);
  await page.goto(HISTORY);
  await expect(history(page).filter({ hasText: 'LRU Cache' })).toHaveCount(1);

  // Cancel keeps it.
  await page.getByRole('button', { name: 'Delete interview: LRU Cache' }).click();
  const dialog = page.getByRole('dialog', { name: /Delete “LRU Cache”\?/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('cannot be undone');
  await expect(dialog).toContainText('report');
  await expect(dialog).toContainText('playback');
  await expect(dialog).toContainText('transcript');
  await expect(dialog).not.toContainText('session in progress');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(backend.deleted).toEqual([]);

  await page.getByRole('button', { name: 'Delete interview: LRU Cache' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete interview' }).click();
  await expect(page.getByText('Interview deleted')).toBeVisible();
  await expect(history(page).filter({ hasText: 'LRU Cache' })).toHaveCount(0);
  await expect(history(page).filter({ hasText: 'Merge Intervals' })).toHaveCount(1);
  expect(backend.deleted).toEqual([ENDED_PAD_ID]);
  expect(
    backend.requests.filter((r) => r.method === 'DELETE' && r.path === `/api/pads/${ENDED_PAD_ID}`),
  ).toHaveLength(1);
});

test('a failed delete keeps the row and shows the error; retry works', async ({ page }) => {
  const backend = await setup(page, (b) =>
    b.fail(/^DELETE \/api\/pads\//, 503, {
      error: { code: 'unavailable', message: 'The service is busy. Try again shortly.' },
    }),
  );
  await page.goto(HISTORY);
  await page.getByRole('button', { name: 'Delete interview: Merge Intervals' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete interview' }).click();
  await expect(dialog.getByRole('alert')).toContainText('The interview was not deleted.');
  await expect(dialog.getByRole('alert')).toContainText('The service is busy');
  // The open dialog hides the page from the accessibility tree, so look at the DOM itself.
  await expect(page.locator('table tr').filter({ hasText: 'Merge Intervals' })).toHaveCount(1);
  expect(backend.deleted).toEqual([]);

  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(history(page).filter({ hasText: 'Merge Intervals' })).toHaveCount(0);
});

test('a collaborator removes a joined interview from their history', async ({ page }) => {
  const backend = await setup(page);
  await page.goto(HISTORY);
  await expect(
    page.getByRole('button', { name: 'Delete interview: Number of Islands' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove from history: Number of Islands' }).click();
  const dialog = page.getByRole('dialog', { name: /Remove “Number of Islands” from your history/ });
  await expect(dialog).toContainText('owner keeps it');
  await dialog.getByRole('button', { name: 'Remove from history' }).click();
  await expect(page.getByText('Removed from your history')).toBeVisible();
  await expect(history(page).filter({ hasText: 'Number of Islands' })).toHaveCount(0);
  expect(backend.deleted).toEqual([COLLAB_PAD_ID]);
});

test('deleting an in-progress interview says it ends the session', async ({ page }) => {
  const backend = await setup(page);
  await page.goto('/software/interviews');
  const inProgress = page.getByRole('region', { name: 'In progress' });
  await expect(inProgress).toContainText('Two Sum');
  await inProgress.getByRole('button', { name: 'Delete interview: Two Sum' }).click();
  const dialog = page.getByRole('dialog', { name: /Delete “Two Sum”\?/ });
  await expect(dialog).toContainText('session in progress ends');
  await dialog.getByRole('button', { name: 'Delete interview' }).click();
  await expect(page.getByRole('region', { name: 'In progress' })).toHaveCount(0);
  expect(backend.deleted).toEqual([ACTIVE_PAD_ID]);
});

test('delete from the report page returns to the dashboard', async ({ page }) => {
  const backend = await setup(page);
  await page.goto(`/pads/${ENDED_PAD_ID}/report`);
  await expect(page.getByRole('heading', { level: 1, name: 'LRU Cache' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete interview' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete interview' }).click();
  await expect(page).toHaveURL(/\/software\/interviews$/);
  await expect(page.getByText('Interview deleted')).toBeVisible();
  await page.getByRole('tab', { name: /^History/ }).click();
  await expect(history(page).filter({ hasText: 'Merge Intervals' })).toHaveCount(1);
  await expect(history(page).filter({ hasText: 'LRU Cache' })).toHaveCount(0);
  expect(backend.deleted).toEqual([ENDED_PAD_ID]);
});

test('an open pad shows it is gone when the pad is deleted elsewhere', async ({ page }) => {
  const backend = await setup(page);
  await page.goto(`/pads/${ACTIVE_PAD_ID}`);
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 20_000 });
  backend.removePad(ACTIVE_PAD_ID);
  await expect(page.getByRole('heading', { name: 'This pad is not available' })).toBeVisible();
  await expect(page.getByText(/It was deleted/)).toBeVisible();
});
