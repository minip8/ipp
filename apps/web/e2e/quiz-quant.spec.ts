/**
 * Groundwork for quant questions in the quiz UI: numeric answers (in the bank and in a practice
 * attempt), and LaTeX on quiz surfaces and nowhere else. Topics by track: practice.spec.ts.
 */
import { expect, type Page, test } from '@playwright/test';
import { ACTIVE_PAD_ID, makeAttempt, QUIZ_ATTEMPT_ID } from './fixtures';
import { QUANT_FOLLOW_UP, QUANT_QUESTIONS, QUANT_TOPIC } from './fixtures-quiz-quant';
import { setup } from './helpers';

const BANK = `/quiz/topics/${QUANT_TOPIC}`;

const answersSent = (b: { requests: { path: string; body: unknown }[] }) =>
  b.requests.filter((r) => r.path.endsWith('/answers')).map((r) => r.body);

async function noSideScroll(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);
}

test.describe('numeric answers', () => {
  test('in the bank: a fraction, a decimal, a wrong value, and what cannot be sent', async ({
    page,
  }) => {
    const backend = await setup(page);
    await page.goto(`${BANK}?question=prob-dice-sum`);
    const input = page.getByLabel('Your answer');
    const primary = page.getByTestId('bank-primary');
    const feedback = page.getByRole('region', { name: 'Feedback' });
    await expect(page.getByTestId('bank-counter')).toBeVisible();
    await expect(input).toHaveAccessibleDescription(
      'A fraction, a decimal to 3 significant figures, or a percentage.',
    );
    await expect(primary).toBeDisabled();

    // Not a number: explained under the field, nothing sent.
    await input.fill('five');
    await expect(primary).toBeEnabled();
    await input.press('Enter');
    const problem = page.getByText('Enter a number, like 5/36, 0.139 or 13.9%.');
    await expect(problem).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await primary.click();
    expect(answersSent(backend)).toEqual([]);

    // A correct fraction, sent with Enter. The message goes as soon as the value is a number.
    await input.fill('5/36');
    await expect(problem).toBeHidden();
    await input.press('Enter');
    await expect(feedback).toContainText('Correct');
    await expect(page.getByText('Your answer · correct')).toBeVisible();
    await expect(input).toHaveValue('5/36');
    await expect(input).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('correct-answer')).toHaveText('5/36');
    expect(answersSent(backend)).toEqual([{ response: { type: 'numeric', value: '5/36' } }]);

    // A decimal to three significant figures counts too.
    await page.getByRole('button', { name: 'Answer again' }).click();
    await expect(input).toHaveValue('');
    await input.fill(' 0.139 ');
    await primary.click();
    await expect(feedback).toContainText('Correct');
    expect(answersSent(backend).at(-1)).toEqual({ response: { type: 'numeric', value: '0.139' } });

    // Two figures do not.
    await page.getByRole('button', { name: 'Answer again' }).click();
    await input.fill('0.14');
    await input.press('Enter');
    await expect(feedback).toContainText('Incorrect');
    await expect(page.getByText('Your answer · incorrect')).toBeVisible();
    await expect(page.getByTestId('correct-answer')).toHaveText('5/36');
    await expect(page.getByTestId('bank-status')).toContainText('Incorrect');

    // The list beside the question calls the type Numeric, and the filter offers it.
    await expect(page.getByTestId('bank-list').getByRole('link').first()).toContainText('Numeric');
    await page.getByRole('combobox', { name: 'Question type' }).click();
    await page.getByRole('option', { name: 'Numeric' }).click();
    await expect(page).toHaveURL(/type=numeric/);
    await page.getByRole('link', { name: 'All subtopics' }).click();
    await expect(page.getByTestId('bank-summary')).toHaveText('4 subtopics · 4 questions match');
  });

  test('a unit beside the field; a percentage is one of the forms', async ({ page }) => {
    await setup(page);
    await page.goto(`${BANK}?question=prob-first-six`);
    const input = page.getByLabel('Your answer');
    await expect(input.locator('xpath=following-sibling::span')).toHaveText('rolls');
    await input.fill('6');
    await input.press('Enter');
    await expect(page.getByRole('region', { name: 'Feedback' })).toContainText('Correct');
    await expect(page.getByTestId('correct-answer')).toHaveText('6 rolls');

    await page.goto(`${BANK}?question=prob-uniform-sum`);
    await input.fill('12.5%');
    await input.press('Enter');
    await expect(page.getByRole('region', { name: 'Feedback' })).toContainText('Correct');
    await expect(page.getByTestId('correct-answer')).toHaveText('1/8');
  });

  test('in a practice attempt, through to the results', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/quant/practice');
    await page.getByRole('button', { name: /^Probability/ }).click();
    await page.getByRole('button', { name: 'Start quiz' }).click();
    await expect(page).toHaveURL(/\/quiz\/[0-9a-f-]{36}$/);
    const counter = page.getByTestId('quiz-counter');
    const input = page.getByLabel('Your answer');
    const primary = page.getByTestId('quiz-primary');
    const feedback = page.getByRole('region', { name: 'Feedback' });
    await expect(counter).toHaveText('Question 1 of 5');
    await expect(page.getByText('Numeric answer', { exact: true })).toBeVisible();

    // Not a number: blocked here, nothing sent.
    await input.fill('1/e');
    await primary.click();
    await expect(page.getByText('Enter a number, like 5/36')).toBeVisible();
    expect(answersSent(backend)).toEqual([]);
    // A decimal close enough to an irrational answer; the answer is shown with its math.
    await input.fill('0.368');
    await input.press('Enter');
    await expect(feedback).toContainText('Correct');
    await expect(page.getByTestId('correct-answer').locator('.katex')).toHaveCount(1);
    await expect(page.getByTestId('correct-answer')).not.toContainText('$');
    // Enter in the (now read-only) field moves on, as the button would.
    await input.press('Enter');
    await expect(counter).toHaveText('Question 2 of 5');

    // A correct fraction.
    await input.fill('5/36');
    await input.press('Enter');
    await expect(feedback).toContainText('Correct');
    await primary.click();

    // A single choice whose choices are formulas, chosen with the keyboard.
    await expect(page.getByRole('radio').first().locator('.katex')).toHaveCount(1);
    await page.keyboard.press('b');
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText('Correct');
    await primary.click();

    await input.fill('1/8');
    await input.press('Enter');
    await expect(feedback).toContainText('Correct');
    await primary.click();

    // A wrong value, with its unit.
    await input.fill('5');
    await input.press('Enter');
    await expect(feedback).toContainText('Incorrect');
    await expect(page.getByTestId('correct-answer')).toHaveText('6 rolls');
    expect(answersSent(backend).map((b) => (b as { response: unknown }).response)).toEqual([
      { type: 'numeric', value: '0.368' },
      { type: 'numeric', value: '5/36' },
      { type: 'single', choice: 'b' },
      { type: 'numeric', value: '1/8' },
      { type: 'numeric', value: '5' },
    ]);
    await expect(primary).toHaveText(/See results/);
    await primary.click();

    await expect(page.getByTestId('quiz-score')).toHaveText('80%');
    const review = page.getByRole('region', { name: 'Review' });
    // The missed question is expanded: what was typed and the answer, both with the unit.
    await expect(review).toContainText('5 rolls');
    await expect(review).toContainText('6 rolls');
    // Rows summarise prompts with their math typeset.
    await expect(review.locator('button[aria-expanded] .katex').first()).toBeVisible();
    await expect(review.locator('button[aria-expanded]').first()).not.toContainText('$');
  });
});

test.describe('math', () => {
  test('is typeset in prompts, explanations and the bank list, with no raw dollars', async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`${BANK}?question=prob-derangements`);
    const prompt = page.locator('#bank-q-prob-derangements');
    await expect(prompt.locator('.katex').first()).toBeVisible();
    await expect(prompt).not.toContainText('$');
    // Bold still works beside the math.
    await expect(prompt.locator('strong')).toHaveText('nobody');
    // The list beside the question: one line per prompt, math typeset there too.
    const rows = page.getByTestId('bank-list').getByRole('link');
    await expect(rows.first().locator('.katex').first()).toBeVisible();
    await expect(rows.first()).not.toContainText('$');

    await page.getByLabel('Your answer').fill('0.5');
    await page.getByLabel('Your answer').press('Enter');
    const feedback = page.getByRole('region', { name: 'Feedback' });
    await expect(feedback).toContainText('Incorrect');
    await expect(feedback.locator('.katex-display')).toHaveCount(1);
    await expect(feedback).not.toContainText('$');
    // KaTeX's fonts came from this origin.
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.fonts].some((f) => f.family === 'KaTeX_Main' && f.status === 'loaded'),
        ),
      )
      .toBe(true);
  });

  test('is typeset in an old discussion: the prompt, the follow-up and the grade', async ({
    page,
  }) => {
    // The web starts no new discussion; one begun before still opens and goes on.
    await setup(page, (b) => {
      b.attempts.set(
        QUIZ_ATTEMPT_ID,
        makeAttempt({
          mode: 'discussion',
          topics: [QUANT_TOPIC],
          questions: QUANT_QUESTIONS.filter((q) => q.type === 'short'),
        }),
      );
    });
    await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
    const thread = page.getByRole('list', { name: 'Conversation' });
    await expect(thread.locator('.katex').first()).toBeVisible();
    // The candidate's own words stay as typed, dollars and all.
    await page.getByLabel('Your reply').fill('It costs $5 and $10 to ask.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(thread).toContainText('It costs $5 and $10 to ask.');
    const followUp = thread.getByRole('listitem').nth(2);
    await expect(followUp).toContainText('if you only learn that the older child is a boy');
    await expect(followUp.locator('strong')).toHaveText('older');
    await expect(followUp.locator('.katex')).toHaveCount(1);
    expect(QUANT_FOLLOW_UP).toContain('$');
    await expect(followUp).not.toContainText('$');

    await page.getByLabel('Your reply').fill('Of BB, BG and GB, only one has two boys.');
    await page.getByRole('button', { name: 'Send' }).click();
    const feedback = page.getByRole('region', { name: 'Feedback' });
    await expect(feedback.locator('.katex').first()).toBeVisible();
    await expect(feedback).not.toContainText('$');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('display math scrolls inside the text, not the page', async ({ page }) => {
      await setup(page);
      await page.goto(`${BANK}?question=prob-derangements`);
      await page.getByLabel('Your answer').fill('0.368');
      await page.getByTestId('bank-primary').tap();
      const display = page.getByRole('region', { name: 'Feedback' }).locator('.katex-display');
      await expect(display).toBeVisible();
      // The equation is wider than the phone and scrolls in its own box.
      const { scroll, client } = await display.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(scroll).toBeGreaterThan(client);
      expect(client).toBeLessThanOrEqual(390);
      await noSideScroll(page);
      // And the input is a 16px field (no zoom on iOS), on the ordinary keyboard: a fraction needs /.
      const input = page.getByLabel('Your answer');
      expect(
        await input.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);
      expect(await input.getAttribute('inputmode')).toBeNull();
    });
  });

  test('stays off in a pad: dollars are text and KaTeX is not loaded', async ({ page }) => {
    const backend = await setup(page);
    // Every script and stylesheet a page loaded, searched for KaTeX.
    const katexLoaded = () =>
      page.evaluate(async () => {
        const css = [...document.styleSheets].some((s) => {
          try {
            return [...s.cssRules].some((r) => r.cssText.includes('KaTeX_Main'));
          } catch {
            return false;
          }
        });
        const scripts = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => n.includes('/_next/') && n.endsWith('.js'));
        const texts = await Promise.all(scripts.map((s) => fetch(s).then((r) => r.text())));
        return { css, js: texts.some((t) => t.includes('KaTeX parse error')) };
      });

    // A quiz page has it (so the check below can see it)...
    await page.goto(`${BANK}?question=prob-dice-sum`);
    await expect(page.locator('.katex').first()).toBeVisible();
    expect(await katexLoaded()).toEqual({ css: true, js: true });

    // ...and a pad, loaded fresh, has none of it.
    await page.goto(`/pads/${ACTIVE_PAD_ID}`);
    await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
    await expect.poll(() => backend.sockets.length).toBeGreaterThan(0);
    await backend.streamReply('That costs $5 and $10, so $x$ stays text here.', { chunkMs: 5 });
    await expect(page.getByText('That costs $5 and $10, so $x$ stays text here.')).toBeVisible();
    await expect(page.locator('.katex')).toHaveCount(0);
    expect(await katexLoaded()).toEqual({ css: false, js: false });
  });
});
