/** Deleting from one's own history: quiz attempts (one, or all) and mental math drill runs. */
import { expect, type Page, test } from '@playwright/test';
import { iso, makeAttempt, QUIZ_ATTEMPT_ID, uuid } from './fixtures';
import { setup } from './helpers';

const HISTORY = '/quiz?view=history';
const pastQuizzes = (page: Page) =>
  page.getByRole('region', { name: 'Past quizzes' }).getByRole('listitem');
const deletes = (b: { requests: { method: string; path: string }[] }) =>
  b.requests.filter((r) => r.method === 'DELETE').map((r) => r.path);

test.describe('quiz history', () => {
  test('deletes one attempt after confirming; Cancel keeps it', async ({ page }) => {
    const backend = await setup(page);
    await page.goto(HISTORY);
    await expect(pastQuizzes(page)).toHaveCount(3);
    const exam = page.getByRole('button', { name: /^Delete exam: / });
    await expect(exam).toHaveCount(1);

    await exam.click();
    const dialog = page.getByRole('dialog', { name: /^Delete this exam on / });
    await expect(dialog).toContainText('cannot be undone');
    await expect(dialog).toContainText('10 answers and their feedback.');
    // It says what happens to the numbers.
    await expect(dialog).toContainText('stats, roadmap progress and question statuses go back');
    await expect(dialog).toContainText('Prefer questions I missed');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(deletes(backend)).toEqual([]);

    await exam.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete exam' }).click();
    await expect(page.getByText('Exam deleted')).toBeVisible();
    // Gone from the list (and the tab's count) without a reload.
    await expect(pastQuizzes(page)).toHaveCount(2);
    await expect(page.getByRole('button', { name: /^Delete exam: / })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^History/ })).toContainText('2');
    expect(deletes(backend)).toEqual([`/api/quiz/attempts/${uuid(9002)}`]);
    // The stats are fetched again, since they read what is left.
    await expect
      .poll(() => backend.requests.filter((r) => r.path === '/api/quiz/topics').length)
      .toBeGreaterThan(1);
  });

  test('a running attempt says it cannot be resumed', async ({ page }) => {
    await setup(page);
    await page.goto(HISTORY);
    await page.getByRole('button', { name: /^Delete practice quiz: Python/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(
      'The practice quiz in progress: you will not be able to resume it.',
    );
    await expect(dialog).toContainText('3 answers and their feedback.');
  });

  test('a failed delete keeps the row and shows the error; retry works', async ({ page }) => {
    await setup(page, (b) =>
      b.fail(/^DELETE \/api\/quiz\/attempts\//, 503, {
        error: { code: 'unavailable', message: 'The service is busy. Try again shortly.' },
      }),
    );
    await page.goto(HISTORY);
    await page.getByRole('button', { name: /^Delete exam: / }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Delete exam' }).click();
    await expect(dialog.getByRole('alert')).toContainText('The exam was not deleted.');
    await expect(dialog.getByRole('alert')).toContainText('The service is busy');
    // The open dialog hides the page from the accessibility tree, so look at the DOM itself.
    await expect(page.locator('li a[href^="/quiz/"]')).toHaveCount(3);
    await dialog.getByRole('button', { name: 'Try again' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(pastQuizzes(page)).toHaveCount(2);
  });

  test('clears the whole history, question-bank answers included', async ({ page }) => {
    const backend = await setup(page);
    await page.goto(HISTORY);
    await page.getByRole('button', { name: 'Clear history' }).click();
    const dialog = page.getByRole('dialog', { name: 'Clear your whole quiz history?' });
    await expect(dialog).toContainText('3 quizzes in your history, with their answers.');
    await expect(dialog).toContainText('Your answers in the question bank.');
    await expect(dialog).toContainText('start again from nothing');
    await expect(dialog).toContainText('quant rounds still count');
    await dialog.getByRole('button', { name: 'Clear quiz history' }).click();
    await expect(page.getByText('Quiz history cleared')).toBeVisible();
    await expect(page.getByText('No quizzes yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear history' })).toHaveCount(0);
    expect(deletes(backend)).toEqual(['/api/quiz/history']);
    expect(backend.quizBank.answers.size).toBe(0);
  });

  test('an attempt in progress can be deleted from its own page', async ({ page }) => {
    const backend = await setup(page);
    await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
    await page.getByRole('button', { name: 'Delete practice quiz' }).click();
    const dialog = page.getByRole('dialog', { name: /^Delete this practice quiz on / });
    await expect(dialog).toContainText('you will not be able to resume it');
    await expect(dialog).toContainText('No answers yet.');
    await dialog.getByRole('button', { name: 'Delete practice quiz' }).click();
    await expect(page).toHaveURL(/\/quiz\?view=history$/);
    await expect(page.getByText('Practice quiz deleted')).toBeVisible();
    expect(deletes(backend)).toEqual([`/api/quiz/attempts/${QUIZ_ATTEMPT_ID}`]);
    // Its page is gone too.
    await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
    await expect(page.getByText('This quiz does not exist')).toBeVisible();
  });

  test('a finished attempt can be deleted from its results', async ({ page }) => {
    const id = uuid(9100);
    const backend = await setup(page, (b) => {
      b.attempts.set(
        id,
        makeAttempt({
          id,
          mode: 'exam',
          status: 'finished',
          score: 0.5,
          startedAt: iso(-3600),
          finishedAt: iso(-3000),
        }),
      );
    });
    await page.goto(`/quiz/${id}`);
    await expect(page.getByTestId('quiz-score')).toBeVisible();
    await page.getByRole('button', { name: 'Delete exam' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete exam' }).click();
    await expect(page).toHaveURL(/\/quiz\?view=history$/);
    expect(deletes(backend)).toEqual([`/api/quiz/attempts/${id}`]);
  });
});

test.describe('drill history', () => {
  test('deletes a run; deleting the best says so and the best falls to the next run', async ({
    page,
  }) => {
    const backend = await setup(page);
    await page.goto('/quant/drill');
    const runs = page.getByTestId('drill-runs').getByRole('listitem');
    await expect(runs).toHaveCount(4);
    const bests = page.getByTestId('drill-bests');
    await expect(bests.getByRole('row', { name: /^2 min/ })).toContainText('31');

    // The third run (2 min · Standard, 31) holds the best.
    await runs
      .nth(2)
      .getByRole('button', { name: /^Delete run: / })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Delete this 2 min · Standard · All categories run?',
    });
    await expect(dialog).toContainText('It scored 31.');
    await expect(dialog).toContainText('It is your best at 2 min · Standard');
    await dialog.getByRole('button', { name: 'Delete run' }).click();
    await expect(page.getByText('Run deleted')).toBeVisible();
    await expect(runs).toHaveCount(3);
    await expect(page.getByText('3 runs')).toBeVisible();
    // The other 2 min · Standard run (27) is the best now.
    await expect(bests.getByRole('row', { name: /^2 min/ })).toContainText('27');
    expect(deletes(backend)).toEqual([`/api/drill/runs/${uuid(9003)}`]);

    // A run on chosen categories never set a best.
    await runs
      .nth(1)
      .getByRole('button', { name: /^Delete run: / })
      .click();
    await expect(page.getByRole('dialog')).toContainText(
      'a run on chosen categories never sets one',
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(runs).toHaveCount(3);
  });

  test('clears every run and best', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/quant/drill');
    await page
      .getByRole('region', { name: 'Your runs' })
      .getByRole('button', { name: 'Clear' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Clear your drill history?' });
    await expect(dialog).toContainText('All 4 runs.');
    await expect(dialog).toContainText('Every best');
    await dialog.getByRole('button', { name: 'Clear drill history' }).click();
    await expect(page.getByText('Drill history cleared')).toBeVisible();
    await expect(page.getByText('No runs yet')).toBeVisible();
    expect(backend.cleared.drill).toBe(1);
    expect(deletes(backend)).toEqual(['/api/drill/runs']);
  });
});
