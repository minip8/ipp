/**
 * Quizzes on a phone (390 x 844, touch): taking a quiz to its results, an old discussion and the
 * question bank lay out without sideways scrolling, keep the primary action in reach and use
 * 16px text fields (iOS zooms the page into smaller ones).
 */
import type { QuizAttempt } from '@ipp/contracts';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { DISCUSSION_FOLLOW_UP, makeAttempt, QUIZ_ATTEMPT_ID, QUIZ_QUESTIONS } from './fixtures';
import { QUIZ_BANK_LONG, QUIZ_BANK_TOPIC } from './fixtures-quiz-bank';
import { setup } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const BANK = `/quiz/topics/${QUIZ_BANK_TOPIC}`;

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'page is wider than the viewport').toBeLessThanOrEqual(innerWidth);
}

async function fontSize(field: Locator) {
  return field.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
}

/** The element is on screen and at least 40px tall: reachable and big enough for a thumb. */
async function expectThumbable(el: Locator) {
  await expect(el).toBeInViewport();
  const box = await el.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
}

test('takes a practice quiz to its results', async ({ page }) => {
  await setup(page);
  await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
  const primary = page.getByTestId('quiz-primary');
  const feedback = page.getByRole('region', { name: 'Feedback' });

  // single choice
  await page.getByRole('radio', { name: /page fault/ }).tap();
  await expectNoHorizontalOverflow(page);
  await expectThumbable(primary);
  await primary.tap();
  await expect(feedback).toContainText('Correct');
  // The answer bar stays at the foot of the screen, and the feedback is brought into view.
  await expectThumbable(primary);
  await expect(feedback).toBeInViewport();
  await primary.tap();

  // multiple choice
  await expect(page.getByTestId('quiz-counter')).toHaveText('Question 2 of 4');
  await page.getByRole('checkbox', { name: /opposite orders/ }).tap();
  await page.getByRole('checkbox', { name: /condition variable/ }).tap();
  await primary.tap();
  await expect(feedback).toContainText('Partly correct');
  await expectNoHorizontalOverflow(page);
  await primary.tap();

  // output prediction: the program scrolls inside its own box, not the page
  await expect(page.getByText('C++20')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('radio', { name: /Prints exactly/ }).tap();
  const output = page.getByLabel('Output');
  expect(await fontSize(output)).toBeGreaterThanOrEqual(16);
  await output.fill('a|d');
  await primary.tap();
  await expect(feedback).toContainText('copy elision');
  await primary.tap();

  // open question
  const answer = page.getByLabel('Your answer');
  expect(await fontSize(answer)).toBeGreaterThanOrEqual(16);
  await answer.fill('So the final ACK can be retransmitted if the peer resends its FIN.');
  await primary.tap();
  await expect(feedback).toContainText('Reference answer');
  await expect(primary).toHaveText(/See results/);
  await expectNoHorizontalOverflow(page);
  await primary.tap();

  // results
  await expect(page.getByTestId('quiz-score')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const review = page.getByRole('region', { name: 'Review' });
  // Not filtered by `expanded`: the locator is re-resolved after the tap.
  const first = review.locator('button[aria-expanded]').first();
  await first.tap();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expectNoHorizontalOverflow(page);
  await expectThumbable(page.getByRole('button', { name: 'Practice missed questions' }));
});

test('exam: the finish dialog fits the screen', async ({ page }) => {
  await setup(page, (b) => {
    b.quizMode = 'exam';
  });
  await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
  await page.getByRole('radio', { name: /TLB/ }).tap();
  await page.getByTestId('quiz-primary').tap();
  await expect(page.getByTestId('quiz-counter')).toHaveText('Question 2 of 4');
  await page.getByRole('button', { name: 'Finish quiz' }).first().tap();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('button', { name: 'Finish quiz' }).tap();
  await expect(page.getByTestId('quiz-score')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('an old discussion keeps the reply box in reach', async ({ page }) => {
  await setup(page, (b) => {
    b.attempts.set(
      QUIZ_ATTEMPT_ID,
      makeAttempt({
        mode: 'discussion',
        topics: ['networking'],
        questions: QUIZ_QUESTIONS.filter(
          (q) => q.type === 'short',
        ) as unknown as QuizAttempt['questions'],
      }),
    );
  });
  await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
  const thread = page.getByRole('list', { name: 'Conversation' });
  await expect(thread).toContainText('TIME_WAIT');
  const reply = page.getByLabel('Your reply');
  // Not focused on arrival on a touch screen: that would open the keyboard over the question.
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
    await expect(reply).not.toBeFocused();
  expect(await fontSize(reply)).toBeGreaterThanOrEqual(16);
  await expect(reply).toBeInViewport();
  await expectNoHorizontalOverflow(page);

  await reply.fill('So late segments from the old connection die out.');
  const send = page.getByRole('button', { name: 'Send' });
  await expectThumbable(send);
  await send.tap();
  await expect(thread).toContainText(DISCUSSION_FOLLOW_UP);
  await expect(reply).toBeInViewport();
  await expectThumbable(send);

  await reply.fill('And so the final ACK can be resent.');
  await send.tap();
  await expect(page.getByRole('region', { name: 'Feedback' })).toBeVisible();
  const next = page.getByTestId('quiz-primary');
  await expect(next).toHaveText(/See results/);
  await expectThumbable(next);
  await expectNoHorizontalOverflow(page);
  await next.tap();
  await expect(page.getByTestId('quiz-score')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // Going again is an interview on its topic, not a new discussion.
  await expectThumbable(page.getByRole('link', { name: 'Interview on this topic' }));
});

test('browses the question bank and answers a question', async ({ page }) => {
  await setup(page);
  await page.goto(BANK);
  const cards = page.getByTestId('bank-subtopics').getByRole('link');
  await expect(cards).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  const search = page.getByLabel('Search questions');
  expect(await fontSize(search)).toBeGreaterThanOrEqual(16);

  // A subtopic: its list, full width.
  await cards.nth(2).tap();
  await expect(page.getByRole('heading', { name: 'Virtual memory' })).toBeVisible();
  const list = page.getByTestId('bank-list');
  await expect(list.getByRole('link')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  await expectThumbable(page.getByRole('button', { name: /^Previous subtopic/ }));

  // A question, alone on the screen, with its answer bar at the foot.
  await list.getByRole('link').nth(1).tap();
  await expect(list).toBeHidden();
  await expectNoHorizontalOverflow(page);
  const primary = page.getByTestId('bank-primary');
  await page.getByRole('radio', { name: /page fault/ }).tap();
  await expectThumbable(primary);
  await primary.tap();
  const feedback = page.getByRole('region', { name: 'Feedback' });
  await expect(feedback).toContainText('Correct');
  await expect(feedback).toBeInViewport();
  await expectThumbable(primary);
  await expectNoHorizontalOverflow(page);
});

test('a long bank fits the phone', async ({ page }) => {
  await setup(page, (b) => {
    b.quizBank.questions = QUIZ_BANK_LONG;
  });
  await page.goto(BANK);
  await expect(page.getByTestId('bank-subtopics')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Search questions').fill('s');
  await page.getByRole('radio', { name: /^New/ }).tap();
  await expectNoHorizontalOverflow(page);
  await page.goto(`${BANK}?question=os-processes-004`);
  await expect(page.getByLabel('Your answer')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
