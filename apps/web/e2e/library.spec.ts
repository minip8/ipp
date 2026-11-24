import { expect, type Page, test } from '@playwright/test';
import { ACTIVE_PAD_ID } from './fixtures';
import { setup } from './helpers';

const rows = (page: Page) => page.getByRole('tabpanel').locator('button[aria-pressed]');
const titles = async (page: Page) =>
  (await rows(page).locator('span.block.font-medium').allTextContents()).sort();

async function chooseOption(page: Page, combobox: string, option: string) {
  await page.getByRole('combobox', { name: combobox, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('problem library', () => {
  test('nothing is selected by default and Start waits for a problem', async ({ page }) => {
    await setup(page);
    await page.goto('/new');
    await expect(page.locator('#interview-setup')).toContainText('No problem selected');
    await expect(page.getByRole('button', { name: 'Start interview' })).toBeDisabled();
    await expect(page.getByText('Choose a problem to start.')).toBeVisible();
    await page.getByRole('button', { name: /Merge Intervals/ }).click();
    await expect(page.getByTestId('selected-problem')).toHaveText('Merge Intervals');
    await expect(page.getByRole('button', { name: 'Start interview' })).toBeEnabled();
  });

  test('categories organise the library', async ({ page }) => {
    await setup(page);
    await page.goto('/new');
    await expect(rows(page)).toHaveCount(14);
    await page.getByRole('tab', { name: /^Implementation/ }).click();
    await expect(page.getByText('Practical code with no trick to spot')).toBeVisible();
    expect(await titles(page)).toEqual(['Key-Value Store with Transactions', 'Text Justification']);
    await page.getByRole('tab', { name: /^Data structures/ }).click();
    expect(await titles(page)).toEqual(['LRU Cache', 'Min Stack']);
    // Counts follow the other filters.
    await page.getByRole('radio', { name: 'Hard' }).click();
    await expect(page.getByRole('tab', { name: /^Implementation/ })).toContainText('1');
    await expect(page.getByRole('tab', { name: /^DSA/ })).toContainText('3');
  });

  test('topics stay hidden until asked for, and search ignores them meanwhile', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/new');
    const lru = page.getByRole('button', { name: /LRU Cache/ });
    await expect(lru).not.toContainText('Linked list');
    const search = page.getByRole('searchbox', { name: 'Search problems' });
    await search.fill('hash');
    await expect(page.getByText('No problems match these filters')).toBeVisible();

    await page.getByRole('switch', { name: 'Show topics' }).click();
    await expect(rows(page)).toHaveCount(4);
    await search.fill('');
    await expect(lru).toContainText('Linked list');
    // The choice is remembered.
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Show topics' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('a topic group shows all its problems; a subtopic narrows it', async ({ page }) => {
    await setup(page);
    await page.goto('/new');
    await expect(page.getByRole('combobox', { name: 'Subtopic' })).toHaveCount(0);
    await chooseOption(page, 'Topic', 'Graphs');
    expect(await titles(page)).toEqual(['Course Schedule', 'Number of Islands', 'Word Ladder']);
    await page.getByRole('combobox', { name: 'Subtopic' }).click();
    // Only subtopics that some problem has.
    await expect(page.getByRole('option')).toHaveText([
      'All subtopics',
      'Breadth-first search',
      'Depth-first search',
      'Topological sort',
    ]);
    await page.getByRole('option', { name: 'Breadth-first search' }).click();
    expect(await titles(page)).toEqual(['Number of Islands', 'Word Ladder']);
    // A group without subtopics in the library has no second control.
    await chooseOption(page, 'Topic', 'Binary search');
    await expect(page.getByRole('combobox', { name: 'Subtopic' })).toHaveCount(0);
    expect(await titles(page)).toEqual(['Median of Two Sorted Arrays']);
  });

  test('a random pick respects the filters, shows the problem and can be re-rolled', async ({
    page,
  }) => {
    const backend = await setup(page);
    await page.goto('/new');
    await page.getByRole('tab', { name: /^Data structures/ }).click();
    await page.getByRole('button', { name: 'Pick a random problem' }).click();
    const title = page.getByTestId('selected-problem');
    const first = await title.textContent();
    expect(['LRU Cache', 'Min Stack']).toContain(first);
    // With two candidates, a re-roll always lands on the other one.
    await page.getByRole('button', { name: 'Pick another random problem' }).click();
    await expect(title).toHaveText(first === 'LRU Cache' ? 'Min Stack' : 'LRU Cache');
    expect(backend.requests.some((r) => r.method === 'POST' && r.path === '/api/pads')).toBe(false);
    await page.getByRole('button', { name: 'Start interview' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(create?.body).toMatchObject({
      problemSlug: first === 'LRU Cache' ? 'min-stack' : 'lru-cache',
    });
  });

  test('the interview problem panel hides topics until revealed', async ({ page }) => {
    await setup(page);
    await page.goto(`/pads/${ACTIVE_PAD_ID}`);
    const panel = page.getByRole('tabpanel', { name: 'Problem' });
    await expect(panel.getByRole('heading', { name: 'Two Sum' })).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('DSA');
    await expect(panel).not.toContainText('Hash table');
    await panel.getByRole('button', { name: 'Show topics' }).click();
    await expect(panel).toContainText('Hash table');
  });
});
