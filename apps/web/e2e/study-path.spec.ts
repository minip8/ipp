/**
 * The Roadmap tab's study path (the default view of /{track}/roadmap): a track's topics as an
 * ordered sequence with their progress, a "next up" marker by the roadmap's idea of complete, and
 * ways into practice, the bank and the topic maps; plus a discussion of the path's open questions,
 * which needs the user's AI key. Quant has two curated paths kept in `?path=`, Software one of all
 * its topics.
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus, QUIZ_TOPICS, QUIZ_TOPICS_FUNDAMENTALS } from './fixtures';
import { setup } from './helpers';

const KEY = 'sk-ant-api03-e2eQUANTkey-0123456789abcdefghijklmnop-Zk7Q';

const steps = (page: Page) => page.getByTestId('path-step');
/** Each step's heading reads "Step n: Title". */
const headings = (page: Page) => steps(page).getByRole('heading');
const picker = (page: Page) => page.getByRole('radiogroup', { name: 'Path' });

const TRADER = [
  'Step 1: Probability',
  'Step 2: Brainteasers',
  'Step 3: Betting & market making',
  'Step 4: Options & finance',
];
const RESEARCHER = [
  'Step 1: Probability',
  'Step 2: Statistics',
  'Step 3: Linear algebra & calculus',
  'Step 4: Options & finance',
];

const attemptRequests = (b: { requests: { method: string; path: string; body: unknown }[] }) =>
  b.requests
    .filter((r) => r.method === 'POST' && r.path === '/api/quiz/attempts')
    .map((r) => r.body);

test('the Roadmap tab opens on the study path, titled per track', async ({ page }) => {
  await setup(page);
  await page.goto('/quant/roadmap');
  await expect(page.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible();
  await expect(page).toHaveTitle(/^Quant roadmap · interview\+\+/);
  const views = page.getByRole('tablist', { name: 'Roadmap' }).getByRole('tab');
  await expect(views).toHaveText(['Study path', 'Topic maps']);
  await expect(views.first()).toHaveAttribute('aria-selected', 'true');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('aria-current', 'page');
  await page.goto('/software/roadmap');
  await expect(page).toHaveTitle(/^Roadmap · interview\+\+/);
});

test('Quant: two paths, kept in the URL', async ({ page }) => {
  await setup(page);
  await page.goto('/quant/roadmap');
  await expect(picker(page).getByRole('radio')).toHaveText(['Trader', 'Researcher']);
  await expect(picker(page).getByRole('radio', { name: 'Trader' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByText('what trading interviews lean on')).toBeVisible();
  await expect(headings(page)).toHaveText(TRADER);

  await picker(page).getByRole('radio', { name: 'Researcher' }).click();
  await expect(page).toHaveURL(/\/quant\/roadmap\?path=researcher$/);
  await expect(page.getByText('the maths research interviews build on')).toBeVisible();
  await expect(headings(page)).toHaveText(RESEARCHER);

  // A link keeps the path, and Back returns to the one before.
  await page.reload();
  await expect(picker(page).getByRole('radio', { name: 'Researcher' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(headings(page)).toHaveText(RESEARCHER);
  await page.goBack();
  await expect(page).toHaveURL(/\/quant\/roadmap$/);
  await expect(headings(page)).toHaveText(TRADER);

  // The default path leaves the parameter out, and a path that is not one falls back to it.
  await page.goto('/quant/roadmap?path=researcher');
  await picker(page).getByRole('radio', { name: 'Trader' }).click();
  await expect(page).toHaveURL(/\/quant\/roadmap$/);
  await page.goto('/quant/roadmap?path=quant-dev');
  await expect(headings(page)).toHaveText(TRADER);
});

test('Software: one path of all its topics in study order, no picker', async ({ page }) => {
  await setup(page);
  await page.goto('/software/roadmap');
  await expect(headings(page)).toHaveText([
    'Step 1: C++',
    'Step 2: Python',
    'Step 3: Computer architecture',
    'Step 4: Operating systems',
    'Step 5: Networking',
    'Step 6: Concurrency',
  ]);
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByTestId('path-description')).toContainText('The languages first');
  // C++ is under way, so next up; no drill in this track.
  await expect(steps(page).nth(0).getByText('Next up', { exact: true })).toBeVisible();
  await expect(page.getByTestId('drill-card')).toHaveCount(0);
  await expect(
    page.getByText(/^5 open questions from C\+\+, Python, Computer architecture/),
  ).toBeVisible();
});

test('Python, shared into Quant, is on neither curated path', async ({ page }) => {
  await setup(page);
  await page.goto('/quant/roadmap');
  await expect(headings(page)).toHaveText(TRADER);
  await page.goto('/quant/roadmap?path=researcher');
  await expect(headings(page)).toHaveText(RESEARCHER);
  await expect(page.getByTestId('drill-card')).toBeVisible();
});

test('each path is a sequence with progress and one topic next up', async ({ page }) => {
  await setup(page);
  await page.goto('/quant/roadmap');
  const s = steps(page);
  await expect(s).toHaveCount(4);
  // As on Practice, with the accuracy once something is answered.
  await expect(s.nth(0)).toContainText('84 of 84 questions answered · 82% accuracy');
  await expect(s.nth(1)).toContainText('23 of 66 questions answered · 61% accuracy');
  await expect(s.nth(3)).toContainText('0 of 88 questions answered');
  await expect(s.nth(3)).not.toContainText('accuracy');
  await expect(s.nth(1)).toContainText('Logic puzzles, strategy games');
  // Probability is complete (all answered, at 70% or more), so the next topic is next up.
  await expect(s.nth(0).getByText('Complete', { exact: true })).toBeVisible();
  await expect(page.getByText('Next up', { exact: true })).toHaveCount(1);
  await expect(s.nth(1).getByText('Next up', { exact: true })).toBeVisible();

  // Statistics is fully answered but under 70%: not complete, so next up on this path.
  await picker(page).getByRole('radio', { name: 'Researcher' }).click();
  await expect(s.nth(1)).toContainText('81 of 81 questions answered · 64% accuracy');
  await expect(s.nth(1)).toContainText('get to 70% accuracy to complete it');
  await expect(s.nth(1).getByText('Next up', { exact: true })).toBeVisible();
  await expect(s.nth(1).getByText('Complete', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Next up', { exact: true })).toHaveCount(1);
});

test('a topic the server does not have is skipped', async ({ page }) => {
  await setup(page, (b) => {
    b.quizTopics = QUIZ_TOPICS.filter((t) => t.slug !== 'brainteasers');
  });
  await page.goto('/quant/roadmap');
  await expect(headings(page)).toHaveText([
    'Step 1: Probability',
    'Step 2: Betting & market making',
    'Step 3: Options & finance',
  ]);
  // The next topic that is not complete moves up.
  await expect(steps(page).nth(1).getByText('Next up', { exact: true })).toBeVisible();
  await expect(page.getByText(/open questions from Probability, Betting/)).toBeVisible();
});

test('with none of a path’s topics, it says so', async ({ page }) => {
  await setup(page, (b) => {
    b.quizTopics = QUIZ_TOPICS_FUNDAMENTALS;
  });
  await page.goto('/quant/roadmap');
  await expect(page.getByText('No topics on this path yet')).toBeVisible();
  await expect(steps(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start discussion' })).toHaveCount(0);
  await picker(page).getByRole('radio', { name: 'Researcher' }).click();
  await expect(page.getByText('No topics on this path yet')).toBeVisible();
});

test.describe('actions', () => {
  test('Practise starts a practice round on that topic', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/quant/roadmap');
    await page.getByRole('button', { name: 'Practise Brainteasers' }).click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]{36}$/);
    expect(attemptRequests(backend)).toEqual([
      { topics: ['brainteasers'], mode: 'practice', count: 10, focusWeak: true },
    ]);
    await expect(page.getByText('Practice', { exact: true }).first()).toBeVisible();
  });

  test('Browse questions opens the topic bank', async ({ page }) => {
    await setup(page);
    await page.goto('/quant/roadmap');
    const browse = page.getByRole('link', { name: 'Browse Options & finance questions' });
    await expect(browse).toHaveAttribute('href', '/quiz/topics/options');
    await page.getByRole('link', { name: 'Browse Probability questions' }).click();
    await expect(page).toHaveURL(/\/quiz\/topics\/probability$/);
    await expect(page.getByTestId('bank-subtopics')).toBeVisible();
  });

  test('Roadmap opens the topic maps on that topic, in the same track', async ({ page }) => {
    await setup(page);
    await page.goto('/quant/roadmap?path=researcher');
    await expect(page.getByRole('link', { name: 'Statistics roadmap' })).toHaveAttribute(
      'href',
      '/quant/roadmap?view=maps&roadmap=statistics',
    );
    await page.getByRole('link', { name: 'Probability roadmap' }).click();
    await expect(page).toHaveURL(/\/quant\/roadmap\?view=maps&roadmap=probability$/);
    await expect(page.getByRole('tab', { name: 'Topic maps' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('group', { name: 'Probability study areas' })).toBeVisible();
    // Back returns to the path.
    await page.goBack();
    await expect(page).toHaveURL(/\/quant\/roadmap\?path=researcher$/);
    await expect(headings(page)).toHaveText(RESEARCHER);

    await page.goto('/software/roadmap');
    await expect(page.getByRole('link', { name: 'Python roadmap' })).toHaveAttribute(
      'href',
      '/software/roadmap?view=maps&roadmap=python',
    );
  });

  test('a discussion draws on the path’s open questions', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/quant/roadmap?path=researcher');
    await expect(
      page.getByText(
        '5 open questions from Probability, Statistics, Linear algebra & calculus and Options & finance.',
      ),
    ).toBeVisible();
    await expect(page.getByTestId('path-key-prompt')).toHaveCount(0);
    await page.getByRole('button', { name: 'Start discussion' }).click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]{36}$/);
    expect(attemptRequests(backend)).toEqual([
      {
        topics: ['probability', 'statistics', 'algebra-calculus', 'options'],
        mode: 'discussion',
        count: 5,
        focusWeak: true,
      },
    ]);
    await expect(page.getByPlaceholder('Answer as you would out loud')).toBeVisible();
  });

  test('without a working AI key, the discussion asks for one first', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/quant/roadmap');
    const prompt = page.getByTestId('path-key-prompt');
    await expect(prompt).toContainText('A discussion runs on your own AI API key');
    await expect(page.getByRole('button', { name: 'Start discussion' })).toBeDisabled();
    // Practice needs no key.
    await expect(page.getByRole('button', { name: 'Practise Probability' })).toBeEnabled();

    // Adding the key from the prompt lets it start.
    await prompt.getByRole('button', { name: 'Add API key' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /API key/ }).fill(KEY);
    await dialog.getByRole('button', { name: 'Save key' }).click();
    await expect(dialog).toBeHidden();
    await expect(prompt).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start discussion' })).toBeEnabled();
    expect(attemptRequests(backend)).toEqual([]);
  });

  test('a rejected key is named as such', async ({ page }) => {
    await setup(page, (b) => {
      b.aiKey = aiKeyStatus('rejected');
    });
    await page.goto('/software/roadmap');
    await expect(page.getByTestId('path-key-prompt')).toContainText('Your API key was rejected');
    await expect(page.getByRole('button', { name: 'Start discussion' })).toBeDisabled();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  test('a step’s three actions share one row, and nothing scrolls sideways', async ({ page }) => {
    await setup(page);
    await page.goto('/quant/roadmap');
    await expect(steps(page).first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);
    const actions = steps(page)
      .first()
      .getByRole('button')
      .or(steps(page).first().getByRole('link'));
    await expect(actions).toHaveCount(3);
    const ys = await Promise.all(
      (await actions.all()).map(async (a) => (await a.boundingBox())?.y),
    );
    expect(new Set(ys.map((y) => Math.round(y ?? -1))).size).toBe(1);
  });
});
