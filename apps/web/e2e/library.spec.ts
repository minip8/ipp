import { expect, type Page, test } from '@playwright/test';
import { ACTIVE_PAD_ID } from './fixtures';
import { setup } from './helpers';

const rows = (page: Page) =>
  page.getByRole('region', { name: 'Problem library' }).locator('button[aria-pressed]');
const titles = async (page: Page) =>
  (await rows(page).locator('span.block.font-medium').allTextContents()).sort();

/** The library beside the coding room setup ("Interview someone"). */
const LIBRARY = '/software/interviews?mode=host';

async function chooseOption(page: Page, combobox: string, option: string) {
  await page.getByRole('combobox', { name: combobox, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('problem library', () => {
  test('nothing is selected by default and Start waits for a problem', async ({ page }) => {
    await setup(page);
    await page.goto(LIBRARY);
    await expect(page.locator('#interview-setup')).toContainText('No problem selected');
    await expect(page.getByRole('button', { name: 'Create room' })).toBeDisabled();
    await expect(page.getByText('Choose a problem or a blank editor to start.')).toBeVisible();
    await page.getByRole('button', { name: /^Merge Intervals/ }).click();
    await expect(page.getByTestId('selected-problem')).toHaveText('Merge Intervals');
    await expect(page.getByRole('button', { name: 'Create room' })).toBeEnabled();
  });

  test('categories organise the library', async ({ page }) => {
    await setup(page);
    await page.goto(LIBRARY);
    await expect(rows(page)).toHaveCount(15);
    await page.getByRole('tab', { name: /^Implementation/ }).click();
    await expect(page.getByText('Practical code with no trick to spot')).toBeVisible();
    expect(await titles(page)).toEqual(['Key-Value Store with Transactions', 'Text Justification']);
    await page.getByRole('tab', { name: /^Data structures/ }).click();
    expect(await titles(page)).toEqual(['LRU Cache', 'Min Stack', 'Unique Pointer']);
    // Counts follow the other filters.
    await page.getByRole('radio', { name: 'Hard' }).click();
    await expect(page.getByRole('tab', { name: /^Implementation/ })).toContainText('1');
    await expect(page.getByRole('tab', { name: /^DSA/ })).toContainText('3');
  });

  test('topics stay hidden until asked for, and search ignores them meanwhile', async ({
    page,
  }) => {
    await setup(page);
    await page.goto(LIBRARY);
    const lru = page.getByRole('button', { name: /^LRU Cache/ });
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
    await page.goto(LIBRARY);
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
    await page.goto(LIBRARY);
    // In Python the C++-only Unique Pointer is never picked, which leaves two candidates.
    await page.getByRole('radio', { name: 'Python' }).click();
    await page.getByRole('tab', { name: /^Data structures/ }).click();
    await expect(page.getByText('One of the 2 problems in Python that match')).toBeVisible();
    await page.getByRole('button', { name: 'Pick a random problem' }).click();
    const title = page.getByTestId('selected-problem');
    const first = await title.textContent();
    expect(['LRU Cache', 'Min Stack']).toContain(first);
    // With two candidates, a re-roll always lands on the other one.
    await page.getByRole('button', { name: 'Pick another random problem' }).click();
    await expect(title).toHaveText(first === 'LRU Cache' ? 'Min Stack' : 'LRU Cache');
    expect(backend.requests.some((r) => r.method === 'POST' && r.path === '/api/pads')).toBe(false);
    await page.getByRole('button', { name: 'Create room' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(create?.body).toMatchObject({
      problemSlug: first === 'LRU Cache' ? 'min-stack' : 'lru-cache',
    });
  });

  test('a C++-only problem is marked, switches the language to C++ and keeps the preference', async ({
    page,
  }) => {
    const backend = await setup(page);
    await page.goto(LIBRARY);
    await page.getByRole('radio', { name: 'Python' }).click();
    const row = page.getByRole('button', { name: /^Unique Pointer/ });
    await expect(row.getByTestId('language-restriction')).toHaveText('C++ only');
    await expect(
      page.getByRole('button', { name: /^LRU Cache/ }).getByTestId('language-restriction'),
    ).toHaveCount(0);
    await row.click();
    const setup_ = page.locator('#interview-setup');
    await expect(setup_.getByTestId('language-restriction')).toHaveText('C++ only');
    const langs = page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio');
    await expect(langs).toHaveText(['C++']);
    await expect(langs.first()).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('language-note')).toContainText(
      'Unique Pointer can only be solved in C++, so this interview uses C++',
    );
    // Another problem brings the preferred language back.
    await page.getByRole('button', { name: /^LRU Cache/ }).click();
    await expect(langs).toHaveText(['C++', 'Python', 'Java']);
    await expect(page.getByRole('radio', { name: 'Python' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('button', { name: /^Unique Pointer/ }).click();
    await page.getByRole('button', { name: 'Create room' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(create?.body).toMatchObject({ problemSlug: 'unique-pointer', language: 'cpp' });
    const prefs = await page.evaluate(() => localStorage.getItem('ipp:start-prefs'));
    expect(JSON.parse(prefs ?? '{}')).toMatchObject({ language: 'python' });
    // In the pad, the language switcher cannot leave C++.
    await expect(page.getByRole('combobox', { name: 'Language' })).toBeDisabled({
      timeout: 20_000,
    });
  });

  test('solved and attempted problems are marked, and a status filter narrows the library', async ({
    page,
  }) => {
    await setup(page);
    await page.goto(LIBRARY);
    const row = (name: RegExp) =>
      page.getByRole('region', { name: 'Problem library' }).getByRole('button', { name });
    const mark = (name: RegExp) => row(name).getByTestId('problem-status');
    await expect(mark(/^LRU Cache/)).toHaveAttribute('data-status', 'solved');
    await expect(mark(/^Two Sum/)).toHaveAttribute('data-status', 'attempted');
    await expect(mark(/^Word Ladder/)).toHaveAttribute('data-status', 'new');
    // Said, not only drawn.
    await expect(row(/^LRU Cache/)).toHaveAccessibleName(/^LRU Cache \. Solved\./);
    await expect(row(/^Two Sum/)).toHaveAccessibleName(/^Two Sum \. Attempted, not solved\./);
    await expect(row(/^Word Ladder/)).toHaveAccessibleName(/^Word Ladder \. Not attempted\./);

    const status = page.getByRole('radiogroup', { name: 'Status' });
    await expect(status.getByRole('radio')).toHaveText([
      'All 15',
      'New 10',
      'Attempted 3',
      'Solved 2',
    ]);
    await status.getByRole('radio', { name: /^Solved/ }).click();
    expect(await titles(page)).toEqual(['LRU Cache', 'Merge Intervals']);
    // The category tabs count what the status leaves.
    await expect(page.getByRole('tab', { name: /^Data structures/ })).toContainText('1');
    await status.getByRole('radio', { name: /^Attempted/ }).click();
    expect(await titles(page)).toEqual(['Number of Islands', 'Trapping Rain Water', 'Two Sum']);
    // And the status counts follow the other filters.
    await page.getByRole('radio', { name: 'Hard', exact: true }).click();
    await expect(status.getByRole('radio')).toHaveText([
      'All 4',
      'New 3',
      'Attempted 1',
      'Solved 0',
    ]);
    expect(await titles(page)).toEqual(['Trapping Rain Water']);

    // The chosen problem says where the user stands on it.
    await row(/^Trapping Rain Water/).click();
    await expect(page.getByTestId('selected-problem-status')).toHaveText('Attempted');
    await status.getByRole('radio', { name: /^New/ }).click();
    await row(/^Word Ladder/).click();
    await expect(page.getByTestId('selected-problem-status')).toHaveCount(0);

    // Clearing the filters clears the status too.
    await status.getByRole('radio', { name: /^Solved/ }).click();
    await expect(page.getByText('No problems match these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows(page)).toHaveCount(15);
    await expect(status.getByRole('radio', { name: /^All/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('a newcomer sees every problem as new; without progress the library works unmarked', async ({
    page,
  }) => {
    await setup(page, (b) => {
      b.problemProgress = [];
    });
    await page.goto(LIBRARY);
    await expect(page.getByTestId('problem-status').first()).toBeVisible();
    await expect(
      page.locator('[data-testid="problem-status"]:not([data-status="new"])'),
    ).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Status' }).getByRole('radio')).toHaveText([
      'All 15',
      'New 15',
      'Attempted 0',
      'Solved 0',
    ]);

    await setup(page, (b) =>
      b.fail(/^GET \/api\/progress\/problems/, 500, {
        error: { code: 'internal', message: 'boom' },
      }),
    );
    await page.reload();
    await expect(rows(page)).toHaveCount(15);
    await expect(page.getByTestId('problem-status')).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Status' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Two Sum/ }).click();
    await expect(page.getByRole('button', { name: 'Create room' })).toBeEnabled();
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

test.describe('interview setup panel', () => {
  // A laptop-sized window: the whole panel (statement preview, language, duration, interviewer
  // settings) is taller than the window.
  test.use({ viewport: { width: 1280, height: 620 } });

  test('Start stays in view without scrolling the page; the settings scroll inside the panel', async ({
    page,
  }) => {
    await setup(page);
    // The builder's panel: the plan's total, the interviewer's options and Start.
    await page.goto('/software/interviews?preset=onsite-loop');
    const start = page.getByRole('button', { name: 'Start the interview' });
    await expect(start).toBeEnabled();
    await expect(start).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Everything above it is still reachable by scrolling the panel itself.
    const panel = page.locator('#interview-setup');
    expect(
      await panel.evaluate((el) => el.scrollHeight > el.clientHeight),
      'the panel should be scrollable at this height',
    ).toBe(true);
    await page.getByLabel('Voice').scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Voice')).toBeInViewport();
    await expect(start).toBeInViewport({ ratio: 1 });
    // ...and it still follows the page when the plan is scrolled.
    await page.mouse.move(300, 400);
    await page.mouse.wheel(0, 600);
    await expect(start).toBeInViewport({ ratio: 1 });
  });
});
