/**
 * The Roadmap tab's study path (the default view of /{track}/roadmap): a track's topics as an
 * ordered sequence with their progress, a "next up" marker by the roadmap's idea of complete, and
 * ways into practice, the bank and the topic maps; plus a way into an interview on the path's
 * open questions (the Interviews tab's builder, on the user's AI key). Quant has two curated paths
 * kept in `?path=`, Software one of all its topics.
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus, QUIZ_TOPICS, QUIZ_TOPICS_FUNDAMENTALS } from './fixtures';
import { setup } from './helpers';

const steps = (page: Page) => page.getByTestId('path-step');
/** Each step's heading reads "Step n: Title". */
const headings = (page: Page) => steps(page).getByRole('heading');
const picker = (page: Page) => page.getByRole('radiogroup', { name: 'Path' });
const talk = (page: Page) =>
  page.getByRole('region', { name: 'Talk it through with the interviewer' });

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
  await expect(talk(page)).toContainText(
    'An interview of open questions from C++, Python, Computer architecture, Operating systems, Networking and Concurrency',
  );
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
  await expect(talk(page)).toContainText(
    'open questions from Probability, Betting & market making and Options & finance',
  );
  await expect(talk(page).getByRole('link')).toHaveAttribute(
    'href',
    '/quant/interviews?topics=probability%2Cbetting-market-making%2Coptions',
  );
});

test('with none of a path’s topics, it says so', async ({ page }) => {
  await setup(page, (b) => {
    b.quizTopics = QUIZ_TOPICS_FUNDAMENTALS;
  });
  await page.goto('/quant/roadmap');
  await expect(page.getByText('No topics on this path yet')).toBeVisible();
  await expect(steps(page)).toHaveCount(0);
  await expect(talk(page)).toHaveCount(0);
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
    await expect(page.getByRole('link', { name: 'Statistics topic map' })).toHaveAttribute(
      'href',
      '/quant/roadmap?view=maps&roadmap=statistics',
    );
    await page.getByRole('link', { name: 'Probability topic map' }).click();
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
    await expect(page.getByRole('link', { name: 'Python topic map' })).toHaveAttribute(
      'href',
      '/software/roadmap?view=maps&roadmap=python',
    );
  });

  test('the path’s open questions lead to an interview on its topics', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/quant/roadmap?path=researcher');
    await expect(talk(page)).toContainText(
      'An interview of open questions from Probability, Statistics, Linear algebra & calculus and Options & finance',
    );
    await expect(talk(page)).toContainText('It runs on your AI key.');
    await expect(page.getByRole('button', { name: 'Start discussion' })).toHaveCount(0);
    const link = talk(page).getByRole('link', { name: 'Interview on these topics' });
    await expect(link).toHaveAttribute(
      'href',
      '/quant/interviews?topics=probability%2Cstatistics%2Calgebra-calculus%2Coptions',
    );
    // The other path, its own topics.
    await picker(page).getByRole('radio', { name: 'Trader' }).click();
    await expect(link).toHaveAttribute(
      'href',
      '/quant/interviews?topics=probability%2Cbrainteasers%2Cbetting-market-making%2Coptions',
    );
    await link.click();
    await expect(page).toHaveURL(
      /\/quant\/interviews\?topics=probability%2Cbrainteasers%2Cbetting-market-making%2Coptions$/,
    );
    expect(attemptRequests(backend)).toEqual([]);

    // Software's, in its own track.
    await page.goto('/software/roadmap');
    await expect(talk(page).getByRole('link')).toHaveAttribute(
      'href',
      '/software/interviews?topics=cpp%2Cpython%2Ccomputer-architecture%2Coperating-systems%2Cnetworking%2Cconcurrency',
    );
  });

  test('no key needed on the path, and the link says the interview needs one', async ({ page }) => {
    await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/quant/roadmap');
    // The key is asked for where the interview starts, not here.
    await expect(page.getByRole('button', { name: 'Add API key' })).toHaveCount(0);
    await expect(talk(page)).toContainText('It runs on your AI key.');
    await expect(talk(page).getByRole('link', { name: 'Interview on these topics' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Practise Probability' })).toBeEnabled();
  });

  test('a path with open questions on one topic only says this topic', async ({ page }) => {
    await setup(page, (b) => {
      b.quizTopics = QUIZ_TOPICS.map((t) =>
        t.slug === 'probability' ? t : { ...t, shortCount: 0 },
      );
    });
    await page.goto('/quant/roadmap');
    await expect(talk(page)).toContainText('An interview of open questions from Probability:');
    await expect(talk(page).getByRole('link', { name: 'Interview on this topic' })).toHaveAttribute(
      'href',
      '/quant/interviews?topics=probability',
    );
    // None at all: nothing to link to.
    await page.goto('/software/roadmap');
    await expect(talk(page)).toContainText('None of these topics has open questions yet.');
    await expect(talk(page).getByRole('link')).toHaveCount(0);
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
