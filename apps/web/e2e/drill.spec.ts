/**
 * The mental math drill (/quant/drill): setup, a run against the clock, results, and recording
 * the run. Runs are deterministic with `?seed=`, and every answer is computed here from the same
 * generator the page uses (src/features/drill/logic.ts), never hard-coded.
 */
import {
  DRILL_CATEGORIES,
  type DrillCategory,
  type DrillConfig,
  RecordDrillRunRequest,
} from '@ipp/contracts';
import { expect, type Page, test } from '@playwright/test';
import {
  add,
  answerDisplay,
  DrillDeck,
  type DrillQuestion,
  decimalPlaces,
  decimalText,
  mul,
  rat,
  roundSig,
  toNumber,
} from '../src/features/drill/logic';
import { makeDrillRun } from './fixtures-drill';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

const ALL = [...DRILL_CATEGORIES];
const SETUP_KEY = 'ipp:drill-setup';

const field = (page: Page) => page.getByTestId('drill-answer');
const question = (page: Page) => page.getByTestId('drill-question');
const mark = (page: Page) => page.getByTestId('drill-mark');
const results = (page: Page) => page.getByTestId('drill-results');

const deckFor = (seed: number, c: Pick<DrillConfig, 'level' | 'categories'>) =>
  new DrillDeck(seed, c.level, c.categories);

/** An answer that is a number of the right kind, and wrong. */
function wrongAnswer(q: DrillQuestion): string {
  if (q.tolerance !== null) return decimalText(roundSig(mul(q.answer, rat(2)), 3));
  if (q.form === 'fraction' || decimalPlaces(q.answer) === null)
    return `${q.answer.num + 1n}/${q.answer.den}`;
  return decimalText(add(q.answer, rat(1)));
}

/** Remember a setup in this browser before the page loads (once, not on later reloads). */
async function remember(page: Page, config: DrillConfig) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem('drill-seeded')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('drill-seeded', '1');
      }
    },
    [SETUP_KEY, JSON.stringify(config)] as const,
  );
}

/** Open the drill with a seed and a remembered setup, press Start, wait out the countdown. */
async function begin(page: Page, seed: number, config: DrillConfig) {
  await remember(page, config);
  await page.goto(`/quant/drill?seed=${seed}`);
  await page.getByRole('button', { name: 'Start' }).click();
  const deck = deckFor(seed, config);
  await expect(question(page)).toHaveText(deck.at(0).text);
  return deck;
}

/** Type an answer and press Enter; wait for the next question. */
async function send(page: Page, text: string, next?: DrillQuestion) {
  await field(page).fill(text);
  await field(page).press('Enter');
  if (next) await expect(question(page)).toHaveText(next.text);
}

const posted = (b: MockBackend) =>
  b.requests.filter((r) => r.method === 'POST' && r.path === '/api/drill/runs').map((r) => r.body);

function counts(qs: { q: DrillQuestion; outcome: 'correct' | 'wrong' | 'skipped' }[]) {
  const by = new Map<DrillCategory, { correct: number; wrong: number; skipped: number }>();
  for (const { q, outcome } of qs) {
    const c = by.get(q.category) ?? { correct: 0, wrong: 0, skipped: 0 };
    c[outcome]++;
    by.set(q.category, c);
  }
  return DRILL_CATEGORIES.filter((c) => by.has(c)).map((category) => ({
    category,
    ...(by.get(category) ?? { correct: 0, wrong: 0, skipped: 0 }),
  }));
}

test('a short run, from setup to results, recorded exactly', async ({ page }) => {
  await page.clock.install();
  const backend = await setup(page, (b) => {
    b.drillRuns = [];
  });
  await page.goto('/quant/drill?seed=101');
  await expect(page.getByRole('heading', { level: 1, name: 'Mental math' })).toBeVisible();
  await expect(page).toHaveTitle(/^Mental math · interview\+\+/);
  // Defaults: 2 min, Standard, every category.
  await expect(page.getByRole('radio', { name: '2 min' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Standard' })).toBeChecked();
  for (const c of ALL) await expect(page.getByRole('checkbox', { name: labelOf(c) })).toBeChecked();
  await page.getByRole('radio', { name: '1 min' }).click();

  const config: DrillConfig = { durationSec: 60, level: 'standard', categories: ALL };
  const deck = deckFor(101, config);
  await page.getByRole('button', { name: 'Start' }).click();
  // The countdown, with the field already focused.
  await expect(question(page)).toHaveText('3');
  await expect(page.getByTestId('drill-ask')).toHaveText('Get ready');
  await expect(field(page)).toBeFocused();
  await expect(page.getByRole('timer', { name: 'Time left' })).toHaveText('1:00');
  await page.clock.fastForward(3000);
  await expect(question(page)).toHaveText(deck.at(0).text);

  const [q0, q1, q2, q3, q4, q5] = [0, 1, 2, 3, 4, 5].map((i) => deck.at(i)) as [
    DrillQuestion,
    DrillQuestion,
    DrillQuestion,
    DrillQuestion,
    DrillQuestion,
    DrillQuestion,
  ];
  await send(page, q0.answerText, q1);
  await expect(mark(page)).toHaveText('Right');
  await expect(page.getByTestId('drill-score')).toHaveText('1');
  await send(page, wrongAnswer(q1), q2);
  await expect(mark(page)).toContainText('Wrong');
  await expect(mark(page)).toContainText(answerDisplay(q1));
  await expect(page.getByTestId('drill-score')).toHaveText('0');
  // Skip: the button, then the keyboard shortcut. Neither takes focus from the field.
  await page.getByRole('button', { name: /^Skip/ }).click();
  await expect(question(page)).toHaveText(q3.text);
  await expect(field(page)).toBeFocused();
  await expect(mark(page)).toContainText('Skipped');
  await field(page).fill('12');
  await field(page).press('Shift+Enter');
  await expect(question(page)).toHaveText(q4.text);
  await expect(field(page)).toHaveValue('');
  await send(page, q4.answerText, q5);
  await expect(page.getByTestId('drill-score')).toHaveText('1');
  // The clock runs out mid-question: what is typed is not counted.
  await field(page).fill(q5.answerText);
  await page.clock.fastForward(60_000);
  await expect(results(page)).toBeVisible();

  await expect(page.getByTestId('drill-result-score')).toHaveText('1');
  await expect(page.getByTestId('drill-correct')).toHaveText('2');
  await expect(page.getByTestId('drill-wrong')).toHaveText('1');
  await expect(page.getByTestId('drill-skipped')).toHaveText('2');
  await expect(page.getByTestId('drill-accuracy')).toHaveText('67%');
  await expect(page.getByTestId('drill-pace')).toHaveText('3.0');
  await expect(page.getByText('Ran the full 1:00.')).toBeVisible();
  await expect(page.getByText('Saved to your history.')).toBeVisible();
  // The review: the wrong answer and the two skipped, with the right answers.
  const review = page.getByTestId('drill-review').getByRole('listitem');
  await expect(review).toHaveCount(3);
  await expect(review.nth(0)).toContainText(q1.text);
  await expect(review.nth(0)).toContainText(wrongAnswer(q1));
  await expect(review.nth(0)).toContainText(answerDisplay(q1));
  await expect(review.nth(1)).toContainText('Skipped');
  await expect(review.nth(2)).toContainText(answerDisplay(q3));

  const expected = {
    config,
    byCategory: counts([
      { q: q0, outcome: 'correct' },
      { q: q1, outcome: 'wrong' },
      { q: q2, outcome: 'skipped' },
      { q: q3, outcome: 'skipped' },
      { q: q4, outcome: 'correct' },
    ]),
    elapsedMs: 60_000,
  };
  expect(posted(backend)).toEqual([expected]);
  expect(RecordDrillRunRequest.safeParse(expected).success).toBe(true);
  // The breakdown lists the categories that came up, in setup order.
  await expect(page.getByTestId('drill-categories').locator('tbody tr')).toHaveCount(
    expected.byCategory.length,
  );
});

test('text that is not a number is not sent', async ({ page }) => {
  const backend = await setup(page);
  const config: DrillConfig = { durationSec: 60, level: 'warmup', categories: ['multiply'] };
  const deck = await begin(page, 7, config);
  for (const text of ['abc', '4 4', '1/0']) {
    await field(page).fill(text);
    await field(page).press('Enter');
    await expect(mark(page)).toHaveText('Not a number');
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page)).toHaveValue(text);
    await expect(field(page)).toBeFocused();
    await expect(question(page)).toHaveText(deck.at(0).text);
  }
  // Typing clears the note; an empty Enter does nothing.
  await field(page).fill('');
  await expect(mark(page)).toHaveText('');
  await field(page).press('Enter');
  await expect(question(page)).toHaveText(deck.at(0).text);
  await send(page, deck.at(0).answerText, deck.at(1));
  await expect(page.getByTestId('drill-score')).toHaveText('1');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(results(page)).toBeVisible();
  const body = posted(backend)[0] as { byCategory: unknown };
  expect(body.byCategory).toEqual([{ category: 'multiply', correct: 1, wrong: 0, skipped: 0 }]);
});

test('fractions in any exact form, and conversions in the form asked for', async ({ page }) => {
  const config: DrillConfig = { durationSec: 300, level: 'standard', categories: ['fractions'] };
  await setup(page);
  const deck = await begin(page, 3, config);
  let i = 0;
  let unreduced = false;
  let decimal = false;
  let conversion = false;
  for (; i < 30 && !(unreduced && decimal && conversion); i++) {
    const q = deck.at(i);
    const next = deck.at(i + 1);
    const { num, den } = q.answer;
    if (q.kind === 'dec-to-frac' && !conversion) {
      // A decimal is not what was asked: said so, not marked.
      await field(page).fill(decimalText(q.answer));
      await field(page).press('Enter');
      await expect(mark(page)).toHaveText('As a fraction, like 3/8');
      await expect(question(page)).toHaveText(q.text);
      await send(page, `${num * 3n}/${den * 3n}`, next);
      conversion = true;
    } else if (q.form === 'any' && !unreduced) {
      await send(page, `${num * 2n}/${den * 2n}`, next);
      unreduced = true;
    } else if (q.form === 'any' && den > 1n && decimalPlaces(q.answer) !== null && !decimal) {
      await send(page, decimalText(q.answer), next);
      decimal = true;
    } else {
      await send(page, q.answerText, next);
    }
    await expect(mark(page)).toHaveText('Right');
  }
  expect([unreduced, decimal, conversion]).toEqual([true, true, true]);
  await expect(page.getByTestId('drill-score')).toHaveText(String(i));
});

test('a percentage answer with or without the % sign', async ({ page }) => {
  const config: DrillConfig = { durationSec: 300, level: 'standard', categories: ['percentages'] };
  await setup(page);
  const deck = await begin(page, 21, config);
  let withSign = 0;
  let without = 0;
  for (let i = 0; i < 25 && (withSign === 0 || without === 0); i++) {
    const q = deck.at(i);
    // The field shows a % after it for a percentage answer, and nothing for a number.
    await expect(page.getByTestId('drill-ask')).toHaveText(q.ask ?? '');
    if (q.form === 'percent') {
      const figure = decimalText(q.answer);
      if (withSign <= without) {
        await send(page, `${figure}%`, deck.at(i + 1));
        withSign++;
      } else {
        await send(page, figure, deck.at(i + 1));
        without++;
      }
    } else {
      // A number answer refuses a % sign rather than reading it as a hundredth.
      await field(page).fill(`${q.answerText}%`);
      await field(page).press('Enter');
      await expect(mark(page)).toHaveText('A number, not a percentage');
      await send(page, q.answerText, deck.at(i + 1));
    }
    await expect(mark(page)).toHaveText('Right');
  }
  expect(withSign).toBeGreaterThan(0);
  expect(without).toBeGreaterThan(0);
});

test('an estimate within the tolerance is right, outside it wrong', async ({ page }) => {
  const config: DrillConfig = { durationSec: 60, level: 'standard', categories: ['estimation'] };
  await setup(page);
  const deck = await begin(page, 5, config);
  const q0 = deck.at(0);
  await expect(page.getByTestId('drill-ask')).toHaveText('≈Estimate, within 5%');
  // 4% over: right.
  await send(page, (toNumber(q0.answer) * 1.04).toFixed(2), deck.at(1));
  await expect(mark(page)).toHaveText('Right');
  // 7% under: wrong, with the estimate shown.
  await send(page, (toNumber(deck.at(1).answer) * 0.93).toFixed(2), deck.at(2));
  await expect(mark(page)).toContainText('Wrong');
  await expect(mark(page)).toContainText(answerDisplay(deck.at(1)));
  await expect(page.getByTestId('drill-score')).toHaveText('0');
});

test('stopping early ends the run and records it', async ({ page }) => {
  const backend = await setup(page);
  const config: DrillConfig = { durationSec: 120, level: 'warmup', categories: ALL };
  const deck = await begin(page, 42, config);
  await send(page, deck.at(0).answerText, deck.at(1));
  await send(page, deck.at(1).answerText, deck.at(2));
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(results(page)).toBeVisible();
  await expect(page.getByTestId('drill-result-score')).toHaveText('2');
  await expect(page.getByText(/Stopped after 0:0\d\./)).toBeVisible();
  await expect(page.getByText('Nothing to review: every answer was right.')).toBeVisible();
  const [body] = posted(backend) as { elapsedMs: number; config: DrillConfig }[];
  expect(body?.config).toEqual(config);
  expect(body?.elapsedMs).toBeGreaterThan(0);
  expect(body?.elapsedMs).toBeLessThan(30_000);

  // Stop during the countdown: back to the setup, nothing recorded.
  await page.getByRole('button', { name: 'Change setup' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(question(page)).toHaveText(/^[123]$/);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  expect(posted(backend)).toHaveLength(1);
});

test('a run that fails to save still shows its results, and can be retried', async ({ page }) => {
  const backend = await setup(page, (b) => {
    b.fail(/^POST \/api\/drill\/runs$/, 503, {
      error: { code: 'unavailable', message: 'The service is busy. Try again shortly.' },
    });
  });
  const config: DrillConfig = { durationSec: 60, level: 'hard', categories: ['multiply'] };
  const deck = await begin(page, 9, config);
  await send(page, deck.at(0).answerText, deck.at(1));
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('drill-result-score')).toHaveText('1');
  const alert = page.getByRole('alert').filter({ hasText: 'not saved' });
  await expect(alert).toContainText('This run was not saved: The service is busy.');
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Saved to your history.')).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(posted(backend)).toHaveLength(2);
  expect(posted(backend)[1]).toEqual(posted(backend)[0]);
  expect(backend.drillRuns[0]?.score).toBe(1);
});

test('a new best is marked, and Play again starts the next seed', async ({ page }) => {
  const backend = await setup(page, (b) => {
    // One earlier best of 1 at 1 min · Warm-up.
    b.drillRuns = [
      makeDrillRun(
        { durationSec: 60, level: 'warmup', categories: ALL },
        [{ category: 'multiply', correct: 1, wrong: 0, skipped: 0 }],
        new Date(Date.now() - 86_400_000).toISOString(),
      ),
    ];
  });
  const config: DrillConfig = { durationSec: 60, level: 'warmup', categories: ALL };
  await remember(page, config);
  await page.goto('/quant/drill?seed=500');
  await expect(page.getByTestId('drill-best-score')).toHaveText('1');
  await page.getByRole('button', { name: 'Start' }).click();
  const deck = deckFor(500, config);
  await expect(question(page)).toHaveText(deck.at(0).text);
  await send(page, deck.at(0).answerText, deck.at(1));
  await send(page, deck.at(1).answerText, deck.at(2));
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('drill-new-best')).toHaveText('New best');

  // Play again: same setup, the next seed (500 + 1); this one does not beat 2.
  await expect(page.getByRole('button', { name: 'Play again' })).toBeFocused();
  await page.keyboard.press('Enter');
  const next = deckFor(501, config);
  await expect(question(page)).toHaveText(next.at(0).text);
  await expect(field(page)).toBeFocused();
  await send(page, next.at(0).answerText, next.at(1));
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Saved to your history. Your best here is 2.')).toBeVisible();
  await expect(page.getByTestId('drill-new-best')).toHaveCount(0);
  expect(backend.drillRuns.map((r) => r.score)).toEqual([1, 2, 1]);
});

test('a run on some categories sets no best, and says so', async ({ page }) => {
  await setup(page, (b) => {
    b.drillRuns = [];
  });
  await page.goto('/quant/drill?seed=8');
  await expect(page.getByTestId('drill-mix-note')).toHaveText(
    'Every category is on, so this run can set a best.',
  );
  await page.getByRole('checkbox', { name: 'Estimation' }).click();
  await expect(page.getByTestId('drill-mix-note')).toContainText('only a run on all of them');
  // The last category on cannot be turned off.
  for (const c of ALL.slice(1, -1)) await page.getByRole('checkbox', { name: labelOf(c) }).click();
  await page
    .getByRole('checkbox', { name: labelOf(ALL[0] ?? 'add-subtract') })
    .click({ force: true });
  await expect(
    page.getByRole('checkbox', { name: labelOf(ALL[0] ?? 'add-subtract') }),
  ).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: labelOf(ALL[0] ?? 'add-subtract') }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Select all' }).click();
  for (const c of ALL) await expect(page.getByRole('checkbox', { name: labelOf(c) })).toBeChecked();
});

test('history and bests, and an empty state on a first visit', async ({ page }) => {
  await setup(page);
  await page.goto('/quant/drill');
  const runs = page.getByTestId('drill-runs').getByRole('listitem');
  await expect(runs).toHaveCount(4);
  await expect(runs.nth(0)).toContainText('2 min · Standard · All categories');
  await expect(runs.nth(0)).toContainText('27');
  await expect(runs.nth(0)).toContainText('91% accuracy');
  await expect(runs.nth(1)).toContainText('1 min · Hard · 2 categories');
  await expect(page.getByText('4 runs')).toBeVisible();
  // Bests: the higher of the two 2 min · Standard runs; the partial run sets none.
  const bests = page.getByTestId('drill-bests');
  await expect(bests.getByRole('row', { name: /^2 min/ })).toContainText('31');
  await expect(bests.getByRole('row', { name: /^1 min/ })).toHaveText(/1 min\s*18\s*—\s*—/);
  await expect(page.getByTestId('drill-best-score')).toHaveText('31');
  await page.getByRole('radio', { name: 'Hard' }).click();
  await expect(page.getByTestId('drill-best')).toContainText('No best yet at 2 min · Hard.');

  const first = await page.context().newPage();
  await setup(first, (b) => {
    b.drillRuns = [];
  });
  await first.goto('/quant/drill');
  await expect(first.getByText('No runs yet')).toBeVisible();
  await expect(first.getByTestId('drill-best')).toContainText('No best yet at');
});

test('the setup is remembered after a reload', async ({ page }) => {
  await setup(page);
  await page.goto('/quant/drill');
  await page.getByRole('radio', { name: '5 min' }).click();
  await page.getByRole('radio', { name: 'Warm-up' }).click();
  await page.getByRole('checkbox', { name: 'Fractions' }).click();
  await page.getByRole('checkbox', { name: 'Percentages' }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: '5 min' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Warm-up' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Fractions' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Percentages' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Multiplication' })).toBeChecked();
  // Something unreadable in storage is the default setup, not an error.
  await page.evaluate((key) => localStorage.setItem(key, '{"durationSec":7'), SETUP_KEY);
  await page.reload();
  await expect(page.getByRole('radio', { name: '2 min' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Standard' })).toBeChecked();
});

test.describe('on the Quant page', () => {
  test('a card on both paths leads to the drill, with the best when there is one', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/quant');
    const card = page.getByTestId('drill-card');
    await expect(card.getByRole('heading', { name: 'Mental math drill' })).toBeVisible();
    // The default setup (2 min · Standard) has a best of 31 in the fixtures.
    await expect(card.getByTestId('drill-card-best')).toHaveText(
      'Your best at 2 min · Standard: 31',
    );
    await page.getByRole('tab', { name: 'Researcher' }).click();
    await expect(card).toBeVisible();
    await card.getByRole('link', { name: 'Start a drill' }).click();
    await expect(page).toHaveURL(/\/quant\/drill$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mental math' })).toBeVisible();
    // Not in the main navigation; Quant stays marked.
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText(['Interviews', 'Quant', 'Quizzes']);
    await expect(nav.getByRole('link', { name: 'Quant' })).toHaveAttribute('aria-current', 'page');
  });

  test('without a best, the card leaves it out', async ({ page }) => {
    await setup(page, (b) => {
      b.drillRuns = [];
    });
    await page.goto('/quant');
    const card = page.getByTestId('drill-card');
    await expect(card.getByRole('link', { name: 'Start a drill' })).toBeVisible();
    await expect(card.getByTestId('drill-card-best')).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const noSideScroll = (page: Page) =>
    expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);

  test('the run keeps the field focused, with the keyboard each answer needs, in the top half', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/quant/drill?seed=77');
    await noSideScroll(page);
    const config: DrillConfig = { durationSec: 120, level: 'standard', categories: ALL };
    const deck = deckFor(77, config);
    await page.getByRole('button', { name: 'Start' }).tap();
    await expect(question(page)).toHaveText(deck.at(0).text);
    let sawText = false;
    let sawDecimal = false;
    for (let i = 0; i < 14; i++) {
      const q = deck.at(i);
      await expect(question(page)).toHaveText(q.text);
      await expect(field(page)).toHaveAttribute('inputmode', q.inputMode);
      if (q.inputMode === 'text') sawText = true;
      else sawDecimal = true;
      await expect(field(page)).toBeFocused();
      if (i === 0) {
        // Everything needed while answering sits above where the keyboard comes up.
        for (const el of [
          question(page),
          field(page),
          page.getByRole('timer'),
          page.getByTestId('drill-score'),
        ]) {
          const box = await el.boundingBox();
          expect(box && box.y + box.height).toBeLessThan(844 / 2);
        }
        await noSideScroll(page);
        // A tap on the page does not take focus from the field.
        await question(page).tap();
        await expect(field(page)).toBeFocused();
      }
      await send(page, i % 3 === 2 ? wrongAnswer(q) : q.answerText, deck.at(i + 1));
    }
    expect([sawText, sawDecimal]).toEqual([true, true]);
    await page.getByRole('button', { name: 'Stop' }).tap();
    await expect(results(page)).toBeVisible();
    await noSideScroll(page);
  });
});

function labelOf(c: DrillCategory) {
  return {
    'add-subtract': 'Addition & subtraction',
    multiply: 'Multiplication',
    divide: 'Division',
    fractions: 'Fractions',
    percentages: 'Percentages',
    estimation: 'Estimation',
  }[c];
}
