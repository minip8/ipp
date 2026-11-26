/**
 * The Quant page (/quant): the guided way into the quant track. Two paths kept in `?path=`, each
 * an ordered sequence of topics with their progress, a "next up" marker by the roadmap's idea of
 * complete, and ways into practice, the bank and the roadmap; plus a discussion of the path's open
 * questions, which needs the user's AI key.
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus, QUIZ_TOPICS, QUIZ_TOPICS_FUNDAMENTALS } from './fixtures';
import { setup } from './helpers';

const KEY = 'sk-ant-api03-e2eQUANTkey-0123456789abcdefghijklmnop-Zk7Q';

const steps = (page: Page) => page.getByTestId('quant-step');
/** Each step's heading reads "Step n: Title". */
const headings = (page: Page) => steps(page).getByRole('heading');

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

test('Quant sits between Interviews and Quizzes in the header, and is marked when open', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Interviews', 'Quant', 'Quizzes']);
  await expect(nav.getByRole('link', { name: 'Quant' })).not.toHaveAttribute('aria-current');
  await nav.getByRole('link', { name: 'Quant' }).click();
  await expect(page).toHaveURL(/\/quant$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Quant' })).toBeVisible();
  await expect(page).toHaveTitle(/^Quant · interview\+\+/);
  await expect(nav.getByRole('link', { name: 'Quant' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Quizzes' })).not.toHaveAttribute('aria-current');
  await expect(nav.getByRole('link', { name: 'Interviews' })).not.toHaveAttribute('aria-current');
});

test('two paths, kept in the URL', async ({ page }) => {
  await setup(page);
  await page.goto('/quant');
  const tabs = page.getByRole('tablist', { name: 'Path' });
  await expect(tabs.getByRole('tab')).toHaveText(['Trader', 'Researcher']);
  await expect(tabs.getByRole('tab', { name: 'Trader' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('what trading interviews lean on')).toBeVisible();
  await expect(headings(page)).toHaveText(TRADER);

  await tabs.getByRole('tab', { name: 'Researcher' }).click();
  await expect(page).toHaveURL(/\/quant\?path=researcher$/);
  await expect(page.getByText('the maths research interviews build on')).toBeVisible();
  await expect(headings(page)).toHaveText(RESEARCHER);

  // A link keeps the path, and Back returns to the one before.
  await page.reload();
  await expect(tabs.getByRole('tab', { name: 'Researcher' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(headings(page)).toHaveText(RESEARCHER);
  await page.goBack();
  await expect(page).toHaveURL(/\/quant$/);
  await expect(headings(page)).toHaveText(TRADER);

  // The default path leaves the parameter out, and a path that is not one falls back to it.
  await page.goto('/quant?path=researcher');
  await tabs.getByRole('tab', { name: 'Trader' }).click();
  await expect(page).toHaveURL(/\/quant$/);
  await page.goto('/quant?path=quant-dev');
  await expect(headings(page)).toHaveText(TRADER);
});

test('each path is a sequence with progress and one topic next up', async ({ page }) => {
  await setup(page);
  await page.goto('/quant');
  const s = steps(page);
  await expect(s).toHaveCount(4);
  // As on the Quizzes page, with the accuracy once something is answered.
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
  await page.getByRole('tab', { name: 'Researcher' }).click();
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
  await page.goto('/quant');
  await expect(headings(page)).toHaveText([
    'Step 1: Probability',
    'Step 2: Betting & market making',
    'Step 3: Options & finance',
  ]);
  // The next topic that is not complete moves up.
  await expect(steps(page).nth(1).getByText('Next up', { exact: true })).toBeVisible();
  await expect(page.getByText(/open questions from Probability, Betting/)).toBeVisible();
});

test('with no quant topics, it says so', async ({ page }) => {
  await setup(page, (b) => {
    b.quizTopics = QUIZ_TOPICS_FUNDAMENTALS;
  });
  await page.goto('/quant');
  await expect(page.getByText('No quant topics yet')).toBeVisible();
  await expect(steps(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start discussion' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Researcher' }).click();
  await expect(page.getByText('No quant topics yet')).toBeVisible();
});

test.describe('actions', () => {
  test('Practise starts a practice round on that topic', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/quant');
    await page.getByRole('button', { name: 'Practise Brainteasers' }).click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]{36}$/);
    expect(attemptRequests(backend)).toEqual([
      { topics: ['brainteasers'], mode: 'practice', count: 10, focusWeak: true },
    ]);
    await expect(page.getByText('Practice', { exact: true })).toBeVisible();
  });

  test('Browse questions opens the topic bank', async ({ page }) => {
    await setup(page);
    await page.goto('/quant');
    const browse = page.getByRole('link', { name: 'Browse Options & finance questions' });
    await expect(browse).toHaveAttribute('href', '/quiz/topics/options');
    await page.getByRole('link', { name: 'Browse Probability questions' }).click();
    await expect(page).toHaveURL(/\/quiz\/topics\/probability$/);
    await expect(page.getByTestId('bank-subtopics')).toBeVisible();
  });

  test('Roadmap opens the topic roadmap', async ({ page }) => {
    await setup(page);
    await page.goto('/quant?path=researcher');
    await expect(page.getByRole('link', { name: 'Statistics roadmap' })).toHaveAttribute(
      'href',
      '/quiz?view=roadmap&roadmap=statistics',
    );
    await page.getByRole('link', { name: 'Probability roadmap' }).click();
    await expect(page).toHaveURL(/\/quiz\?view=roadmap&roadmap=probability$/);
    await expect(page.getByRole('group', { name: 'Probability study areas' })).toBeVisible();
  });

  test('a discussion draws on the path’s open questions', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/quant?path=researcher');
    await expect(
      page.getByText(
        '5 open questions from Probability, Statistics, Linear algebra & calculus and Options & finance.',
      ),
    ).toBeVisible();
    await expect(page.getByTestId('quant-key-prompt')).toHaveCount(0);
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
    await page.goto('/quant');
    const prompt = page.getByTestId('quant-key-prompt');
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
    await page.goto('/quant');
    await expect(page.getByTestId('quant-key-prompt')).toContainText('Your API key was rejected');
    await expect(page.getByRole('button', { name: 'Start discussion' })).toBeDisabled();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  test('the header keeps logo, three links, theme and account on one line at 360px', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/quant');
    await expect(page.getByRole('heading', { level: 1, name: 'Quant' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main' });
    const links = nav.getByRole('link');
    await expect(links).toHaveText(['Interviews', 'Quant', 'Quizzes']);
    const theme = await page.getByRole('button', { name: 'Change theme' }).boundingBox();
    const menu = await page.getByRole('button', { name: 'Account menu' }).boundingBox();
    const logo = await page
      .getByRole('banner')
      .getByRole('link', { name: 'interview++' })
      .boundingBox();
    if (!theme || !menu || !logo) throw new Error('header not laid out');
    const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
    let right = logo.x + logo.width;
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      if (!box) throw new Error('no link box');
      // In order, not overlapping, on the same line as the account menu.
      expect(box.x).toBeGreaterThanOrEqual(right);
      expect(Math.abs(mid(box) - mid(menu))).toBeLessThan(4);
      right = box.x + box.width;
    }
    expect(right).toBeLessThanOrEqual(theme.x);
    expect(menu.x + menu.width).toBeLessThanOrEqual(360);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);

    // A step's three actions share one row.
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
