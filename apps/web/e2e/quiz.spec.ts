import { expect, test } from '@playwright/test';
import { aiKeyStatus, DISCUSSION_FOLLOW_UP, QUIZ_ATTEMPT_ID } from './fixtures';
import { QUIZ_BANK_LONG, QUIZ_BANK_TOPIC } from './fixtures-quiz-bank';
import { setup } from './helpers';

test.describe('quizzes', () => {
  test('starts a practice attempt from the hub', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/software/practice');
    await expect(page.getByRole('button', { name: /^Computer architecture/ })).toContainText(
      '0 of 40 questions answered',
    );
    const start = page.getByRole('button', { name: 'Start quiz' });
    await expect(start).toBeDisabled();
    await page.getByRole('button', { name: /^Operating systems/ }).click();
    await page.getByRole('button', { name: /^Concurrency/ }).click();
    await page.getByRole('radio', { name: 'Hard' }).click();
    await page.getByRole('radio', { name: '5', exact: true }).click();
    await start.click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]{36}$/);
    // Open questions are left to discussions: three of the four fixtures are auto-graded.
    await expect(page.getByTestId('quiz-counter')).toHaveText('Question 1 of 3');
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
    await expect(page.getByRole('link', { name: 'Back to practice' })).toBeVisible();
  });
});

test.describe('quiz setup and discussions', () => {
  test('remembers the choices after leaving the page and coming back', async ({ page }) => {
    await setup(page);
    await page.goto('/software/practice');
    await page.getByRole('button', { name: /^Networking/ }).click();
    await page.getByRole('radio', { name: 'Exam' }).click();
    await page.getByRole('radio', { name: 'Hard' }).click();
    await page.getByRole('radio', { name: '20', exact: true }).click();
    await page.getByRole('switch').click();

    await page.getByRole('link', { name: 'Interviews' }).click();
    await expect(page).toHaveURL(/\/software\/interviews$/);
    await page.getByRole('link', { name: 'Practice' }).click();
    await expect(page.getByRole('button', { name: /^Networking/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('radio', { name: 'Exam' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Hard' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '20', exact: true })).toBeChecked();
    await expect(page.getByRole('switch')).not.toBeChecked();
    // And after a full reload.
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Exam' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Start quiz' })).toBeEnabled();
  });

  test('a discussion talks an open question through and then grades it', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/software/practice');
    await page.getByRole('button', { name: /^Networking/ }).click();
    await page.getByRole('radio', { name: 'Discussion' }).click();
    await expect(page.getByTestId('setup-summary')).toContainText('open questions to draw from');
    await page.getByRole('radio', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: 'Start discussion' }).click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]{36}$/);
    expect(
      backend.requests.find((r) => r.method === 'POST' && r.path === '/api/quiz/attempts')?.body,
    ).toMatchObject({ topics: ['networking'], mode: 'discussion', count: 3 });

    const thread = page.getByRole('list', { name: 'Conversation' });
    await expect(page.getByTestId('quiz-counter')).toHaveText('Question 1 of 1');
    await expect(thread).toContainText('TIME_WAIT');
    const send = page.getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();
    await page.getByLabel('Your reply').fill('So late segments from the old connection die out.');
    await send.click();
    await expect(thread).toContainText(DISCUSSION_FOLLOW_UP);
    await expect(page.getByRole('region', { name: 'Feedback' })).toHaveCount(0);

    await page.getByLabel('Your reply').fill('And so the final ACK can be resent.');
    await page.getByLabel('Your reply').press('ControlOrMeta+Enter');
    await expect(page.getByRole('region', { name: 'Feedback' })).toBeVisible();
    await expect(page.getByLabel('Your reply')).toHaveCount(0);
    await expect(thread.getByRole('listitem')).toHaveCount(4);

    await page.getByRole('button', { name: 'See results' }).click();
    await expect(page.getByTestId('quiz-score')).toBeVisible();
    await expect(page.getByText('Discussion', { exact: true })).toBeVisible();
  });

  test('a discussion cannot start without an API key', async ({ page }) => {
    await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/software/practice');
    await page.getByRole('button', { name: /^Networking/ }).click();
    await expect(page.getByRole('button', { name: 'Start quiz' })).toBeEnabled();
    await page.getByRole('radio', { name: 'Discussion' }).click();
    await expect(page.getByTestId('discussion-key-prompt')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start discussion' })).toBeDisabled();
  });
});

test.describe('question bank', () => {
  const BANK = `/quiz/topics/${QUIZ_BANK_TOPIC}`;

  test('is reachable from the hub and browsed by subtopic', async ({ page }) => {
    await setup(page);
    await page.goto('/software/practice');
    await page.getByRole('link', { name: 'Browse Operating systems questions' }).click();
    await expect(page).toHaveURL(new RegExp(`${BANK}$`));
    await expect(page.getByRole('heading', { name: 'Operating systems' })).toBeVisible();
    await expect(page.getByTestId('bank-progress')).toHaveText(
      '1 correct · 2 to revisit · 3 not answered yet, of 6 questions',
    );

    // The overview: one card per subtopic, with how far along it is.
    await expect(page.getByTestId('bank-summary')).toHaveText('3 subtopics · 6 questions');
    const cards = page.getByTestId('bank-subtopics').getByRole('link');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAccessibleName('Processes 1 of 3 correct');
    await expect(cards.nth(1)).toHaveAccessibleName('Synchronisation 0 of 1 correct');
    await expect(cards.nth(2)).toHaveAccessibleName('Virtual memory 0 of 2 correct');

    // A subtopic opens on its first question still to get right, beside the subtopic's list.
    await cards.nth(0).click();
    await expect(page).toHaveURL(/question=os-processes-004$/);
    await expect(page.getByRole('heading', { name: 'Processes' })).toBeVisible();
    await expect(page.getByText('Subtopic 1 of 3')).toBeVisible();
    await expect(page.getByTestId('bank-subtopic-progress')).toHaveText('1 of 3 correct');
    const rows = page.getByTestId('bank-list').getByRole('link');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAccessibleName(/fork\(\) return.*Correct$/);
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByLabel('Your answer')).toBeVisible();

    // On to the next subtopics without going back.
    await page.getByRole('button', { name: 'Next subtopic: Synchronisation' }).click();
    await expect(page).toHaveURL(/question=concurrency-primitives-004$/);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toHaveAccessibleName(/Partly correct$/);
    await page.getByRole('button', { name: 'Next subtopic Virtual memory' }).click();
    await expect(page).toHaveURL(/question=os-virtual-memory-001$/);
    await expect(rows.nth(0)).toHaveAccessibleName(/Incorrect$/);
    await expect(rows.nth(1)).toHaveAccessibleName(/Not answered$/);
    await page.getByRole('button', { name: 'Previous subtopic: Synchronisation' }).click();
    await expect(page.getByRole('heading', { name: 'Synchronisation' })).toBeVisible();

    // Back on the overview, the subtopic just left is the one in focus.
    await page.getByRole('link', { name: 'All subtopics' }).click();
    await expect(page).toHaveURL(new RegExp(`${BANK}$`));
    await expect(cards.nth(1)).toBeFocused();

    // The quiz flow stays one click away, with this topic preselected.
    await page.getByRole('link', { name: 'Take a quiz instead' }).click();
    await expect(page).toHaveURL(/\/software\/practice\?topic=operating-systems$/);
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
    await expect(page.getByTestId('bank-summary')).toHaveText('2 subtopics · 3 questions match');
    const cards = page.getByTestId('bank-subtopics').getByRole('link');
    await expect(cards.nth(0)).toHaveAccessibleName('Processes 1 of 3 correct. 2 of 3 match');
    await page.getByRole('button', { name: 'Start with the first open question' }).click();
    await expect(page).toHaveURL(/status=new&question=os-processes-004$/);
    const rows = page.getByTestId('bank-list').getByRole('link');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('bank-subtopic-progress')).toHaveText(
      '1 of 3 correct · showing 2',
    );
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
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole('radio', { name: 'New 2' })).toBeVisible();
    await expect(page.getByTestId('bank-subtopic-progress')).toHaveText(
      '2 of 3 correct · showing 2',
    );
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

    // single choice with the keyboard; Next carries on into the next subtopic that has a match
    await primary.click();
    await expect(counter).toHaveText('Question 3 of 3');
    await expect(page.getByRole('heading', { name: 'Virtual memory' })).toBeVisible();
    await expect(rows).toHaveCount(1);
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
    await expect(page.getByRole('heading', { name: 'Processes' })).toBeVisible();
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
    await expect(rows).toHaveCount(2);
    await expect(counter).toHaveText('Question 6 of 6');
    await page.getByRole('radio', { name: 'New 0' }).click();
    await expect(rows).toHaveCount(1);
    await expect(counter).toHaveText('Question 1 of 1');
    // The overview only counts what matches now.
    await page.getByRole('link', { name: 'All subtopics' }).click();
    await expect(page.getByText('You have answered every question that matches.')).toBeVisible();
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
    // The question's subtopic is listed beside it.
    await expect(page.getByRole('heading', { name: 'Virtual memory' })).toBeVisible();
    await expect(page.getByTestId('bank-list').locator('[aria-current="true"]')).toBeInViewport();
    await expect(page.getByTestId('bank-subtopic-progress')).toHaveText(
      '0 of 2 correct · 1 to revisit',
    );

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
    await expect(page.getByTestId('bank-subtopic-progress')).toHaveText('1 of 2 correct');

    // Saved server-side: a reload shows the new answer.
    await page.reload();
    await expect(feedback).toContainText('Correct');
    await expect(page.getByRole('radio', { name: /TLB/ })).toContainText('Your answer · correct');
    await page.getByRole('link', { name: 'All subtopics' }).click();
    await expect(page.getByTestId('bank-progress')).toHaveText(
      '2 correct · 1 to revisit · 3 not answered yet, of 6 questions',
    );
  });

  test('filters by difficulty and type; empty, unknown and missing states', async ({ page }) => {
    await setup(page);
    await page.goto(BANK);
    const cards = page.getByTestId('bank-subtopics').getByRole('link');
    const summary = page.getByTestId('bank-summary');
    await expect(cards).toHaveCount(3);
    await page.getByRole('combobox', { name: 'Difficulty' }).click();
    await page.getByRole('option', { name: 'Hard' }).click();
    await expect(page).toHaveURL(/difficulty=hard$/);
    await expect(summary).toHaveText('1 subtopic · 1 question matches');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAccessibleName('Processes 1 of 3 correct. 1 of 3 matches');
    // The filters carry into the subtopic.
    await cards.first().click();
    const rows = page.getByTestId('bank-list').getByRole('link');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('What does this program print?');
    await expect(page).toHaveURL(/difficulty=hard&question=os-processes-007$/);
    await page.getByRole('combobox', { name: 'Difficulty' }).click();
    await page.getByRole('option', { name: 'Any difficulty' }).click();
    await expect(rows).toHaveCount(3);
    await page.getByRole('link', { name: 'All subtopics' }).click();

    await page.getByRole('combobox', { name: 'Question type' }).click();
    await page.getByRole('option', { name: 'Single choice' }).click();
    await expect(summary).toHaveText('2 subtopics · 3 questions match');
    await page.getByRole('radio', { name: /^Missed/ }).click();
    await expect(summary).toHaveText('1 subtopic · 1 question matches');
    await expect(page).toHaveURL(/status=missed&type=single$/);
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(cards).toHaveCount(3);
    await expect(page).toHaveURL(new RegExp(`${BANK}$`));

    await page.goto(`${BANK}?status=correct&type=short`);
    await expect(page.getByText('No questions match')).toBeVisible();

    await page.goto(`${BANK}?question=not-a-question`);
    await expect(page.getByText('This question is not in the bank')).toBeVisible();
    await page.getByRole('button', { name: 'Show all subtopics' }).click();
    await expect(cards).toHaveCount(3);
    // A subtopic the bank does not have is the overview too.
    await page.goto(`${BANK}?subtopic=Nope`);
    await expect(cards).toHaveCount(3);

    await page.goto('/quiz/topics/python');
    await expect(page.getByText('No questions in this topic yet')).toBeVisible();
    await page.goto('/quiz/topics/nope');
    await expect(page.getByText('This topic does not exist')).toBeVisible();
  });

  test('search finds subtopics and questions', async ({ page }) => {
    await setup(page);
    await page.goto(BANK);
    const cards = page.getByTestId('bank-subtopics').getByRole('link');
    const summary = page.getByTestId('bank-summary');
    const search = page.getByRole('searchbox', { name: 'Search questions' });
    await expect(cards).toHaveCount(3);

    // "/" goes to the search box. Words are looked up in prompts, code and choices.
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await page.keyboard.type('fork');
    await expect(summary).toHaveText('1 subtopic · 2 questions match');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAccessibleName('Processes 1 of 3 correct. 2 of 3 match');
    // The status counts follow the search.
    await expect(page.getByRole('radio', { name: 'All 2' })).toBeVisible();

    // Enter opens the first match still to get right; the list beside it is narrowed too.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/question=os-processes-007$/);
    const rows = page.getByTestId('bank-list').getByRole('link');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('bank-counter')).toHaveText('Question 2 of 2');

    // Searching again from a question goes back to the overview, without leaving the box.
    await search.fill('sigsegv');
    await expect(page).toHaveURL(new RegExp(`${BANK}$`));
    await expect(search).toBeFocused();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAccessibleName(
      'Virtual memory 0 of 2 correct. 1 of 2 matches',
    );

    // A subtopic's name finds all of its questions.
    await search.fill('virtual mem');
    await expect(cards.first()).toHaveAccessibleName('Virtual memory 0 of 2 correct. 2 of 2 match');

    await search.fill('no such thing');
    await expect(page.getByText('No questions match')).toBeVisible();
    await expect(page.getByText('Try other words')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(search).toHaveValue('');
    await expect(cards).toHaveCount(3);
  });

  test('a long bank: subtopic to subtopic, and links to a subtopic', async ({ page }) => {
    await setup(page, (b) => {
      b.quizBank.questions = QUIZ_BANK_LONG;
    });
    await page.goto(BANK);
    const cards = page.getByTestId('bank-subtopics').getByRole('link');
    const list = page.getByTestId('bank-list');
    const rows = list.getByRole('link');
    const counter = page.getByTestId('bank-counter');
    await expect(page.getByTestId('bank-summary')).toHaveText('7 subtopics · 30 questions');
    await expect(cards).toHaveCount(7);
    await expect(cards.first()).toHaveAccessibleName('File systems 0 of 6 correct');

    await page.getByRole('button', { name: 'Start with the first open question' }).click();
    await expect(page).toHaveURL(/question=os-long-0-0$/);
    await expect(page.getByText('Subtopic 1 of 7')).toBeVisible();
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('button', { name: 'Previous subtopic' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Stepping past the end of a subtopic moves the list on to the next one.
    for (let n = 2; n <= 7; n++) {
      await page.keyboard.press('j');
      await expect(counter).toHaveText(`Question ${n} of 30`);
    }
    await expect(page.getByRole('heading', { name: 'Processes' })).toBeVisible();
    await expect(page.getByText('Subtopic 2 of 7')).toBeVisible();
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');

    await page.getByRole('button', { name: 'Next subtopic: Scheduling' }).click();
    await expect(page).toHaveURL(/question=os-long-1-0$/);
    await expect(counter).toHaveText('Question 10 of 30');
    await expect(rows).toHaveCount(6);

    // The overview comes back at the subtopic that was open.
    await page.getByRole('link', { name: 'All subtopics' }).click();
    await expect(cards.nth(2)).toBeFocused();
    await expect(cards.nth(2)).toBeInViewport();

    // A deep link shows its question in its subtopic's list.
    await page.goto(`${BANK}?question=os-virtual-memory-002`);
    await expect(page.getByRole('heading', { name: 'Virtual memory' })).toBeVisible();
    await expect(page.getByText('Subtopic 7 of 7')).toBeVisible();
    await expect(list.locator('[aria-current="true"]')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Next subtopic' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // A link to a subtopic lists it and waits for a question to be picked.
    await page.goto(`${BANK}?subtopic=Signals`);
    await expect(page.getByRole('heading', { name: 'Signals' })).toBeVisible();
    await expect(rows).toHaveCount(6);
    await expect(page.getByText('Pick a question')).toBeVisible();
    await page.getByRole('button', { name: 'Start this subtopic' }).click();
    await expect(page).toHaveURL(/question=os-long-2-0$/);
    await expect(counter).toHaveText('Question 16 of 30');
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

    test('goes from subtopics to a list to a question, and back', async ({ page }) => {
      await setup(page);
      await page.goto(BANK);
      const cards = page.getByTestId('bank-subtopics').getByRole('link');
      const list = page.getByTestId('bank-list');
      await expect(cards).toHaveCount(3);

      // A subtopic shows its list first: there is no room for a question beside it.
      await cards.nth(2).click();
      await expect(page).toHaveURL(/subtopic=Virtual\+memory$/);
      await expect(page.getByRole('heading', { name: 'Virtual memory' })).toBeVisible();
      await expect(list.getByRole('link')).toHaveCount(2);
      await expect(page.getByText('Pick a question')).toBeHidden();

      await list.getByRole('link').nth(1).click();
      await expect(list).toBeHidden();
      await expect(page.getByTestId('bank-counter')).toHaveText('Question 6 of 6');
      await page.getByRole('button', { name: 'Previous question' }).click();
      await expect(page.getByTestId('bank-counter')).toHaveText('Question 5 of 6');

      await page.getByRole('link', { name: 'Virtual memory', exact: true }).click();
      await expect(list).toBeVisible();
      await expect(page).toHaveURL(/subtopic=Virtual\+memory$/);
      await page.getByRole('link', { name: 'All subtopics' }).click();
      await expect(cards).toHaveCount(3);
      await expect(page).toHaveURL(new RegExp(`${BANK}$`));
    });

    test('a new place starts at the top of the page', async ({ page }) => {
      await setup(page, (b) => {
        b.quizBank.questions = QUIZ_BANK_LONG;
      });
      await page.goto(BANK);
      const cards = page.getByTestId('bank-subtopics').getByRole('link');
      await cards.last().scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await cards.nth(5).click();
      await expect(page.getByRole('heading', { name: 'System calls' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      const rows = page.getByTestId('bank-list').getByRole('link');
      await rows.last().scrollIntoViewIfNeeded();
      await rows.last().click();
      await expect(page.getByTestId('bank-counter')).toBeInViewport();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    });
  });
});
