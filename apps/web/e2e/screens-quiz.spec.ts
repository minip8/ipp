/** Visual review screenshots for quizzes. Run with SCREENS=1 playwright test screens-quiz. */

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { aiKeyStatus, QUIZ_ATTEMPT_ID } from './fixtures';
import { QUIZ_BANK_LONG, QUIZ_BANK_TOPIC } from './fixtures-quiz-bank';
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
      await expect(page.getByTestId('bank-list')).toBeVisible();
      await shoot(page, 'quiz-bank-list', { fullPage: true });

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

    test('question bank outline', async ({ page }) => {
      await setup(page, (b) => {
        b.quizBank.questions = QUIZ_BANK_LONG;
      });
      const bank = `/quiz/topics/${QUIZ_BANK_TOPIC}`;
      await page.goto(bank);
      await expect(page.getByTestId('bank-list')).toBeVisible();
      await shoot(page, 'quiz-bank-outline', { fullPage: true });
      await page.goto(`${bank}?question=os-processes-004`);
      await expect(page.getByLabel('Your answer')).toBeVisible();
      await shoot(page, 'quiz-bank-outline-open', { fullPage: true });
    });
  });
}
