import { expect, test } from '@playwright/test';
import { aiKeyStatus, QUIZ_ATTEMPT_ID } from './fixtures';
import { setup } from './helpers';

test.describe('quizzes', () => {
  test('starts a practice attempt from the hub', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/quiz');
    await expect(page.getByRole('button', { name: /^Computer architecture/ })).toContainText(
      'Not started',
    );
    const start = page.getByRole('button', { name: 'Start quiz' });
    await expect(start).toBeDisabled();
    await page.getByRole('button', { name: /^Operating systems/ }).click();
    await page.getByRole('button', { name: /^Concurrency/ }).click();
    await page.getByRole('radio', { name: 'Hard' }).click();
    await page.getByRole('radio', { name: '5', exact: true }).click();
    await start.click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('quiz-counter')).toHaveText('Question 1 of 4');
    const create = backend.requests.find(
      (r) => r.method === 'POST' && r.path === '/api/quiz/attempts',
    );
    expect(create?.body).toEqual({
      topics: ['operating-systems', 'concurrency'],
      mode: 'practice',
      difficulty: 'hard',
      count: 5,
      focusWeak: true,
    });
  });

  test('answers every question type in practice mode', async ({ page }) => {
    await setup(page);
    await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
    const primary = page.getByTestId('quiz-primary');

    // single choice, chosen with the keyboard
    await expect(page.getByRole('radio', { name: /page fault/ })).toBeVisible();
    await expect(primary).toBeDisabled();
    await page.keyboard.press('a');
    await expect(page.getByRole('radio', { name: /page fault/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Enter');
    const feedback = page.getByRole('region', { name: 'Feedback' });
    await expect(feedback).toContainText('Correct');
    await expect(feedback).toContainText('page fault');
    await expect(page.getByRole('radio', { name: /page fault/ })).toContainText(
      'Your answer · correct',
    );
    await page.keyboard.press('Enter');

    // multiple choice: one right, one wrong -> partial credit, missed answer revealed
    await expect(page.getByTestId('quiz-counter')).toHaveText('Question 2 of 4');
    await page.getByRole('checkbox', { name: /opposite orders/ }).click();
    await page.getByRole('checkbox', { name: /condition variable/ }).click();
    await primary.click();
    await expect(feedback).toContainText('Partly correct');
    await expect(page.getByRole('checkbox', { name: /non-recursive/ })).toContainText(
      'Correct answer',
    );
    await expect(page.getByRole('checkbox', { name: /condition variable/ })).toContainText(
      'Your answer · incorrect',
    );
    await primary.click();

    // output prediction: code is rendered, C++ offers UB/unspecified but not runtime error
    await expect(page.getByText('C++20')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Undefined behaviour/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /exception/ })).toHaveCount(0);
    await page.getByRole('radio', { name: /Prints exactly/ }).click();
    await page.getByLabel('Output').fill('a|d');
    await page.keyboard.press('Control+Enter');
    await expect(feedback).toContainText('Correct');
    await expect(feedback).toContainText('copy elision');
    await primary.click();

    // short answer graded by the AI
    await page
      .getByLabel('Your answer')
      .fill(
        'So the final ACK can be retransmitted if the peer resends its FIN, and old segments expire.',
      );
    await expect(page.getByText(/\/ 4,000/)).toBeVisible();
    await primary.click();
    await expect(feedback).toContainText('Graded by the AI');
    await expect(feedback).toContainText('Missed: letting old duplicate segments expire');
    await expect(feedback).toContainText('Reference answer');
    await expect(primary).toHaveText(/See results/);
    await primary.click();

    await expect(page.getByTestId('quiz-score')).toBeVisible();
    await expect(page.getByText('3 of 4 questions correct')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Practice missed questions' })).toBeVisible();
  });

  test('exam mode withholds feedback until the end', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.quizMode = 'exam';
    });
    await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
    await expect(page.getByText('Exam', { exact: true })).toBeVisible();
    const primary = page.getByTestId('quiz-primary');

    await page.getByRole('radio', { name: /TLB/ }).click();
    await primary.click(); // save and next
    await expect(page.getByTestId('quiz-counter')).toHaveText('Question 2 of 4');
    await expect(page.getByRole('region', { name: 'Feedback' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: /opposite orders/ }).click();
    await page.getByRole('checkbox', { name: /non-recursive/ }).click();
    await primary.click();
    await expect(page.getByTestId('quiz-counter')).toHaveText('Question 3 of 4');

    // revisit and change the first answer
    await page.getByRole('button', { name: 'Question 1: Answered' }).click();
    await expect(page.getByRole('radio', { name: /TLB/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: /page fault/ }).click();
    await primary.click();
    await expect(page.getByTestId('quiz-counter')).toHaveText('Question 3 of 4');
    const firstAnswers = backend.requests.filter(
      (r) =>
        r.path.endsWith('/answers') &&
        (r.body as { questionId: string }).questionId === 'os-virtual-memory-002',
    );
    expect(firstAnswers).toHaveLength(2);

    await page.getByRole('button', { name: 'Finish quiz' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('2 unanswered questions');
    await dialog.getByRole('button', { name: 'Finish quiz' }).click();

    await expect(page.getByTestId('quiz-score')).toHaveText('50%');
    await expect(page.getByText('2 of 4 questions correct')).toBeVisible();
    await expect(page.getByText('Not answered').first()).toBeVisible();
  });

  test('short answers are self-graded without an API key', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
    await page.getByRole('button', { name: 'Question 4: Not answered' }).click();
    await page.getByLabel('Your answer').fill('So the final ACK can be retransmitted.');
    await page.getByTestId('quiz-primary').click();
    const feedback = page.getByRole('region', { name: 'Feedback' });
    await expect(feedback).toContainText('Grade yourself');
    await expect(feedback).toContainText('TIME_WAIT lasts 2×MSL');
    await expect(page.getByTestId('quiz-primary')).toBeDisabled();
    await feedback.getByRole('button', { name: 'Got it' }).click();
    await expect(feedback).toContainText('Correct');
    await expect(feedback).toContainText('Self-graded');
    const last = backend.requests.filter((r) => r.path.endsWith('/answers')).at(-1);
    expect(
      (last?.body as { response: { selfGrade?: number } } | undefined)?.response.selfGrade,
    ).toBe(1);
  });

  test('shows rate limits and missing attempts', async ({ page }) => {
    const backend = await setup(page);
    backend.fail(/POST \/api\/quiz\/attempts\/.+\/answers/, 429, {
      error: { code: 'rate_limited', message: 'You are answering too fast.', retryAfter: 2 },
    });
    await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
    await page.getByRole('radio', { name: /page fault/ }).click();
    await page.getByTestId('quiz-primary').click();
    await expect(page.locator('p[role=alert]')).toContainText('You are answering too fast');
    await expect(page.getByTestId('quiz-primary')).toHaveText(/Try again in \ds/);
    await expect(page.getByTestId('quiz-primary')).toHaveText(/Submit answer/, { timeout: 5000 });
    await page.getByTestId('quiz-primary').click();
    await expect(page.getByRole('region', { name: 'Feedback' })).toContainText('Correct');

    backend.fail(/GET \/api\/quiz\/attempts\/00000000-0000-4000-8000-00000000dead/, 404, {
      error: { code: 'not_found', message: 'Quiz not found.' },
    });
    await page.goto('/quiz/00000000-0000-4000-8000-00000000dead');
    await expect(page.getByText('This quiz does not exist')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to quizzes' })).toBeVisible();
  });
});
