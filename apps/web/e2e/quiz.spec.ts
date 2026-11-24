import { expect, test } from '@playwright/test';
import { aiKeyStatus, QUIZ_ATTEMPT_ID } from './fixtures';
import { QUIZ_BANK_LONG, QUIZ_BANK_TOPIC } from './fixtures-quiz-bank';
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

test.describe('question bank', () => {
  const BANK = `/quiz/topics/${QUIZ_BANK_TOPIC}`;

  test('is reachable from the hub and shows status at a glance', async ({ page }) => {
    await setup(page);
    await page.goto('/quiz');
    await expect(
      page.getByRole('link', { name: 'Browse Operating systems questions' }),
    ).toBeVisible();
    await page
      .getByRole('region', { name: 'Browse the question bank' })
      .getByRole('link', { name: /^Operating systems/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`${BANK}$`));
    await expect(page.getByRole('heading', { name: 'Operating systems' })).toBeVisible();
    await expect(page.getByTestId('bank-progress')).toHaveText(
      '1 correct · 2 to revisit · 3 not answered yet, of 6 questions',
    );
    const rows = page.getByTestId('bank-list').getByRole('link');
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0)).toHaveAccessibleName(/fork\(\) return.*Correct$/);
    await expect(rows.nth(3)).toHaveAccessibleName(/Partly correct$/);
    await expect(rows.nth(4)).toHaveAccessibleName(/Incorrect$/);
    await expect(rows.nth(5)).toHaveAccessibleName(/Not answered$/);
    await expect(page.getByText('Pick a question')).toBeVisible();

    // The quiz flow stays one click away, with this topic preselected.
    await page.getByRole('link', { name: 'Take a quiz instead' }).click();
    await expect(page).toHaveURL(/\/quiz\?topic=operating-systems$/);
    await expect(page.getByRole('button', { name: /^Operating systems/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Start quiz' })).toBeEnabled();
  });

  test('answers questions in place and steps through the filtered list', async ({ page }) => {
    const backend = await setup(page);
    await page.goto(`${BANK}?status=new`);
    await expect(page.getByRole('radio', { name: 'New 3' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const rows = page.getByTestId('bank-list').getByRole('link');
    await expect(rows).toHaveCount(3);
    await rows.first().click();
    await expect(page).toHaveURL(/status=new&question=os-processes-004$/);
    const counter = page.getByTestId('bank-counter');
    const primary = page.getByTestId('bank-primary');
    const feedback = page.getByRole('region', { name: 'Feedback' });
    await expect(counter).toHaveText('Question 1 of 3');

    // short answer, graded by the AI
    const text = 'They share the address space and open files; each thread has its own stack.';
    await page.getByLabel('Your answer').fill(text);
    await primary.click();
    await expect(feedback).toContainText('Graded by the AI');
    await expect(feedback).toContainText('Missed: registers and TLS');
    await expect(page.getByTestId('bank-status')).toContainText('Correct');
    // Answered questions stay listed until the filters change; the counts follow.
    await expect(rows).toHaveCount(3);
    await expect(page.getByRole('radio', { name: 'New 2' })).toBeVisible();
    const sent = backend.requests.find(
      (r) => r.method === 'POST' && r.path === '/api/quiz/questions/os-processes-004/answers',
    );
    expect(sent?.body).toEqual({ response: { type: 'short', text } });
    // Topic stats are refetched (hub and dashboard).
    await expect
      .poll(() => backend.requests.filter((r) => r.path === '/api/quiz/topics').length)
      .toBeGreaterThan(1);

    // output prediction
    await primary.click();
    await expect(counter).toHaveText('Question 2 of 3');
    await expect(page).toHaveURL(/question=os-processes-007$/);
    await page.getByRole('radio', { name: /Prints exactly/ }).click();
    await page.getByLabel('Output').fill('x\nx');
    await primary.click();
    await expect(feedback).toContainText('printed twice');
    await expect(page.getByTestId('bank-status')).toHaveText(/^Correct/);

    // single choice with the keyboard
    await primary.click();
    await expect(counter).toHaveText('Question 3 of 3');
    await page.keyboard.press('a');
    await expect(page.getByRole('radio', { name: /page fault/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText('Correct');

    // Back and forth keeps what was answered on this page.
    await page.keyboard.press('k');
    await expect(counter).toHaveText('Question 2 of 3');
    await expect(feedback).toContainText('printed twice');
    await page.keyboard.press('j');
    await expect(counter).toHaveText('Question 3 of 3');
    await expect(primary).toHaveText(/All done/);
    await expect(primary).toBeDisabled();
    await expect(
      page.getByText('Every question in this list is answered correctly.'),
    ).toBeVisible();

    // No attempt was created or finished along the way.
    expect(backend.requests.filter((r) => r.path.startsWith('/api/quiz/attempts'))).toEqual([]);

    // Changing the filters drops the answered questions from "New" (the open one stays).
    await page.getByRole('radio', { name: /^All/ }).click();
    await expect(rows).toHaveCount(6);
    await page.getByRole('radio', { name: 'New 0' }).click();
    await expect(rows).toHaveCount(1);
    await expect(counter).toHaveText('Question 1 of 1');
  });

  test('deep links show the previous answer and allow answering again', async ({ page }) => {
    await setup(page);
    await page.goto(`${BANK}?question=os-virtual-memory-001`);
    const feedback = page.getByRole('region', { name: 'Feedback' });
    await expect(feedback).toContainText('Incorrect');
    await expect(page.getByText(/^Your previous answer/)).toBeVisible();
    await expect(page.getByRole('radio', { name: /page table/ })).toContainText(
      'Your answer · incorrect',
    );
    await expect(page.getByRole('radio', { name: /TLB/ })).toContainText('Correct answer');

    await page.getByRole('button', { name: 'Answer again' }).click();
    await expect(feedback).toHaveCount(0);
    await expect(page.getByRole('radio', { name: /page table/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await page.getByRole('radio', { name: /TLB/ }).click();
    await page.getByTestId('bank-primary').click();
    await expect(feedback).toContainText('Correct');
    await expect(page.getByTestId('bank-status')).toContainText('Correct');
    await expect(page.getByTestId('bank-progress')).toHaveText(
      '2 correct · 1 to revisit · 3 not answered yet, of 6 questions',
    );

    // Saved server-side: a reload shows the new answer.
    await page.reload();
    await expect(feedback).toContainText('Correct');
    await expect(page.getByRole('radio', { name: /TLB/ })).toContainText('Your answer · correct');
  });

  test('filters by difficulty and type; empty, unknown and missing states', async ({ page }) => {
    await setup(page);
    await page.goto(BANK);
    const rows = page.getByTestId('bank-list').getByRole('link');
    await expect(rows).toHaveCount(6);
    await page.getByRole('combobox', { name: 'Difficulty' }).click();
    await page.getByRole('option', { name: 'Hard' }).click();
    await expect(page).toHaveURL(/difficulty=hard$/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('What does this program print?');
    await page.getByRole('combobox', { name: 'Difficulty' }).click();
    await page.getByRole('option', { name: 'Any difficulty' }).click();
    await page.getByRole('combobox', { name: 'Question type' }).click();
    await page.getByRole('option', { name: 'Single choice' }).click();
    await expect(rows).toHaveCount(3);
    await page.getByRole('radio', { name: /^Missed/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/status=missed&type=single$/);
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(rows).toHaveCount(6);

    await page.goto(`${BANK}?question=not-a-question`);
    await expect(page.getByText('This question is not in the bank')).toBeVisible();
    await page.getByRole('button', { name: 'Show all questions' }).click();
    await expect(page.getByText('Pick a question')).toBeVisible();

    await page.goto('/quiz/topics/python');
    await expect(page.getByText('No questions in this topic yet')).toBeVisible();
    await page.goto('/quiz/topics/nope');
    await expect(page.getByText('This topic does not exist')).toBeVisible();
  });

  test('subtopics are sections that collapse', async ({ page }) => {
    await setup(page);
    await page.goto(BANK);
    const list = page.getByTestId('bank-list');
    const rows = list.getByRole('link');
    const sections = list.getByRole('button');
    // A short list shows every question, under its subtopic.
    await expect(page.getByText('3 subtopics · 6 questions')).toBeVisible();
    await expect(sections).toHaveCount(3);
    const processes = list.getByRole('button', { name: 'Processes 1 of 3 correct' });
    await expect(processes).toHaveAttribute('aria-expanded', 'true');
    await processes.click();
    await expect(processes).toHaveAttribute('aria-expanded', 'false');
    await expect(rows).toHaveCount(3);
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(rows).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(rows).toHaveCount(6);
  });

  test('a long list opens as an outline of its subtopics', async ({ page }) => {
    await setup(page, (b) => {
      b.quizBank.questions = QUIZ_BANK_LONG;
    });
    await page.goto(BANK);
    const list = page.getByTestId('bank-list');
    const rows = list.getByRole('link');
    const sections = list.getByRole('button');
    await expect(page.getByText('7 subtopics · 30 questions')).toBeVisible();
    await expect(sections).toHaveCount(7);
    await expect(rows).toHaveCount(0);
    await expect(sections.first()).toHaveAccessibleName('File systems 0 of 6 correct');

    // Opening one subtopic leaves the others closed.
    const signals = list.getByRole('button', { name: /^Signals/ });
    await signals.click();
    await expect(signals).toHaveAttribute('aria-expanded', 'true');
    await expect(rows).toHaveCount(6);
    await signals.click();
    await expect(rows).toHaveCount(0);

    // Going to a question opens its section, and stepping on opens the next one.
    await page.getByRole('button', { name: 'Start with the first open question' }).click();
    await expect(page).toHaveURL(/question=os-long-0-0$/);
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');
    for (let n = 2; n <= 7; n++) {
      await page.keyboard.press('j');
      await expect(page.getByTestId('bank-counter')).toHaveText(`Question ${n} of 30`);
    }
    await expect(list.getByRole('button', { name: /^Processes/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(rows).toHaveCount(9);

    // Few enough questions after filtering: all of them are shown again.
    await page.getByRole('radio', { name: /^Missed/ }).click();
    await expect(page.getByText('3 subtopics · 3 questions')).toBeVisible();
    await expect(rows).toHaveCount(3);

    // A deep link shows its question in the list.
    await page.goto(`${BANK}?question=os-virtual-memory-002`);
    await expect(list.getByRole('button', { expanded: true })).toHaveAccessibleName(
      /^Virtual memory/,
    );
    await expect(list.locator('[aria-current="true"]')).toBeInViewport();
  });

  test('short answers are self-graded without an API key', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto(`${BANK}?question=os-processes-004`);
    await expect(page.getByTestId('quiz-key-prompt')).toBeVisible();
    await page.getByLabel('Your answer').fill('Threads share memory.');
    await page.getByTestId('bank-primary').click();
    const feedback = page.getByRole('region', { name: 'Feedback' });
    await expect(feedback).toContainText('Grade yourself');
    await expect(page.getByTestId('bank-primary')).toBeDisabled();
    await feedback.getByRole('button', { name: 'Got it' }).click();
    await expect(feedback).toContainText('Self-graded');
    await expect(page.getByTestId('bank-status')).toContainText('Correct');
    const last = backend.requests.filter((r) => r.path.endsWith('/answers')).at(-1);
    expect(last?.body).toEqual({
      response: { type: 'short', text: 'Threads share memory.', selfGrade: 1 },
    });
  });

  test('rate limits show a countdown', async ({ page }) => {
    const backend = await setup(page);
    backend.fail(/POST \/api\/quiz\/questions\/.+\/answers/, 429, {
      error: { code: 'rate_limited', message: 'You are answering too fast.', retryAfter: 2 },
    });
    await page.goto(`${BANK}?question=os-virtual-memory-002`);
    await page.getByRole('radio', { name: /page fault/ }).click();
    const primary = page.getByTestId('bank-primary');
    await primary.click();
    await expect(page.locator('p[role=alert]')).toContainText('You are answering too fast');
    await expect(primary).toHaveText(/Try again in \ds/);
    await expect(primary).toHaveText(/Submit answer/, { timeout: 5000 });
    await primary.click();
    await expect(page.getByRole('region', { name: 'Feedback' })).toContainText('Correct');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('switches between the list and a question', async ({ page }) => {
      await setup(page);
      await page.goto(BANK);
      const list = page.getByTestId('bank-list');
      await expect(list).toBeVisible();
      await expect(page.getByText('Pick a question')).toBeHidden();
      await list.getByRole('link').nth(5).click();
      await expect(list).toBeHidden();
      await expect(page.getByTestId('bank-counter')).toHaveText('Question 6 of 6');
      await page.getByRole('button', { name: 'Previous question' }).click();
      await expect(page.getByTestId('bank-counter')).toHaveText('Question 5 of 6');
      await page.getByRole('button', { name: 'All Operating systems questions' }).click();
      await expect(list).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${BANK}$`));
    });
  });
});
