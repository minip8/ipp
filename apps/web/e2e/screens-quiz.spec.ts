/** Visual review screenshots for quizzes. Run with SCREENS=1 playwright test screens-quiz. */

import type { QuizAttempt } from '@ipp/contracts';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  aiKeyStatus,
  makeAttempt,
  QUIZ_ATTEMPT_ID,
  QUIZ_QUESTIONS,
  QUIZ_TOPICS_FUNDAMENTALS,
} from './fixtures';
import { QUIZ_BANK_LONG, QUIZ_BANK_TOPIC } from './fixtures-quiz-bank';
import { QUANT_TOPIC } from './fixtures-quiz-quant';
import { shoot as rawShoot, setup } from './helpers';

async function shoot(page: Page, name: string, opts?: { fullPage?: boolean }) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await rawShoot(page, name, opts);
}

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);

for (const width of WIDTHS) {
  test.describe(`quiz at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 } });

    test('hub', async ({ page }) => {
      await setup(page);
      await page.goto('/quiz');
      await page.getByRole('button', { name: /^C\+\+/ }).click();
      await page.getByRole('button', { name: /^Networking/ }).click();
      await page.waitForTimeout(300);
      await shoot(page, 'quiz-hub', { fullPage: true });
    });

    // Before any quant content: one track, so no headings (compare with quiz-hub of old).
    test('hub fundamentals', async ({ page }) => {
      await setup(page, (b) => {
        b.quizTopics = QUIZ_TOPICS_FUNDAMENTALS;
      });
      await page.goto('/quiz');
      await page.getByRole('button', { name: /^C\+\+/ }).click();
      await page.getByRole('button', { name: /^Networking/ }).click();
      await page.waitForTimeout(300);
      await shoot(page, 'quiz-hub-fundamentals', { fullPage: true });
    });

    test('numeric and math', async ({ page }) => {
      await setup(page);
      const bank = `/quiz/topics/${QUANT_TOPIC}`;
      await page.goto(bank);
      await expect(page.getByTestId('bank-subtopics')).toBeVisible();
      await page.getByRole('combobox', { name: 'Topic' }).click();
      await page.getByRole('listbox').waitFor();
      await shoot(page, 'quant-bank-topics');
      await page.keyboard.press('Escape');

      // Display math in the prompt, a value that cannot be sent, then a percentage.
      await page.goto(`${bank}?question=prob-uniform-sum`);
      const answer = page.getByLabel('Your answer');
      await answer.fill('about 1/8');
      await answer.press('Enter');
      await page.getByText('Enter a number').waitFor();
      await shoot(page, 'quant-numeric-problem', { fullPage: true });
      await answer.fill('12.5%');
      await answer.press('Enter');
      await page.getByRole('region', { name: 'Feedback' }).waitFor();
      await shoot(page, 'quant-numeric-correct', { fullPage: true });

      // A long display equation in the explanation, and answer text with math.
      await page.goto(`${bank}?question=prob-derangements`);
      await answer.fill('0.5');
      await shoot(page, 'quant-numeric-question', { fullPage: true });
      await answer.press('Enter');
      await page.getByRole('region', { name: 'Feedback' }).waitFor();
      await shoot(page, 'quant-numeric-wrong', { fullPage: true });

      // Math in the choices, and in the list beside the question.
      await page.goto(`${bank}?question=prob-binomial-variance`);
      await page
        .getByRole('radiogroup', { name: 'Answer choices' })
        .getByRole('radio')
        .nth(1)
        .locator('.katex')
        .waitFor();
      await shoot(page, 'quant-single-math', { fullPage: true });

      // A practice attempt to its results.
      await page.goto('/quiz');
      await page.getByRole('button', { name: /^Probability/ }).click();
      await page.getByRole('button', { name: 'Start quiz' }).click();
      const primary = page.getByTestId('quiz-primary');
      await answer.fill('0.368');
      await answer.press('Enter');
      await page.getByRole('region', { name: 'Feedback' }).waitFor();
      await shoot(page, 'quant-attempt-feedback', { fullPage: true });
      await primary.click();
      await answer.fill('5/36');
      await answer.press('Enter');
      await primary.click();
      await page.keyboard.press('b');
      await primary.click();
      await primary.click();
      await answer.fill('1/8');
      await answer.press('Enter');
      await primary.click();
      await answer.fill('5');
      await answer.press('Enter');
      await expect(primary).toHaveText(/See results/);
      await shoot(page, 'quant-numeric-unit', { fullPage: true });
      await primary.click();
      await expect(page.getByTestId('quiz-score')).toBeVisible();
      await page
        .getByRole('region', { name: 'Review' })
        .locator('button[aria-expanded]')
        .first()
        .click();
      await shoot(page, 'quant-results', { fullPage: true });

      // A discussion: math in the interviewer's turns.
      await page.goto('/quiz');
      await page.getByRole('radio', { name: 'Discussion' }).click();
      await page.getByRole('button', { name: 'Start discussion' }).click();
      await page
        .getByLabel('Your reply')
        .fill('Three families have a boy, and one of them has two.');
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.getByText('Interviewer is thinking')).toBeHidden();
      await shoot(page, 'quant-discussion', { fullPage: true });
    });

    test('hub history', async ({ page }) => {
      await setup(page);
      await page.goto('/quiz?view=history');
      await page.getByRole('region', { name: 'Past quizzes' }).getByRole('link').first().waitFor();
      await page.waitForTimeout(300);
      await shoot(page, 'quiz-history', { fullPage: true });
    });

    test('discussion', async ({ page }) => {
      await setup(page);
      await page.goto('/quiz');
      await page.getByRole('button', { name: /^Networking/ }).click();
      await page.getByRole('radio', { name: 'Discussion' }).click();
      await page.waitForTimeout(300);
      await shoot(page, 'quiz-hub-discussion', { fullPage: true });
      await page.getByRole('button', { name: 'Start discussion' }).click();
      await page.getByLabel('Your reply').fill('So late segments from the old connection die out.');
      await page.getByRole('button', { name: 'Send' }).click();
      await page.getByLabel('Your reply').fill('And so the final ACK can be resent if it is lost.');
      await shoot(page, 'quiz-discussion', { fullPage: true });
      await page.getByRole('button', { name: 'Send' }).click();
      await page.getByRole('region', { name: 'Feedback' }).waitFor();
      await shoot(page, 'quiz-discussion-feedback', { fullPage: true });
    });

    test('practice flow', async ({ page }) => {
      await setup(page);
      await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
      const primary = page.getByTestId('quiz-primary');

      await page.getByRole('radio', { name: /page fault/ }).waitFor();
      await page.getByRole('radio', { name: /page fault/ }).click();
      await shoot(page, 'quiz-single', { fullPage: true });
      await primary.click();
      await expect(page.getByText('Correct', { exact: true })).toBeVisible();
      await shoot(page, 'quiz-single-feedback', { fullPage: true });
      await primary.click();

      await page.getByRole('checkbox', { name: /opposite orders/ }).click();
      await page.getByRole('checkbox', { name: /condition variable/ }).click();
      await shoot(page, 'quiz-multiple', { fullPage: true });
      await primary.click();
      await expect(page.getByText('Partly correct', { exact: true })).toBeVisible();
      await shoot(page, 'quiz-multiple-feedback', { fullPage: true });
      await primary.click();

      await page.getByRole('radio', { name: /Prints exactly/ }).click();
      await page.getByLabel('Output').fill('ac|dd');
      await page.waitForTimeout(400);
      await shoot(page, 'quiz-output', { fullPage: true });
      await primary.click();
      await expect(page.getByText('Incorrect', { exact: true })).toBeVisible();
      await shoot(page, 'quiz-output-feedback', { fullPage: true });
      await primary.click();

      await page
        .getByLabel('Your answer')
        .fill(
          'The side that closes first keeps the connection around so it can resend the final ACK if the peer retransmits its FIN.',
        );
      await shoot(page, 'quiz-short', { fullPage: true });
      await primary.click();
      await expect(page.getByText('Feedback', { exact: true })).toBeVisible();
      await shoot(page, 'quiz-short-feedback', { fullPage: true });
      await primary.click();
      await expect(page.getByTestId('quiz-score')).toBeVisible();
      await shoot(page, 'quiz-results', { fullPage: true });
    });

    test('self-grade', async ({ page }) => {
      await setup(page, (b) => {
        b.aiKey = aiKeyStatus('missing');
      });
      await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
      await page.getByRole('button', { name: 'Question 4: Not answered' }).click();
      await page.getByLabel('Your answer').fill('So the final ACK can be retransmitted.');
      await page.getByTestId('quiz-primary').click();
      await expect(page.getByText('How did you do?')).toBeVisible();
      await shoot(page, 'quiz-self-grade', { fullPage: true });
    });

    test('question bank', async ({ page }) => {
      await setup(page);
      const bank = `/quiz/topics/${QUIZ_BANK_TOPIC}`;
      await page.goto(bank);
      await expect(page.getByTestId('bank-subtopics')).toBeVisible();
      await shoot(page, 'quiz-bank-overview', { fullPage: true });

      await page.goto(`${bank}?subtopic=Processes`);
      await expect(page.getByTestId('bank-list')).toBeVisible();
      await shoot(page, 'quiz-bank-subtopic', { fullPage: true });

      await page.goto(`${bank}?question=os-virtual-memory-002`);
      await page.getByRole('radio', { name: /page fault/ }).click();
      await shoot(page, 'quiz-bank-question', { fullPage: true });
      await page.getByTestId('bank-primary').click();
      await expect(page.getByRole('region', { name: 'Feedback' })).toBeVisible();
      await shoot(page, 'quiz-bank-feedback', { fullPage: true });

      // A previous answer, as a deep link opens it.
      await page.goto(`${bank}?question=concurrency-primitives-004`);
      await expect(page.getByRole('region', { name: 'Feedback' })).toContainText('Partly correct');
      await shoot(page, 'quiz-bank-previous', { fullPage: true });

      await page.goto(`${bank}?status=correct&type=short`);
      await expect(page.getByText('No questions match')).toBeVisible();
      await shoot(page, 'quiz-bank-empty');
    });

    test('question bank, many subtopics', async ({ page }) => {
      await setup(page, (b) => {
        b.quizBank.questions = QUIZ_BANK_LONG;
      });
      const bank = `/quiz/topics/${QUIZ_BANK_TOPIC}`;
      await page.goto(bank);
      await expect(page.getByTestId('bank-subtopics')).toBeVisible();
      await shoot(page, 'quiz-bank-overview-long', { fullPage: true });
      await page.getByLabel('Search questions').fill('s');
      await page.getByRole('radio', { name: /^New/ }).click();
      await shoot(page, 'quiz-bank-overview-narrowed', { fullPage: true });
      await page.goto(`${bank}?question=os-processes-004`);
      await expect(page.getByLabel('Your answer')).toBeVisible();
      await shoot(page, 'quiz-bank-long-question', { fullPage: true });
    });

    // Phones: what one screen shows, with the answer bar or reply box stuck to its foot (a
    // full-page capture puts sticky bars at their place in the flow instead).
    test('phone screens', async ({ page }) => {
      test.skip(width >= 600, 'phone widths only');
      await setup(page, (b) => {
        b.attempts.set(
          'b0000000-0000-4000-8000-0000000000d1',
          makeAttempt({
            id: 'b0000000-0000-4000-8000-0000000000d1',
            mode: 'discussion',
            topics: ['networking'],
            questions: QUIZ_QUESTIONS.filter(
              (q) => q.type === 'short',
            ) as unknown as QuizAttempt['questions'],
          }),
        );
      });
      await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
      const primary = page.getByTestId('quiz-primary');
      await page.getByRole('radio', { name: /page fault/ }).click();
      await primary.click();
      await primary.click();
      await page.getByRole('checkbox', { name: /opposite orders/ }).click();
      await primary.click();
      await primary.click();
      await page.getByRole('radio', { name: /Prints exactly/ }).click();
      await page.getByLabel('Output').fill('ac|dd');
      await page.getByLabel('Output').blur();
      await shoot(page, 'quiz-phone-output');
      await primary.click();
      await expect(page.getByText('Incorrect', { exact: true })).toBeVisible();
      await page.waitForTimeout(400);
      await rawShoot(page, 'quiz-phone-output-feedback');

      await page.goto('/quiz/b0000000-0000-4000-8000-0000000000d1');
      await page.getByLabel('Your reply').fill('So late segments from the old connection die out.');
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.getByText('Interviewer is thinking')).toBeHidden();
      await page.getByLabel('Your reply').fill('And so the final ACK can be resent if it is lost.');
      await page.getByLabel('Your reply').blur();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await rawShoot(page, 'quiz-phone-discussion');

      await page.goto(`/quiz/topics/${QUIZ_BANK_TOPIC}?question=os-virtual-memory-002`);
      await page.getByRole('radio', { name: /page fault/ }).click();
      await shoot(page, 'quiz-phone-bank-question');
    });
  });
}
