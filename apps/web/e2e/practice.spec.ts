/**
 * The Practice tab in each track: the track's topics as one flat grid, its own in study order and
 * then those shared into it (Python, at home in Software, last in Quant), totals and history of
 * the track only, one remembered setup per track, the drill in Quant, and the question bank's
 * topic picker and the topic maps' chips in the same order.
 */
import { expect, type Page, test } from '@playwright/test';
import { QUIZ_TOPICS_FUNDAMENTALS } from './fixtures';
import { QUIZ_ROADMAP_FUNDAMENTALS } from './fixtures-quiz-roadmap';
import { setup } from './helpers';

const SOFTWARE = [
  'C++',
  'Python',
  'Computer architecture',
  'Operating systems',
  'Networking',
  'Concurrency',
];
/** Quant's own topics in study order, then Python, shared into it from Software. */
const QUANT = [
  'Probability',
  'Brainteasers',
  'Betting & market making',
  'Options & finance',
  'Statistics',
  'Linear algebra & calculus',
  'Python',
];
/** A topic card's text starts with its title. */
const starts = (titles: string[]) => titles.map((t) => new RegExp(`^${t.replace(/\+/g, '\\+')}`));

/** The topic cards' toggle buttons (each also has a Browse link). */
const cards = (page: Page) => page.getByTestId('topic-grid').getByRole('button');
const stat = (page: Page, label: string) =>
  page.locator('dl > div').filter({ hasText: label }).locator('dd');

test('each track lists its own topics first, one flat grid in study order, Python in both', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/software/practice');
  await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeVisible();
  await expect(page).toHaveTitle(/^Practice · interview\+\+/);
  await expect(cards(page)).toHaveText(starts(SOFTWARE));
  // No headings between the topics: the switch is the grouping.
  await expect(page.getByTestId('topic-grid').getByRole('heading')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Fundamentals' })).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Practice' }).getByRole('tab')).toHaveText([
    'Quizzes',
    'Problems',
    /^History/,
  ]);
  await expect(stat(page, 'Answered')).toHaveText('69');
  await expect(page.getByTestId('drill-card')).toHaveCount(0);

  await page.goto('/quant/practice');
  await expect(page).toHaveTitle(/^Quant practice · interview\+\+/);
  await expect(cards(page)).toHaveText(starts(QUANT));
  await expect(page.getByRole('heading', { name: 'Quant', exact: true })).toHaveCount(0);
  // No problem library in Quant.
  await expect(page.getByRole('tablist', { name: 'Practice' }).getByRole('tab')).toHaveText([
    'Quizzes',
    /^History/,
  ]);
  // The track's own totals: Python's 12 count in both.
  await expect(stat(page, 'Answered')).toHaveText('217');
  // The drill sits under the setup.
  const setupBox = await page.getByRole('region', { name: 'Mode' }).boundingBox();
  const drillBox = await page.getByTestId('drill-card').boundingBox();
  expect(setupBox && drillBox && drillBox.y > setupBox.y + setupBox.height).toBe(true);
  await expect(page.getByTestId('drill-card').getByRole('link')).toHaveAttribute(
    'href',
    '/quant/practice/drill',
  );
});

test('the mode hint names the drill and live rounds only in Quant', async ({ page }) => {
  await setup(page);
  await page.goto('/software/practice');
  const setup_ = page.getByRole('region', { name: 'Mode' });
  await expect(setup_).toContainText('You see the answer after each question.');
  await expect(setup_).not.toContainText('drill');
  await page.getByRole('radio', { name: 'Discussion' }).click();
  await expect(setup_).not.toContainText('live round');
  await page.goto('/quant/practice');
  await expect(setup_).toContainText('try the mental math drill');
  await page.getByRole('radio', { name: 'Discussion' }).click();
  await expect(setup_).toContainText('start a live round from Interviews');
});

test('history lists the attempts with a topic of the track', async ({ page }) => {
  await setup(page);
  await page.goto('/software/practice?view=history');
  const rows = page.getByRole('region', { name: 'Past quizzes' }).getByRole('listitem');
  // C++, Operating systems and concurrency, Python.
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole('tab', { name: /^History/ })).toHaveText(/3/);
  await page.goto('/quant/practice?view=history');
  // Python is in Quant too; the others are not.
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Python');
  await expect(page.getByRole('tab', { name: /^History/ })).toHaveText(/1/);
  // Clearing still clears everything, and says so.
  await page.getByRole('button', { name: 'Clear history' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    "3 quizzes in your history, with their answers. That includes 2 on the other track's topics, not listed here.",
  );
});

test('each track keeps its own setup, and never selects the other track’s topics', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/software/practice');
  await cards(page)
    .filter({ hasText: /^Networking/ })
    .click();
  await cards(page)
    .filter({ hasText: /^Python/ })
    .click();
  await expect(page.getByTestId('setup-summary')).toContainText('Python, Networking');

  await page.goto('/quant/practice');
  await expect(page.getByTestId('setup-summary')).toHaveText('Select one or more topics first.');
  await cards(page)
    .filter({ hasText: /^Probability/ })
    .click();
  await expect(page.getByTestId('setup-summary')).toContainText('Probability ·');

  await page.goto('/software/practice');
  await expect(page.getByTestId('setup-summary')).toContainText('Python, Networking');
  await page.goto('/quant/practice');
  await expect(page.getByTestId('setup-summary')).toContainText('Probability ·');
});

test('a topic preselected for the other track goes to that track', async ({ page }) => {
  await setup(page);
  await page.goto('/software/practice?topic=probability');
  await expect(page).toHaveURL(/\/quant\/practice\?topic=probability$/);
  await expect(cards(page).filter({ hasText: /^Probability/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // A shared topic stays where it is.
  await page.goto('/software/practice?topic=python');
  await expect(page).toHaveURL(/\/software\/practice\?topic=python$/);
  await expect(cards(page).filter({ hasText: /^Python/ })).toHaveAttribute('aria-pressed', 'true');
});

test('the question bank picks topics of its track, flat, and leads back there', async ({
  page,
}) => {
  await setup(page, (b) => {
    b.track = 'quant';
  });
  await page.goto('/quiz/topics/probability');
  await page.getByRole('combobox', { name: 'Topic' }).click();
  const list = page.getByRole('listbox');
  await expect(list.getByRole('group')).toHaveCount(0);
  await expect(list.getByRole('option')).toHaveText(QUANT);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Take a quiz instead' })).toHaveAttribute(
    'href',
    '/quant/practice?topic=probability',
  );

  // A software topic's bank is in Software, whatever was remembered.
  await page.goto('/quiz/topics/operating-systems');
  await page.getByRole('combobox', { name: 'Topic' }).click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(SOFTWARE);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Take a quiz instead' })).toHaveAttribute(
    'href',
    '/software/practice?topic=operating-systems',
  );
});

test('with no quant content, Quant’s Practice has only the shared topic', async ({ page }) => {
  await setup(page, (b) => {
    b.quizTopics = QUIZ_TOPICS_FUNDAMENTALS;
    b.quizRoadmap = QUIZ_ROADMAP_FUNDAMENTALS;
  });
  await page.goto('/quant/practice');
  await expect(cards(page)).toHaveText([/^Python/]);
  await page.goto('/software/practice');
  await expect(cards(page)).toHaveCount(6);
});

test('the topic maps follow the same order, starting on the track’s own first topic', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/quant/roadmap?view=maps');
  const chips = page.getByRole('radiogroup', { name: 'Roadmap topic' }).getByRole('radio');
  await expect(chips.first()).toHaveText(/^Probability/);
  await expect(chips.last()).toHaveText(/^Python/);
  await expect(chips.first()).toHaveAttribute('aria-checked', 'true');
  await page.goto('/software/roadmap?view=maps');
  await expect(chips.first()).toHaveText(/^C\+\+/);
  await expect(chips.nth(1)).toHaveText(/^Python/);
});
