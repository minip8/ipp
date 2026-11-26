/**
 * A market-making game in the live quant round (ARCHITECTURE §8.3): the game panel (hidden dice,
 * the quote form and its checks, the live market, the books and the blotter, the settlement), the
 * quote route's refusals, the setup option, the phone layout, voice, and the game's review in the
 * report. The mock (mock-quant-round.ts) plays the game through the contract's own
 * `advanceRound`, with a scripted interviewer that trades against each quote.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import { ACTIVE_PAD_ID, uuid } from './fixtures';
import {
  GAME_LINES,
  LINES,
  QUANT_GAME_ENDED_PAD_ID,
  QUANT_GAME_PAD_ID,
  QUANT_PAD_ID,
  VERDICTS,
} from './fixtures-quant-round';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

const heading = (page: Page) => page.getByTestId('round-heading');
const panel = (page: Page) => page.getByTestId('game-panel');
const field = (scope: Locator | Page, name: 'Bid' | 'Offer' | 'Size') =>
  scope.getByLabel(name, { exact: true });
const status = (page: Page) => page.getByTestId('quote-status');
const chat = (page: Page) => page.getByRole('region', { name: 'Interviewer chat' });
const quotes = (b: MockBackend) =>
  b.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/round/quote'));

async function openGame(
  page: Page,
  configure?: (b: MockBackend) => void,
  id = QUANT_GAME_PAD_ID,
): Promise<MockBackend> {
  const b = await setup(page, configure);
  await page.goto(`/pads/${id}`);
  await expect(page.getByTestId('quant-workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible();
  return b;
}

/** Types a market into the panel and posts it with Enter. */
async function quote(scope: Locator | Page, bid: string, ask: string, size: string) {
  await field(scope, 'Bid').fill(bid);
  await field(scope, 'Offer').fill(ask);
  await field(scope, 'Size').fill(size);
  await field(scope, 'Size').press('Enter');
}

test.describe('the game panel', () => {
  test('shows the hidden dice and the rules, and nothing of the fair value', async ({ page }) => {
    const b = await openGame(page);
    await expect(heading(page)).toHaveText('Question 2 of 4');
    const p = panel(page);
    await expect(p.getByRole('heading', { name: 'Sum of three dice' })).toBeVisible();
    await expect(p.getByTestId('game-component')).toHaveCount(3);
    await expect(p.locator('[data-testid="game-component"][data-shown]')).toHaveCount(0);
    await expect(p.getByRole('list', { name: 'The hidden values' })).toContainText(
      'Die 1: not shown yet',
    );
    await expect(p.getByTestId('game-payoff')).toHaveText(
      'Settles at the sum of Die 1, Die 2 and Die 3',
    );
    await expect(p).toContainText('Steps of 0.5 · up to 5 lots');
    await expect(status(page)).toHaveAttribute('data-state', 'none');
    await expect(p.getByTestId('game-position')).toHaveText('Flat');
    await expect(p.getByTestId('game-cash')).toHaveText('0');
    // The game is the question: its prompt, typeset, above the panel.
    await expect(page.getByTestId('question-prompt').locator('.katex')).toHaveCount(1);
    // Nothing on the page, and nothing the browser is sent, names the fair value or a hidden die.
    await expect(page.getByTestId('question-panel')).not.toContainText('10.5');
    const sent = await page.evaluate(
      async (id) => (await fetch(`/api/pads/${id}`)).text(),
      QUANT_GAME_PAD_ID,
    );
    expect(sent).not.toMatch(/"fair"|"values"|"sd"|"markTo/);
    expect(quotes(b)).toEqual([]);
  });

  test('checks a market as it is typed, in words beside each field', async ({ page }) => {
    const b = await openGame(page, (x) => {
      x.quant.gameReply = 'off';
    });
    const p = panel(page);
    await field(p, 'Bid').fill('9.3');
    await expect(p.getByTestId('quote-bid-error')).toHaveText('Use steps of 0.5');
    await expect(field(p, 'Bid')).toHaveAttribute('aria-invalid', 'true');
    await field(p, 'Bid').fill('9.5');
    await expect(p.getByTestId('quote-bid-error')).toHaveCount(0);
    await field(p, 'Offer').fill('9');
    await expect(p.getByTestId('quote-ask-error')).toHaveText('Must be above the bid');
    await field(p, 'Offer').fill('abc');
    await expect(p.getByTestId('quote-ask-error')).toHaveText('Not a number');
    await field(p, 'Offer').fill('11.5');
    await field(p, 'Size').fill('7');
    await expect(p.getByTestId('quote-size-error')).toHaveText('Whole number, 1 to 5');
    await field(p, 'Size').fill('');
    // Submitting with a field empty says what is missing, and posts nothing.
    await field(p, 'Offer').press('Enter');
    await expect(p.getByTestId('quote-size-error')).toHaveText('Enter a size');
    await expect(field(p, 'Size')).toBeFocused();
    expect(quotes(b)).toEqual([]);

    // Arrow keys step by the tick (Shift: five), Alt moves the whole market.
    await field(p, 'Size').fill('2');
    await field(p, 'Bid').press('ArrowUp');
    await expect(field(p, 'Bid')).toHaveValue('10');
    await field(p, 'Bid').press('Shift+ArrowDown');
    await expect(field(p, 'Bid')).toHaveValue('7.5');
    await field(p, 'Bid').fill('9.5');
    await field(p, 'Offer').press('Alt+ArrowUp');
    await expect(field(p, 'Bid')).toHaveValue('10');
    await expect(field(p, 'Offer')).toHaveValue('12');
    await p.getByRole('button', { name: 'Move the market down a tick' }).click();
    await expect(field(p, 'Bid')).toHaveValue('9.5');
    await expect(field(p, 'Offer')).toHaveValue('11.5');
    await field(p, 'Size').press('ArrowUp');
    await expect(field(p, 'Size')).toHaveValue('3');
    await field(p, 'Size').press('ArrowDown');

    // Enter posts it; the server posts it to the chat as the candidate's message, once.
    await field(p, 'Size').press('Enter');
    await expect(status(page)).toHaveAttribute('data-state', 'working');
    await expect(status(page)).toContainText('Live · 9.5 – 11.5 for 2 lots');
    expect(quotes(b).map((r) => r.body)).toEqual([{ index: 1, bid: 9.5, ask: 11.5, size: 2 }]);
    await expect(chat(page).getByText('9.5 bid, 11.5 offered, 2 lots')).toHaveCount(1);
    await page.waitForTimeout(300);
    await expect(chat(page).getByText('9.5 bid, 11.5 offered, 2 lots')).toHaveCount(1);
    // The numbers stay, ready to be moved and posted again.
    await expect(field(p, 'Bid')).toHaveValue('9.5');
    await expect(field(p, 'Size')).toHaveValue('2');
  });

  test('a trade consumes the market and moves the books; every second trade shows a die', async ({
    page,
  }) => {
    await openGame(page);
    const p = panel(page);
    await quote(p, '9.5', '11.5', '2');
    // Fair is inside, so the interviewer buys one lot at the offer: the candidate sold.
    await expect(status(page)).toHaveAttribute('data-state', 'traded');
    await expect(status(page)).toContainText('Traded · Sold 1 at 11.5. Make a new market.');
    await expect(chat(page).getByTestId('interviewer-message').last()).toContainText(
      'I buy 1 at 11.5.',
    );
    await expect(p.getByTestId('game-position')).toHaveText('Short 1');
    await expect(p.getByTestId('game-cash')).toHaveText('+11.5');
    await expect(p.getByTestId('blotter-trade')).toHaveText(['Sold 1 at 11.5short 1']);
    await expect(p.getByTestId('game-announcement')).toHaveText('You sold 1 at 11.5.');
    // Quoting again: the last market is the starting point; move it up a tick and post.
    await expect(field(p, 'Bid')).toHaveValue('9.5');
    await p.getByRole('button', { name: 'Move the market up a tick' }).click();
    await field(p, 'Bid').press('Enter');
    // The second trade comes with the first die.
    await expect(status(page)).toContainText('Sold 1 at 12. Then Die 1 shown: 6.');
    await expect(p.getByTestId('game-position')).toHaveText('Short 2');
    await expect(p.getByTestId('game-cash')).toHaveText('+23.5');
    const die1 = p.getByTestId('game-component').first();
    await expect(die1).toHaveAttribute('data-shown', 'true');
    await expect(die1).toHaveAttribute('data-fresh', 'true');
    await expect(die1).toContainText('Die 1: 6 (just shown)');
    await expect(p.locator('[data-testid="game-component"][data-shown]')).toHaveCount(1);
    await expect(p.getByTestId('game-blotter').getByRole('listitem')).toHaveText([
      'Die 1 shown: 6',
      'Sold 1 at 12short 2',
      'Sold 1 at 11.5short 1',
    ]);
    await expect(p.getByTestId('game-announcement')).toContainText('Die 1 shown: 6');
    // The mark fades; the value stays.
    await expect(die1).not.toHaveAttribute('data-fresh', 'true', { timeout: 6000 });
    await expect(die1).toHaveAttribute('data-shown', 'true');
  });

  test('a die shown withdraws the live market', async ({ page }) => {
    const b = await openGame(page);
    const p = panel(page);
    // Too wide: sent back to be tightened, and still live.
    await quote(p, '8', '13', '1');
    await expect(chat(page).getByTestId('interviewer-message').last()).toContainText(
      GAME_LINES.tighten,
    );
    await expect(status(page)).toHaveAttribute('data-state', 'working');
    await page.getByLabel('Message', { exact: true }).fill('reveal a die, please');
    await page.getByLabel('Message', { exact: true }).press('Enter');
    await expect(status(page)).toHaveAttribute('data-state', 'withdrawn');
    await expect(status(page)).toContainText('Die 1 shown: 6, so your market was pulled.');
    await expect(p.getByTestId('game-position')).toHaveText('Flat');
    await expect(field(p, 'Bid')).toHaveValue('8');
    await expect(p.getByTestId('blotter-reveal')).toHaveText(['Die 1 shown: 6']);
    expect(b.quant.log.filter((l) => !l.ok)).toEqual([]);
  });

  test('says each refusal plainly, where the candidate is looking', async ({ page }) => {
    const b = await openGame(page, (x) => {
      x.quant.gameReply = 'off';
    });
    const p = panel(page);
    const error = p.getByTestId('quote-error');
    const cases: [number, string, string][] = [
      [
        409,
        'bad_quote',
        'That market was refused: the bid must be below the offer, both in steps of 0.5, for 1 to 5 lots.',
      ],
      [409, 'quote_limit', 'You have used every quote this game allows.'],
      [409, 'not_game', 'This question is not a market-making game.'],
      [409, 'ended', 'The round has finished, so markets can no longer be posted.'],
      [409, 'pad_ended', 'This interview has ended, so markets can no longer be posted.'],
      [429, 'rate_limited', 'Too many markets at once. You can quote again in 20s.'],
    ];
    await quote(p, '9.5', '11.5', '1');
    await expect(status(page)).toHaveAttribute('data-state', 'working');
    for (const [code, name, text] of cases) {
      b.fail(/POST \/api\/pads\/[^/]+\/round\/quote/, code, {
        error: { code: name, message: name, retryAfter: 20 },
      });
      await field(p, 'Bid').press('Enter');
      await expect(error).toHaveText(text);
      await expect(error).toHaveAttribute('role', 'alert');
    }
    // Typing again clears it.
    await field(p, 'Bid').fill('9');
    await expect(error).toHaveCount(0);

    // The question closed a moment before the market arrived (the browser has not heard yet).
    b.quant.muted = true;
    await b.quant.close(QUANT_GAME_PAD_ID);
    await field(p, 'Bid').press('Enter');
    await expect(error).toHaveText('That question has just closed, so the market was not posted.');
    expect(b.quant.log.at(-1)).toMatchObject({ ok: false, reason: 'wrong_index' });
  });

  test('the question closing settles the game and keeps the settlement in view', async ({
    page,
  }) => {
    const b = await openGame(page);
    const p = panel(page);
    await quote(p, '9.5', '11.5', '2');
    await expect(p.getByTestId('game-position')).toHaveText('Short 1');
    await b.quant.close(QUANT_GAME_PAD_ID, VERDICTS.good, 'Die 2 is a 2 and Die 3 a 5: 13.');
    await expect(heading(page)).toHaveText('Question 3 of 4');
    await expect(panel(page)).toHaveCount(0);
    const settled = page.getByTestId('settled-game');
    await expect(settled.getByRole('heading')).toHaveText('Sum of three dice settled');
    await expect(settled.locator('[data-testid="game-component"][data-shown]')).toHaveCount(3);
    await expect(settled.getByTestId('settlement-value')).toHaveText('13');
    // Short 1 at 11.5, settled at 13.
    await expect(settled.getByTestId('settlement-pnl')).toHaveText('−1.5');
    await expect(settled).toContainText('Cash +11.5, short 1 at 13: −13');
    // In the earlier questions too, read only.
    const earlier = page.getByTestId('earlier-questions');
    await earlier.getByText('Question 2').click();
    await expect(earlier.getByTestId('game-summary')).toContainText(
      'Settled at 13 · P&L −1.5 · 1 trade',
    );
    await expect(page.getByTestId('quote-form')).toHaveCount(0);
  });

  test('collaborators see the same panel and may quote', async ({ page }) => {
    const b = await openGame(page, (x) => {
      const d = x.pads.get(QUANT_GAME_PAD_ID);
      if (d) d.role = 'collaborator';
    });
    await quote(panel(page), '10', '11', '1');
    await expect(status(page)).toHaveAttribute('data-state', 'traded');
    expect(quotes(b)).toHaveLength(1);
  });

  test('warns only when few quotes are left', async ({ page }) => {
    const b = await openGame(page, (x) => {
      x.quant.gameReply = 'off';
    });
    await quote(panel(page), '10', '11', '1');
    await expect(status(page)).toHaveAttribute('data-state', 'working');
    await expect(page.getByTestId('quotes-left')).toHaveCount(0);
    // 89 more markets, straight to the route: 10 left.
    const left = await page.evaluate(async (id) => {
      let last = 0;
      for (let i = 0; i < 89; i++) {
        const r = await fetch(`/api/pads/${id}/round/quote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ index: 1, bid: 10, ask: 11, size: 1 }),
        });
        last = (await r.json()).questions[1].game.quotesLeft;
      }
      return last;
    }, QUANT_GAME_PAD_ID);
    expect(left).toBe(10);
    await expect(page.getByTestId('quotes-left')).toHaveText('10 quotes left for this game');
    expect(b.quant.log.filter((l) => !l.ok)).toEqual([]);
  });

  test('a round without a game looks as before', async ({ page }) => {
    const b = await openGame(page, undefined, QUANT_PAD_ID);
    await expect(heading(page)).toHaveText('Question 1 of 4');
    await expect(page.getByTestId('game-panel')).toHaveCount(0);
    await b.quant.close(QUANT_PAD_ID);
    await expect(heading(page)).toHaveText('Question 2 of 4');
    await expect(page.getByTestId('question-prompt')).toContainText('two ropes');
    await expect(page.getByTestId('game-panel')).toHaveCount(0);
    await expect(page.getByTestId('settled-game')).toHaveCount(0);
    await expect(page.getByTestId('game-summary')).toHaveCount(0);
    expect(quotes(b)).toEqual([]);
  });

  test('a coding pad has no quote route', async ({ page }) => {
    await setup(page);
    await page.goto('/dashboard');
    const res = await page.evaluate(async (id) => {
      const r = await fetch(`/api/pads/${id}/round/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ index: 0, bid: 1, ask: 2, size: 1 }),
      });
      return { status: r.status, body: await r.json() };
    }, ACTIVE_PAD_ID);
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'wrong_format' } } });
  });
});

test.describe('the game on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the strip above the chat follows the market; the question pane quotes', async ({
    page,
  }) => {
    const b = await openGame(page);
    const tabs = page.getByRole('tablist', { name: 'Pad sections' });
    const strip = page.getByTestId('question-strip');
    await expect(strip.getByTestId('game-strip')).toContainText('No market yet · Flat · cash 0');
    await strip.tap();
    await expect(tabs.getByRole('tab', { name: 'Question' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const p = panel(page);
    await p.scrollIntoViewIfNeeded();
    for (const name of ['Bid', 'Offer', 'Size'] as const) {
      const box = await field(p, name).boundingBox();
      expect(box && box.height >= 40).toBe(true);
    }
    await quote(p, '9.5', '11.5', '1');
    await expect(status(page)).toHaveAttribute('data-state', 'traded');
    await tabs.getByRole('tab', { name: 'Chat' }).tap();
    await expect(strip.getByTestId('game-strip')).toContainText(
      'Traded: quote again · Short 1 · cash +11.5',
    );
    // A die shown while on the chat marks the question tab.
    await b.quant.gameMove(QUANT_GAME_PAD_ID, { reveal: true }, 'Now Die 1: it is a 6.');
    await expect(page.getByTestId('question-unread')).toBeVisible();
    await expect(strip.getByTestId('game-strip')).toContainText('6');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });
});

test('voice reads the interviewer’s trade once and never the candidate’s quote', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__spoken = [];
    w.SpeechRecognition = class {
      continuous = false;
      interimResults = true;
      lang = 'en';
      onresult = null;
      onend = null;
      onerror = null;
      onstart = null;
      onspeechstart = null;
      start() {}
      stop() {}
      abort() {}
    };
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        speaking: false,
        getVoices: () => [],
        cancel() {},
        speak(u: { text: string; onstart?: () => void; onend?: () => void }) {
          (w.__spoken as string[]).push(u.text);
          u.onstart?.();
          setTimeout(() => u.onend?.(), 20);
        },
      },
    });
  });
  const id = uuid(1305);
  const b = await openGame(
    page,
    (x) => {
      x.quant.seed({
        id,
        path: 'trader',
        durationMin: 30,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        voice: true,
        game: true,
        script: [
          { at: 2, step: { type: 'start', version: 0, say: LINES.greeting } },
          {
            at: 30,
            step: {
              type: 'close',
              version: 0,
              index: 0,
              kind: 'chat',
              say: LINES.close,
              by: 'interviewer',
              verdict: VERDICTS.good,
            },
          },
        ],
      });
    },
    id,
  );
  await expect(page.getByTestId('voice-bar')).toBeVisible();
  await expect(heading(page)).toHaveText('Question 2 of 4');
  const spoken = () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  await quote(panel(page), '9.5', '11.5', '1');
  await expect(status(page)).toHaveAttribute('data-state', 'traded');
  await expect.poll(spoken).toEqual(['I buy 1 at 11.5. Make me a new market.']);
  await b.quant.close(id);
  await expect(heading(page)).toHaveText('Question 3 of 4');
  await expect.poll(spoken).toEqual([
    'I buy 1 at 11.5. Make me a new market.',
    // The closing line's formula is said in words (`speechOf`).
    'Right, 5 over 36 is it. Let’s move on to the next one.',
    'Question 3 is on your screen.',
  ]);
});

test.describe('the setup option', () => {
  const starts = (b: MockBackend) =>
    b.requests.filter((r) => r.method === 'POST' && r.path === '/api/pads/quant');

  test('on for the trader path, off for the researcher path, kept per path', async ({ page }) => {
    const b = await setup(page);
    await page.goto('/quant');
    const card = page.getByTestId('round-setup');
    const option = card.getByRole('switch', { name: 'Include a market-making game' });
    await expect(option).toHaveAttribute('aria-checked', 'true');
    await expect(card.getByTestId('round-game')).toContainText('live market on hidden dice');
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'false');
    await card.getByRole('button', { name: 'Start the round' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    expect(starts(b).at(-1)?.body).toMatchObject({ path: 'trader', includeGame: false });

    // The choice is kept for the trader path; the researcher path starts without one.
    await page.goto('/quant');
    await expect(
      page.getByRole('switch', { name: 'Include a market-making game' }),
    ).toHaveAttribute('aria-checked', 'false');
    await page.goto('/quant?path=researcher');
    const researcher = page.getByRole('switch', { name: 'Include a market-making game' });
    await expect(researcher).toHaveAttribute('aria-checked', 'false');
    await researcher.click();
    await page.getByRole('button', { name: 'Start the round' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    expect(starts(b).at(-1)?.body).toMatchObject({ path: 'researcher', includeGame: true });
    // Asked for, the game is the second question.
    await expect(heading(page)).toHaveText('Question 1 of 4', { timeout: 20_000 });
    await page.getByLabel('Message', { exact: true }).fill('answer: 5/36');
    await page.getByLabel('Message', { exact: true }).press('Enter');
    await expect(heading(page)).toHaveText('Question 2 of 4');
    await expect(panel(page)).toBeVisible();
  });
});

test.describe('the game in the report', () => {
  test('reviews the markets, the updating, the risk and the P&L, with the fair value', async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`/pads/${QUANT_GAME_ENDED_PAD_ID}/report`);
    const reviews = page.getByTestId('question-review');
    await expect(reviews.getByTestId('review-status')).toHaveText([
      'Answered',
      'Answered',
      'Unfinished',
      'Not reached',
    ]);
    const second = reviews.nth(1);
    const game = second.getByTestId('game-review');
    await expect(game.locator('[data-testid="game-component"][data-shown]')).toHaveCount(3);
    await expect(game.getByTestId('review-value')).toHaveText('13');
    // Decisions against luck: +2 of edge, −4.5 realised.
    await expect(game.getByTestId('review-edge-value')).toHaveText('+2');
    await expect(game.getByTestId('review-pnl-value')).toHaveText('−4.5');
    await expect(game.getByTestId('review-luck-value')).toHaveText('−6.5');
    await expect(game.getByTestId('review-risk')).toHaveText(
      'Ended short 6 · largest position 6 lots · quotes of up to 5 lots',
    );
    // Each market against the fair value at the time.
    const markets = game.getByTestId('review-quote');
    await expect(markets).toHaveCount(4);
    expect(
      await markets.evaluateAll((rows) => rows.map((r) => r.getAttribute('data-side'))),
    ).toEqual(['inside', 'above', 'inside', 'inside']);
    await expect(markets.nth(1)).toContainText('Above your offer');
    await expect(game).toContainText('3 of 4 around fair value · 4 traded');
    // Updating on each die: half way after the 6, all the way after the 2.
    await expect(game.getByTestId('review-reveal')).toHaveCount(2);
    await expect(game.getByTestId('review-reveal').first()).toContainText('Die 1 showed 6');
    await expect(game.getByTestId('review-reveal').first()).toContainText('Moved 50% of the way');
    await expect(game.getByTestId('review-reveal').first()).toContainText('10.5 → 13');
    await expect(game.getByTestId('review-reveal').last()).toContainText('Moved with it');
    // Each trade's edge.
    await expect(game.getByTestId('review-trade')).toHaveCount(4);
    await expect(game.getByTestId('review-trade').nth(1)).toContainText('Sold 2 at 12.5');
    await expect(game.getByTestId('review-trade').nth(1)).toContainText('−1');
    // The figures before anything was shown, and the explanation, typeset.
    await expect(second.getByTestId('review-solution')).toHaveText(
      'Fair value 10.5, standard deviation 2.96, from 3 to 18',
    );
    await expect(second.locator('.katex').first()).toBeVisible();
    await expect(second.getByTestId('review-verdict')).toContainText('moved only half way');

    // The transcript has the game's moves in place among the messages.
    const playback = page.getByRole('region', { name: 'Playback' });
    const events = playback.getByTestId('game-event');
    await expect(events).toHaveCount(11);
    await expect(events.first()).toHaveText('Market 9.5 – 11.5, 2 lots');
    await expect(events.nth(1)).toHaveText('Sold 2 at 11.5');
    await expect(events.nth(2)).toHaveText('Die 1 shown: 6');
    await expect(events.last()).toHaveText('Settled at 13 · P&L −4.5');
    // A quote comes after the message that posted it.
    const order = await playback
      .getByRole('list')
      .first()
      .evaluate((ol) => [...ol.children].map((li) => li.textContent ?? ''));
    const posted = order.findIndex((t) => t.includes('9.5 bid, 11.5 offered, 2 lots'));
    const entry = order.findIndex((t) => t.includes('Market 9.5 – 11.5, 2 lots'));
    expect(posted).toBeGreaterThanOrEqual(0);
    expect(entry).toBe(posted + 1);
  });
});
