/** The New / History view switch on the Interviews and Practice tabs, and their phone layout. */
import { expect, type Page, test } from '@playwright/test';
import { setup } from './helpers';

const noSideScroll = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);

test.describe('Interviews page views', () => {
  test('History is its own view, in the URL; the setup survives a look at it', async ({ page }) => {
    await setup(page);
    await page.goto('/software/interviews?mode=host');
    const tabs = page.getByRole('tablist', { name: 'Interviews' });
    const start = tabs.getByRole('tab', { name: /^New interview/ });
    const history = tabs.getByRole('tab', { name: /^History/ });
    await expect(start).toHaveAttribute('aria-selected', 'true');
    // The count is on the tab; nothing about history is under the start view.
    await expect(history).toContainText('4');
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'In progress' })).toBeVisible();

    await page.getByRole('button', { name: /^LRU Cache/ }).click();
    await page.getByRole('radio', { name: 'Python' }).click();
    await history.click();
    // The page's other params are kept.
    await expect(page).toHaveURL(/\/software\/interviews\?mode=host&view=history$/);
    await expect(history).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('table').getByRole('row').filter({ hasText: 'LRU Cache' }),
    ).toHaveCount(1);
    // In progress stays above the tabs in both views.
    await expect(page.getByRole('region', { name: 'In progress' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create room' })).toBeHidden();

    // Back returns to the setup as it was left.
    await page.goBack();
    await expect(page).toHaveURL(/\/software\/interviews\?mode=host$/);
    await expect(start).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('selected-problem')).toHaveText('LRU Cache');
    await expect(page.getByRole('radio', { name: 'Python' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Create room' })).toBeEnabled();
    // And choosing the mode afterwards does not bring the view back into the URL.
    await page.getByRole('radio', { name: 'Practise with the AI' }).click();
    await expect(page).toHaveURL(/\/software\/interviews$/);
  });

  test('a link opens History directly; arrow keys switch views', async ({ page }) => {
    await setup(page);
    await page.goto('/software/interviews?view=history');
    const history = page.getByRole('tab', { name: /^History/ });
    await expect(history).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: /^History/ })).toContainText('Merge Intervals');
    await expect(page.getByRole('region', { name: 'Problem library' })).toBeHidden();

    await history.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/\/software\/interviews$/);
    await expect(page.getByRole('tab', { name: /^New interview/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('region', { name: 'Problem library' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});

test.describe('Practice views', () => {
  test('History is its own view; the topics and mode survive a switch', async ({ page }) => {
    await setup(page);
    await page.goto('/software/practice?topic=networking');
    const history = page.getByRole('tab', { name: /^History/ });
    await expect(page.getByRole('tab', { name: /^Start a quiz/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(history).toContainText('3');
    await expect(page.getByRole('region', { name: 'Past quizzes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Networking/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('radio', { name: 'Exam' }).click();

    await history.click();
    await expect(page).toHaveURL(/\/software\/practice\?topic=networking&view=history$/);
    await expect(page.getByRole('region', { name: 'Past quizzes' }).getByRole('link')).toHaveCount(
      3,
    );
    await expect(page.getByRole('button', { name: 'Start quiz' })).toBeHidden();

    await page.getByRole('tab', { name: /^Start a quiz/ }).click();
    await expect(page).toHaveURL(/\/software\/practice\?topic=networking$/);
    await expect(page.getByRole('button', { name: /^Networking/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('radio', { name: 'Exam' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Start quiz' })).toBeEnabled();
  });
});

test.describe('on a small phone', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('Interviews: no sideways scroll, a bar to the setup, history as a list', async ({
    page,
  }) => {
    await setup(page);
    // Chosen by the link, so nothing has scrolled the setup into view yet.
    await page.goto('/software/interviews?problem=lru-cache');
    await expect(page.getByTestId('selected-problem')).toHaveText('LRU Cache');
    await noSideScroll(page);
    const toSetup = page.getByRole('button', { name: 'Set up interview' });
    await expect(toSetup).toBeVisible();
    await toSetup.click();
    // Once the setup is on screen, Start is in reach and the bar gives way.
    await expect(page.getByRole('button', { name: 'Start interview' })).toBeInViewport();
    await expect(toSetup).toBeHidden();

    await page.getByRole('tab', { name: /^History/ }).click();
    await expect(page.getByRole('table')).toBeHidden();
    const entries = page.getByRole('list', { name: 'Finished interviews' }).getByRole('listitem');
    await expect(entries).toHaveCount(4);
    await expect(entries.filter({ hasText: 'LRU Cache' })).toContainText('Solved');
    await expect(page.getByRole('link', { name: 'Report for LRU Cache' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete interview: LRU Cache' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set up interview' })).toBeHidden();
    await noSideScroll(page);
  });

  test('Practice: no sideways scroll; the bottom bar is only on the start view', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/software/practice?topic=networking');
    await expect(page.getByTestId('setup-summary')).toContainText('Networking');
    await noSideScroll(page);
    const toSetup = page.getByRole('button', { name: 'Choose mode' });
    await expect(toSetup).toBeVisible();
    await page.getByRole('tab', { name: /^History/ }).click();
    await expect(toSetup).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Past quizzes' }).getByRole('link')).toHaveCount(
      3,
    );
    await noSideScroll(page);
    await page.getByRole('tab', { name: /^Start a quiz/ }).click();
    await expect(toSetup).toBeVisible();
  });
});
