/**
 * The Roadmap tab's topic maps (`?view=maps`): a graph of study areas per topic of the track with
 * the user's progress, a details panel (a sheet on phones) and practice narrowed to one area.
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus } from './fixtures';
import { QUIZ_ROADMAP_FRESH } from './fixtures-quiz-roadmap';
import { setup } from './helpers';

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const details = (page: Page) => page.getByTestId('roadmap-details');

async function noSideScroll(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);
}

test.describe('quiz roadmap', () => {
  test('is the second view of the Roadmap tab, its topics the track’s, flat', async ({ page }) => {
    await setup(page);
    await page.goto('/software/roadmap');
    const tabs = page.getByRole('tablist', { name: 'Roadmap' }).getByRole('tab');
    await expect(tabs).toHaveText(['Study path', 'Topic maps']);
    await page.getByRole('tab', { name: 'Topic maps' }).click();
    await expect(page).toHaveURL(/\/software\/roadmap\?view=maps$/);
    // The track's topics in study order, one row, the first chosen; its graph and overview.
    const switcher = page.getByRole('radiogroup', { name: 'Roadmap topic' });
    await expect(switcher.getByRole('radio')).toHaveText([
      /^C\+\+/,
      /^Python/,
      /^Computer architecture/,
      /^Operating systems/,
      /^Concurrency/,
      /^Networking/,
    ]);
    await expect(page.getByText('Fundamentals', { exact: true })).toHaveCount(0);
    await expect(switcher.getByRole('radio').first()).toHaveAccessibleName(
      /^C\+\+: 3 of 15 areas complete/,
    );
    await expect(switcher.getByRole('radio', { name: /^C\+\+/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('group', { name: 'C++ study areas' })).toBeVisible();
    await expect(page.getByTestId('roadmap-summary')).toHaveText(
      '3 of 15 areas complete · 3 in progress',
    );
    await expect(page.getByTestId('roadmap-overview')).toContainText('Next up');

    // Quant: its own topics and the shared Python, the same progress in both.
    await page.goto('/quant/roadmap?view=maps');
    await expect(switcher.getByRole('radio')).toHaveText([/^Python/, /^Probability/]);
    await switcher.getByRole('radio', { name: /^Probability/ }).click();
    await expect(page).toHaveURL(/\/quant\/roadmap\?view=maps&roadmap=probability$/);
    await switcher.getByRole('radio', { name: /^Python/ }).click();
    await expect(page).toHaveURL(/\/quant\/roadmap\?view=maps&roadmap=python$/);
    await expect(page.getByTestId('roadmap-summary')).toHaveText(
      '1 of 14 areas complete · 3 in progress',
    );
    await page.goto('/software/roadmap?view=maps&roadmap=python');
    await expect(page.getByTestId('roadmap-summary')).toHaveText(
      '1 of 14 areas complete · 3 in progress',
    );
  });

  test('a topic of the other track only opens in that track', async ({ page }) => {
    await setup(page);
    await page.goto('/software/roadmap?view=maps&roadmap=probability&node=prob-counting');
    await expect(page).toHaveURL(
      /\/quant\/roadmap\?view=maps&roadmap=probability&node=prob-counting$/,
    );
    await expect(page.getByRole('group', { name: 'Probability study areas' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Track' }).locator('[aria-current]'),
    ).toHaveText('Quant');
    // Each track remembers its own last topic.
    await page.goto('/software/roadmap?view=maps');
    await expect(
      page.getByRole('radiogroup', { name: 'Roadmap topic' }).getByRole('radio', { checked: true }),
    ).toHaveText(/^C\+\+/);
    await page.goto('/quant/roadmap?view=maps');
    await expect(
      page.getByRole('radiogroup', { name: 'Roadmap topic' }).getByRole('radio', { checked: true }),
    ).toHaveText(/^Probability/);
  });

  test('shows each area with its progress and state, in words as well as colour', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/software/roadmap?view=maps&roadmap=cpp');
    await expect(page.getByTestId('roadmap-node')).toHaveCount(15);
    await expect(node(page, 'cpp-initialization')).toHaveAttribute('data-state', 'complete');
    await expect(node(page, 'cpp-initialization')).toHaveAccessibleName(
      'Initialization. Complete. 16 of 16 answered, 14 correct.',
    );
    const move = node(page, 'cpp-move-semantics');
    await expect(move).toHaveAttribute('data-state', 'in_progress');
    await expect(move).toHaveAccessibleName(/^Move semantics\. In progress\. .* next up\.$/);
    // Builds on an area that is not complete yet: not next up, still open.
    await expect(node(page, 'cpp-templates')).toHaveAccessibleName(
      /^Templates and constexpr\. Not started\. 0 of 37 answered, 0 correct\.$/,
    );
    await expect(page.getByRole('list', { name: 'Legend' })).toContainText('Next up');
  });

  test('switching topics is kept in the URL and survives a reload', async ({ page }) => {
    await setup(page);
    await page.goto('/software/roadmap?view=maps');
    await page.getByRole('radio', { name: /^Python/ }).click();
    await expect(page).toHaveURL(/view=maps&roadmap=python$/);
    await expect(page.getByRole('group', { name: 'Python study areas' })).toBeVisible();
    await node(page, 'py-classes').click();
    await expect(page).toHaveURL(/roadmap=python&node=py-classes$/);
    await page.reload();
    await expect(page.getByRole('radio', { name: /^Python/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(details(page).getByRole('heading', { name: 'Classes' })).toBeVisible();
    // Another topic starts with nothing selected.
    await page.getByRole('radio', { name: /^Networking/ }).click();
    await expect(page).toHaveURL(/roadmap=networking$/);
    await expect(page.getByTestId('roadmap-overview')).toBeVisible();
  });

  test('selecting an area shows its details and moves along its prerequisites', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/software/roadmap?view=maps&roadmap=cpp');
    const move = node(page, 'cpp-move-semantics');
    await move.click();
    await expect(move).toHaveAttribute('aria-pressed', 'true');
    const panel = details(page);
    await expect(panel.getByRole('heading', { name: 'Move semantics' })).toBeVisible();
    await expect(panel.getByTestId('roadmap-answered')).toHaveText('6/20');
    await expect(panel.getByRole('region', { name: 'Builds on' }).getByRole('button')).toHaveText([
      /^Object lifetime/,
    ]);
    await expect(panel.getByRole('region', { name: 'Leads to' }).getByRole('button')).toHaveText([
      /^Ownership and exceptions/,
      /^Containers and strings/,
    ]);
    // Each subtopic links to its questions in the bank, as does Browse.
    const covers = panel.getByRole('region', { name: 'Covers' }).getByRole('link');
    await expect(covers).toHaveCount(1);
    await expect(covers.first()).toHaveAttribute(
      'href',
      '/quiz/topics/cpp?subtopic=Value+categories+and+move+semantics',
    );
    await expect(
      panel.getByRole('link', { name: 'Browse questions in Move semantics' }),
    ).toHaveAttribute('href', '/quiz/topics/cpp?subtopic=Value+categories+and+move+semantics');

    // Following a prerequisite moves the selection.
    await panel.getByRole('region', { name: 'Builds on' }).getByRole('button').click();
    await expect(node(page, 'cpp-object-lifetime')).toHaveAttribute('aria-pressed', 'true');
    await expect(move).toHaveAttribute('aria-pressed', 'false');
    await expect(details(page).getByRole('heading', { name: 'Object lifetime' })).toBeVisible();
    await expect(details(page)).toContainText('Complete. Practise again whenever you like.');
    // Clicking the selected area again clears the selection.
    await node(page, 'cpp-object-lifetime').click();
    await expect(page.getByTestId('roadmap-overview')).toBeVisible();
  });

  test('related areas of other topics are listed on both sides and switch topic', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/software/roadmap?view=maps&roadmap=cpp&node=cpp-concurrency');
    const related = () =>
      details(page).getByRole('region', { name: 'Related in other topics' }).getByRole('button');
    // Written on this area in roadmap.yaml; each names its topic.
    await expect(related()).toHaveText([
      /^Races and thread safety, in Concurrency/,
      /^Atomics and CAS, in Concurrency/,
      /^Memory ordering, in Concurrency/,
    ]);
    await related().nth(1).click();
    await expect(page).toHaveURL(/roadmap=concurrency/);
    await expect(page).toHaveURL(/node=cc-atomics/);
    await expect(node(page, 'cc-atomics')).toHaveAttribute('aria-pressed', 'true');
    await expect(details(page).getByRole('heading', { name: 'Atomics and CAS' })).toBeVisible();
    // The same link, seen from the side it is not written on.
    await expect(related()).toHaveText([/^Concurrency, in C\+\+/]);

    // An area with no such link has no section at all.
    await node(page, 'cc-mutexes').click();
    await expect(details(page).getByRole('heading', { name: 'Mutexes and locks' })).toBeVisible();
    await expect(
      details(page).getByRole('region', { name: 'Related in other topics' }),
    ).toHaveCount(0);
  });

  test('Practise starts a practice quiz on that area', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/software/roadmap?view=maps&roadmap=cpp&node=cpp-undefined-behaviour');
    await expect(details(page)).toContainText('Every question answered. Get to 70% accuracy');
    await details(page).getByRole('button', { name: 'Practise' }).click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]{36}$/);
    const req = backend.requests.find(
      (r) => r.method === 'POST' && r.path === '/api/quiz/attempts',
    );
    expect(req?.body).toEqual({
      topics: ['cpp'],
      nodes: ['cpp-undefined-behaviour'],
      mode: 'practice',
      count: 10,
      focusWeak: true,
    });
  });

  test('a discussion needs a key: the prompt instead of a request', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/software/roadmap?view=maps&roadmap=cpp&node=cpp-move-semantics');
    await details(page).getByRole('button', { name: 'Discuss' }).click();
    await expect(page.getByTestId('roadmap-key-prompt')).toContainText(
      'A discussion runs on your own AI API key',
    );
    expect(
      backend.requests.some((r) => r.path === '/api/quiz/attempts' && r.method === 'POST'),
    ).toBe(false);
  });

  test('an error starting is shown in the panel', async ({ page }) => {
    await setup(page, (b) => {
      b.fail(/^POST \/api\/quiz\/attempts$/, 404, {
        error: { code: 'not_found', message: 'Questions for these topics not found' },
      });
    });
    await page.goto('/software/roadmap?view=maps&roadmap=cpp&node=cpp-move-semantics');
    await details(page).getByRole('button', { name: 'Practise' }).click();
    await expect(details(page).getByRole('alert')).toContainText('not found');
    await expect(page).toHaveURL(/view=maps/);
  });

  test('a first visit: nothing started, the roots next up', async ({ page }) => {
    await setup(page, (b) => {
      b.quizRoadmap = QUIZ_ROADMAP_FRESH;
    });
    await page.goto('/software/roadmap?view=maps&roadmap=cpp');
    await expect(page.getByTestId('roadmap-summary')).toHaveText('0 of 15 areas complete');
    await expect(page.locator('[data-next]')).toHaveCount(2);
    await expect(node(page, 'cpp-initialization')).toHaveAttribute('data-next', 'true');
    await expect(node(page, 'cpp-conversions')).toHaveAttribute('data-next', 'true');
    await expect(page.locator('[data-state="not_started"]')).toHaveCount(15);
  });

  test('loading and failure', async ({ page }) => {
    await setup(page, (b) => {
      // The first try and both of React Query's retries.
      b.fail(
        /^GET \/api\/quiz\/roadmap$/,
        500,
        { error: { code: 'internal', message: 'Something broke' } },
        3,
      );
    });
    await page.goto('/software/roadmap?view=maps');
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('roadmap-node').first()).toBeVisible();
  });

  test('keyboard: every area is reachable, arrows follow the graph, Enter selects', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/software/roadmap?view=maps&roadmap=cpp');
    await expect(page.getByTestId('roadmap-node')).toHaveCount(15);
    const ids = await page
      .getByTestId('roadmap-node')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-node')));
    // In the DOM (so the tab order) layer by layer from the top.
    expect(ids.slice(0, 2).sort()).toEqual(['cpp-conversions', 'cpp-initialization']);
    expect(ids.at(-1)).toBe('cpp-concurrency');

    await page.getByRole('radio', { name: /^Networking/ }).focus();
    // The switcher is one tab stop; the next ones are the graph's areas.
    await page.keyboard.press('Tab');
    await expect(page.locator(`[data-node="${ids[0]}"]`)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator(`[data-node="${ids[1]}"]`)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(`[data-node="${ids[0]}"]`)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const below = await page.evaluate(() => document.activeElement?.getAttribute('data-node'));
    expect(ids.slice(2, 5)).toContain(below);
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-node="${below}"]`)).toHaveAttribute('aria-pressed', 'true');
    // The focus ring shows.
    const outline = await page
      .locator(`[data-node="${below}"]`)
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });
});

test.describe('quiz roadmap on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the graph fits, and an area opens in a sheet', async ({ page }) => {
    await setup(page);
    await page.goto('/software/roadmap?view=maps');
    for (const [topic, title] of [
      ['cpp', 'C\\+\\+'],
      ['python', 'Python'],
      ['computer-architecture', 'Computer architecture'],
      ['operating-systems', 'Operating systems'],
      ['concurrency', 'Concurrency'],
      ['networking', 'Networking'],
    ]) {
      await page.goto(`/software/roadmap?view=maps&roadmap=${topic}`);
      await expect(page.getByTestId('roadmap-node').first()).toBeVisible();
      await expect(page.getByTestId('roadmap-graph')).toHaveAttribute('data-fits', 'true');
      // The topics scroll in their own row, which shows the chosen one.
      await expect(page.getByRole('radio', { name: new RegExp(`^${title}:`) })).toBeInViewport();
      await noSideScroll(page);
    }
    await page.goto('/software/roadmap?view=maps&roadmap=cpp');
    // No side column on a phone: nothing selected, no details.
    await expect(page.getByTestId('roadmap-overview')).toHaveCount(0);
    await node(page, 'cpp-move-semantics').click();
    const sheet = page.getByRole('dialog', { name: 'Move semantics' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Practise' })).toBeVisible();
    await noSideScroll(page);
    // Moving along a prerequisite keeps the sheet open on the new area.
    await sheet.getByRole('region', { name: 'Builds on' }).getByRole('button').click();
    await expect(page.getByRole('dialog', { name: 'Object lifetime' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/roadmap=cpp$/);
  });
});
