/**
 * A trader round with a market-making game, against the real API and a real model (no
 * interception). See playwright.real.config.ts. Skipped unless REAL_API=1 and REAL_ANTHROPIC_KEY
 * is set (the key is pasted into the key dialog like a user would, removed at the end, and never
 * printed). Screenshots go to e2e/.screens/real-quant-game-*.png.
 *
 * Plays the round as a person would: skips the first question, makes markets in the game (after
 * checking the form refuses a bad one), checks after every answer that the chat, the panel and the
 * server's view agree, types a market and asks for the fair value, ends the interview mid-game and
 * checks the settlement and the report. Every API response and pad-socket message is recorded;
 * once the report gives the hidden values and fair values, everything received before the
 * settlement is scanned for them.
 *
 * The playing candidate is the test: it reads the game's mechanics from the content (as a person
 * reads the prompt) to centre its markets. Nothing of that reaches the browser.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  gameConditional,
  type QuantGameReview,
  type QuantGameView,
  type QuantRoundView,
} from '@ipp/contracts';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { loadQuantGames } from '../../../packages/content/src/load';

test.skip(
  !process.env.REAL_API || !process.env.REAL_ANTHROPIC_KEY,
  'set REAL_API=1 and REAL_ANTHROPIC_KEY with the API on :4000 and next dev on :3000',
);
// Traces record typed values; this test handles a real API key.
test.use({ trace: 'off' });

const KEY = process.env.REAL_ANTHROPIC_KEY?.trim() ?? '';
const REPLY_MS = 180_000;

const shot = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: `e2e/.screens/real-quant-game-${name}.png`, fullPage });

/** As the panel writes figures: "−2" with a minus sign, "+11.5" when signed. */
const fmt = (x: number) => String(Number(x.toFixed(3))).replace('-', '−');
const signed = (x: number) => (Math.abs(x) < 0.0005 ? '0' : x > 0 ? `+${fmt(x)}` : fmt(x));
const positionText = (p: number) => (p === 0 ? 'Flat' : p > 0 ? `Long ${p}` : `Short ${-p}`);
const field = (scope: Locator, name: 'Bid' | 'Offer' | 'Size') =>
  scope.getByLabel(name, { exact: true });
const plain = (x: number) => String(Number(x.toFixed(3)));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `x` as a standalone figure in text ("10.5", not "110.5" or "10.55"). */
const figure = (x: number) => new RegExp(`(?<![\\d.])${escapeRe(plain(x))}(?![\\d]|\\.\\d)`);

async function pasteKey(page: Page, submit: string) {
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox', { name: /API key/ });
  await expect(input).toHaveValue('');
  await page.evaluate((k) => navigator.clipboard.writeText(k), KEY);
  await input.focus();
  await page.keyboard.press('ControlOrMeta+V');
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await dialog.getByRole('button', { name: submit }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

type Rec = { seq: number; src: string; body: string };

/** The exchange as it happens, so a failed run still leaves it (no key is ever in it). */
const LOG = 'e2e/.screens/real-quant-game.log';
const trace = (line: string) => appendFileSync(LOG, `${line}\n`);

test('a trader round with a market-making game, played through the real stack', async ({
  page,
  context,
}) => {
  test.setTimeout(1_800_000);
  mkdirSync('e2e/.screens', { recursive: true });
  writeFileSync(LOG, '');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const problems: string[] = [];
  const notes: string[] = [];
  const note = (n: string) => {
    notes.push(n);
    trace(`note: ${n}`);
  };
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  // Everything the page receives from the API and the pad socket, in order.
  const recs: Rec[] = [];
  let seq = 0;
  const quotePosts: unknown[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/round/quote'))
      quotePosts.push(r.postDataJSON());
  });
  page.on('response', async (r) => {
    if (!r.url().includes('/api/')) return;
    const n = seq++;
    if (r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    try {
      recs.push({ seq: n, src: `${r.request().method()} ${r.url()}`, body: await r.text() });
    } catch {
      // A redirect or an aborted response has no body.
    }
  });
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/ws/pads/')) return;
    ws.on('framereceived', (f) => {
      if (typeof f.payload === 'string') recs.push({ seq: seq++, src: 'ws', body: f.payload });
    });
  });

  // ---------------------------------------------------------------- 1. sign up, key, start
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Game Tester');
  await page.getByLabel('Email').fill(`e2e-game-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // A trader round of 20 minutes with its game in the second slot: the builder's stages hold a
  // game alone, so this round is started through the API, once the key is saved from a setup.
  await page.goto('/quant/interviews');
  await shot(page, 'setup');
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await expect(page.getByRole('dialog', { name: 'Add your API key to start' })).toBeVisible();
  await pasteKey(page, 'Save key and start');
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const roundId = await page.evaluate(async () => {
    const r = await fetch('/api/pads/quant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'trader', durationMin: 20, includeGame: true }),
    });
    return ((await r.json()) as { id: string }).id;
  });
  await page.goto(`/pads/${roundId}`);
  const padUrl = page.url();
  const padId = padUrl.split('/').at(-1) as string;
  await expect(page.getByTestId('quant-workspace')).toBeVisible({ timeout: 30_000 });

  const heading = page.getByTestId('round-heading');
  const chat = page.getByRole('region', { name: 'Interviewer chat' });
  const said = chat.locator(
    '[data-testid="interviewer-message"], [data-testid="proactive-message"]',
  );
  const message = page.getByLabel('Message', { exact: true });
  const busy = page.getByTestId('interviewer-thinking').or(page.getByTestId('streaming-message'));

  /** Waits for a new interviewer message after `before` of them, and for it to finish. */
  async function reply(before: number): Promise<string> {
    await expect.poll(() => said.count(), { timeout: REPLY_MS }).toBeGreaterThan(before);
    await expect(busy).toHaveCount(0, { timeout: REPLY_MS });
    const texts = await said.allInnerTexts();
    const words = texts.slice(before).join('\n');
    trace(`interviewer: ${words}`);
    return words;
  }
  async function send(text: string): Promise<string> {
    await expect(busy).toHaveCount(0, { timeout: REPLY_MS });
    const before = await said.count();
    trace(`candidate (chat): ${text}`);
    await message.fill(text);
    await message.press('Enter');
    return reply(before);
  }
  async function round(): Promise<QuantRoundView> {
    const r = await page.evaluate(async (id) => (await fetch(`/api/pads/${id}`)).json(), padId);
    return (r as { round: QuantRoundView }).round;
  }
  async function gameView(): Promise<QuantGameView> {
    const g = (await round()).questions.at(-1)?.game;
    if (!g) throw new Error('the current question is not a game');
    return g;
  }

  await expect(heading).toHaveText('Question 1 of 3', { timeout: REPLY_MS });
  await expect(busy).toHaveCount(0, { timeout: REPLY_MS });
  await shot(page, 'q1');

  // ---------------------------------------------------------------- 2. past the first question
  const skips = [
    'I would like to skip this question, please. Can we move on to the next one?',
    'I really do not know how to do this one. Please skip it and move on.',
    'Please close this question now; I give up on it.',
  ];
  for (const s of skips) {
    await send(s);
    if ((await heading.textContent()) === 'Question 2 of 3') break;
    await page.waitForTimeout(3000);
    if ((await heading.textContent()) === 'Question 2 of 3') break;
  }
  await expect(heading).toHaveText('Question 2 of 3', { timeout: 60_000 });
  const panel = page.getByTestId('game-panel');
  await expect(panel).toBeVisible();
  await expect(busy).toHaveCount(0, { timeout: REPLY_MS });

  // The game as a person reads it from the prompt: here, from the content.
  const first = await gameView();
  const spec = loadQuantGames().find((g) => g.title === first.title);
  if (!spec) throw new Error(`no game titled ${first.title}`);
  note(`game: ${spec.id} (${spec.title}), tick ${spec.tick}, up to ${spec.maxSize}`);
  const tick = spec.tick;
  const snap = (x: number) => Math.round(x / tick) * tick;
  const publicFair = (v: QuantGameView) => {
    const revealed = v.log.filter((e) => e.kind === 'reveal').length;
    return gameConditional(
      spec,
      v.components.map((c) => c.value ?? 0),
      revealed,
    );
  };
  const tiles = panel.getByTestId('game-component');
  await expect(tiles).toHaveCount(spec.components.length);
  await expect(panel.locator('[data-testid="game-component"][data-shown]')).toHaveCount(0);
  await expect(page.getByTestId('quote-status')).toHaveAttribute('data-state', 'none');
  await expect(panel.getByTestId('game-position')).toHaveText('Flat');
  await shot(page, 'game');

  // ---------------------------------------------------------------- 3. the form, then markets
  const f0 = publicFair(first);
  const mid0 = snap(f0.fair);
  await field(panel, 'Bid').fill(plain(mid0 + tick / 2));
  await expect(panel.getByTestId('quote-bid-error')).toHaveText(`Use steps of ${fmt(tick)}`);
  await expect(field(panel, 'Bid')).toHaveAttribute('aria-invalid', 'true');
  await field(panel, 'Bid').fill(plain(mid0 + tick));
  await field(panel, 'Offer').fill(plain(mid0 - tick));
  await field(panel, 'Size').fill('1');
  await expect(panel.getByTestId('quote-ask-error')).toHaveText('Must be above the bid');
  await field(panel, 'Size').press('Enter');
  await shot(page, 'validation');
  await page.waitForTimeout(1500);
  expect(quotePosts).toEqual([]);
  expect((await gameView()).log).toEqual([]);

  // My own books, from the chat's words alone.
  let myPosition = 0;
  let myCash = 0;
  const tradeRe = /I (buy|sell) (\d+) at your (?:offer|bid) of (-?\d+(?:\.\d+)?)\./g;
  const revealRe = /([A-Z][\w -]*?) shows (-?\d+(?:\.\d+)?)\./g;
  const allSaid: string[] = [];
  const posted: { bid: number; ask: number; size: number }[] = [];

  async function checkAgreement(words: string, logBefore: number) {
    const v = await gameView();
    const fresh = v.log.slice(logBefore);
    const trades = fresh.filter((e) => e.kind === 'trade');
    const reveals = fresh.filter((e) => e.kind === 'reveal');
    const chatTrades = [...words.matchAll(tradeRe)];
    const chatReveals = [...words.matchAll(revealRe)];
    expect.soft(chatTrades.length, `trades said vs booked in: ${words}`).toBe(trades.length);
    expect.soft(chatReveals.length, `reveals said vs booked in: ${words}`).toBe(reveals.length);
    for (const m of chatTrades) {
      const n = Number(m[2]);
      const price = Number(m[3]);
      // The interviewer buying is the candidate selling.
      myPosition += m[1] === 'buy' ? -n : n;
      myCash += m[1] === 'buy' ? n * price : -n * price;
    }
    for (const m of chatReveals) {
      const tile = tiles.filter({ hasText: `${m[1]}: ${fmt(Number(m[2]))}` });
      await expect.soft(tile, `tile for ${m[1]} = ${m[2]}`).toHaveCount(1);
      await expect.soft(tile).toHaveAttribute('data-shown', 'true');
    }
    if (chatTrades.length === 0 && /\bI(?:'ll|’ll| will)? (?:buy|sell|lift|hit)\b/i.test(words))
      note(`words claim a trade the books do not hold: ${words}`);
    await expect.soft(panel.getByTestId('game-position')).toHaveText(positionText(myPosition));
    await expect.soft(panel.getByTestId('game-cash')).toHaveText(signed(myCash));
    expect.soft(v.position).toBe(myPosition);
    expect.soft(Math.abs(v.cash - myCash)).toBeLessThan(0.0005);
    await expect
      .soft(panel.getByTestId('blotter-trade'))
      .toHaveCount(v.log.filter((e) => e.kind === 'trade').length);
    await expect
      .soft(panel.getByTestId('blotter-reveal'))
      .toHaveCount(v.log.filter((e) => e.kind === 'reveal').length);
    const status = page.getByTestId('quote-status');
    if (trades.length || reveals.length) {
      // The market is gone; the form still holds the last numbers.
      expect.soft(v.quote).toBeNull();
      await expect
        .soft(status)
        .toHaveAttribute('data-state', trades.length ? 'traded' : 'withdrawn');
      const last = posted.at(-1);
      if (last) {
        await expect.soft(field(panel, 'Bid')).toHaveValue(plain(last.bid));
        await expect.soft(field(panel, 'Offer')).toHaveValue(plain(last.ask));
        await expect.soft(field(panel, 'Size')).toHaveValue(String(last.size));
      }
    } else if (v.quote) {
      await expect.soft(status).toHaveAttribute('data-state', 'working');
    }
    return { trades: trades.length, reveals: reveals.length, view: v };
  }

  let trades = 0;
  let reveals = 0;
  let widthTicks = 0;
  let tradedShot = false;
  let revealShot = false;
  for (let exchange = 0; exchange < 8 && (trades < 1 || reveals < 1); exchange++) {
    const v = await gameView();
    if (v.settlement) break;
    const { fair, sd } = publicFair(v);
    // About two-thirds of a standard deviation wide, tighter each time it is sent back.
    const half = Math.max(1, Math.round((0.35 * sd) / tick) - widthTicks) * tick;
    const mid = snap(fair);
    const q = { bid: mid - half, ask: mid + half, size: exchange === 0 ? 1 : 2 };
    posted.push(q);
    await field(panel, 'Bid').fill(plain(q.bid));
    await field(panel, 'Offer').fill(plain(q.ask));
    await field(panel, 'Size').fill(String(q.size));
    const logBefore = v.log.length;
    const before = await said.count();
    await expect(busy).toHaveCount(0, { timeout: REPLY_MS });
    trace(`candidate (quote box): ${JSON.stringify(q)}`);
    await field(panel, 'Size').press('Enter');
    const text = `${plain(q.bid)} bid, ${plain(q.ask)} offered, ${q.size} ${q.size === 1 ? 'lot' : 'lots'}`;
    await expect(chat.getByText(text, { exact: true }).last()).toBeVisible();
    const words = await reply(before);
    allSaid.push(words);
    const got = await checkAgreement(words, logBefore + 1);
    trades += got.trades;
    reveals += got.reveals;
    if (got.view.settlement) {
      note('the interviewer closed the game before it was ended');
      break;
    }
    if (got.trades === 0 && got.reveals === 0) widthTicks++;
    if (got.trades && !tradedShot) {
      tradedShot = true;
      await shot(page, 'traded');
    }
    if (got.reveals && !revealShot) {
      revealShot = true;
      await shot(page, 'reveal');
    }
  }
  expect(trades, 'at least one trade').toBeGreaterThanOrEqual(1);
  expect(reveals, 'at least one reveal').toBeGreaterThanOrEqual(1);

  // The panel at phone width, mid-game.
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('tablist', { name: 'Pad sections' })
    .getByRole('tab', { name: 'Question' })
    .click();
  await panel.scrollIntoViewIfNeeded();
  await shot(page, 'game-390');
  await page
    .getByRole('tablist', { name: 'Pad sections' })
    .getByRole('tab', { name: 'Chat' })
    .click();
  await shot(page, 'chat-390');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(panel).toBeVisible();

  // ---------------------------------------------------------------- 4. a typed market; fair value
  let v = await gameView();
  if (v.settlement) throw new Error('the game settled before the typed market');
  const tradesBefore = v.log.filter((e) => e.kind === 'trade').length;
  const fNow = publicFair(v);
  const typed = { bid: snap(fNow.fair) - tick * 2, ask: snap(fNow.fair) + tick * 2 };
  const typedWords = await send(
    `My market is ${plain(typed.bid)} bid, ${plain(typed.ask)} offered, 1 lot.`,
  );
  allSaid.push(typedWords);
  v = await gameView();
  expect
    .soft(v.log.filter((e) => e.kind === 'trade').length, 'no trade on a typed market')
    .toBe(tradesBefore);
  expect.soft(v.quote, 'a typed market is not live').toBeNull();
  expect
    .soft(typedWords, 'asks for the typed market to be posted')
    .toMatch(/quote box|post (it|that|your|the)|through the (box|form)|in the box/i);
  await shot(page, 'typed');

  const fairWords = await send('What is the fair value of the contract right now?');
  allSaid.push(fairWords);
  for (const x of [fNow.fair, publicFair(await gameView()).fair])
    if (!posted.some((q) => [q.bid, q.ask].includes(x)) && ![typed.bid, typed.ask].includes(x))
      expect.soft(fairWords, 'no fair figure in the answer').not.toMatch(figure(x));
  expect
    .soft(fairWords, 'declines to give the fair value')
    .toMatch(
      /exercise|work (it|that) out|yourself|your (job|call|number)|not going to|won.t|can.t|for you to/i,
    );
  await shot(page, 'fair');

  // ---------------------------------------------------------------- 5. end mid-game
  v = await gameView();
  if (v.settlement) throw new Error('the game settled before the pad was ended');
  const endPosition = v.position;
  const endCash = v.cash;
  await expect(panel.getByTestId('game-position')).toHaveText(positionText(endPosition));
  await expect(panel.getByTestId('game-cash')).toHaveText(signed(endCash));
  const gameChat = (await chat.allInnerTexts()).join('\n');
  const cutoff = seq;
  await page.getByRole('button', { name: 'End interview' }).click();
  await page.getByRole('button', { name: 'End and see report' }).click();
  await expect(page).toHaveURL(/\/report$/, { timeout: 30_000 });

  const report = (await page.evaluate(
    async (id) => (await fetch(`/api/pads/${id}/report`)).json(),
    padId,
  )) as {
    quant: { questions: { type: string; status: string; game: QuantGameReview | null }[] } | null;
  };
  const review = report.quant?.questions.find((q) => q.type === 'game')?.game;
  if (!review) throw new Error('the report has no game review');
  const value = review.value;
  const pnl = endCash + endPosition * value;
  expect(review.finalPosition).toBe(endPosition);
  expect(Math.abs(review.cash - endCash)).toBeLessThan(0.0005);
  expect(Math.abs(review.pnl - pnl)).toBeLessThan(0.0005);
  expect(review.quotes).toHaveLength(posted.length);
  expect(review.trades).toHaveLength(trades);
  expect(review.reveals).toHaveLength(reveals);

  const game = page.getByTestId('game-review');
  await expect(game).toBeVisible({ timeout: 60_000 });
  await expect(game.locator('[data-testid="game-component"][data-shown]')).toHaveCount(
    spec.components.length,
  );
  await expect(game.getByTestId('review-value')).toHaveText(fmt(value));
  await expect(game.getByTestId('review-pnl-value')).toHaveText(signed(pnl));
  await expect(game.getByTestId('review-edge-value')).toHaveText(signed(review.expectedEdge));
  await expect(game).toContainText(`Fair value at the start${fmt(review.stats.fair)}`);
  await expect(game.getByTestId('review-quote')).toHaveCount(posted.length);
  await expect(game.getByTestId('review-trade')).toHaveCount(trades);
  await expect(game.getByTestId('review-reveal')).toHaveCount(reveals);
  await expect(game.getByTestId('review-risk')).toContainText(
    `Ended ${positionText(endPosition).toLowerCase()}`,
  );
  const playback = page.getByRole('region', { name: 'Playback' });
  const events = playback.getByTestId('game-event');
  await expect(events).toHaveCount(posted.length + trades + reveals + 1);
  await expect(events.last()).toHaveText(`Settled at ${fmt(value)} · P&L ${signed(pnl)}`);
  await shot(page, 'report', true);
  await game.scrollIntoViewIfNeeded();
  await shot(page, 'report-game');
  // The assessment, on the owner's key.
  await expect(page.getByRole('list', { name: /Recommendation scale/ })).toBeVisible({
    timeout: 300_000,
  });
  await shot(page, 'report-assessed', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await game.scrollIntoViewIfNeeded();
  await shot(page, 'report-game-390');
  await shot(page, 'report-390', true);
  await page.setViewportSize({ width: 1440, height: 900 });

  // The ended pad keeps the settlement in view.
  await page.goto(padUrl);
  const settled = page.getByTestId('settled-game').or(page.getByTestId('game-panel')).first();
  await expect(settled).toBeVisible({ timeout: 30_000 });
  await expect(settled.locator('[data-testid="game-component"][data-shown]')).toHaveCount(
    spec.components.length,
  );
  await expect(settled.getByTestId('settlement-value')).toHaveText(fmt(value));
  await expect(settled.getByTestId('settlement-pnl')).toHaveText(signed(pnl));
  await shot(page, 'pad-ended');
  const endedChat = (await said.allInnerTexts()).join('\n');
  if (!/settles the game/.test(endedChat)) note('the chat never states the settlement');

  // ---------------------------------------------------------------- 6. nothing hidden before
  const pre = recs.filter((r) => r.seq < cutoff);
  expect(pre.length).toBeGreaterThan(10);
  const settledEarly = pre.filter((r) => r.body.includes('"kind":"settle"'));
  expect(
    settledEarly.map((r) => r.src),
    'no settlement before the end',
  ).toEqual([]);
  const forbidden = new Set([
    'fair',
    'sd',
    'values',
    'markToFair',
    'markToValue',
    'fairInside',
    'hitBid',
    'liftOffer',
    'vsFair',
    'vsValue',
    'counterparty',
    'expect',
    'expectedEdge',
    'nextReveal',
    'books',
    'explanation',
  ]);
  let gameViews = 0;
  const keyHits: string[] = [];
  const viewProblems: string[] = [];
  const interviewerTexts = new Map<string, string>();
  const walk = (x: unknown, src: string) => {
    if (Array.isArray(x)) {
      if (
        x.length === review.components.length &&
        x.every((y, i) => y === review.components[i]?.value)
      )
        keyHits.push(`${src}: the values array`);
      for (const y of x) walk(y, src);
      return;
    }
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    for (const k of Object.keys(o)) if (forbidden.has(k)) keyHits.push(`${src}: ${k}`);
    if (Array.isArray(o.components) && Array.isArray(o.log) && 'quotesLeft' in o) {
      const g = o as unknown as QuantGameView;
      gameViews++;
      const shown = new Set(g.log.flatMap((e) => (e.kind === 'reveal' ? [e.component] : [])));
      g.components.forEach((c, i) => {
        if (c.value !== null && !shown.has(i)) viewProblems.push(`${src}: ${c.label} shown early`);
        if (c.value !== null && c.value !== review.components[i]?.value)
          viewProblems.push(`${src}: ${c.label} wrong value`);
      });
    }
    if (o.role === 'interviewer' && typeof o.text === 'string' && o.intent !== 'question')
      interviewerTexts.set(String(o.id), o.text);
    if (o.type === 'message.delta' && typeof o.delta === 'string') {
      const id = `delta:${String(o.messageId)}`;
      interviewerTexts.set(id, (interviewerTexts.get(id) ?? '') + o.delta);
    }
    for (const y of Object.values(o)) walk(y, src);
  };
  for (const r of pre) {
    try {
      walk(JSON.parse(r.body), r.src);
    } catch {
      // Not JSON (a page or a script): nothing of the game is in those.
    }
  }
  expect(keyHits, 'no server-only field before the settlement').toEqual([]);
  expect(viewProblems, 'components shown only once revealed').toEqual([]);

  // Fair values and the true value, in anything the interviewer said or streamed before the
  // end, except figures that were public anyway (the candidate's own prices, values shown).
  const publicFigures = new Set<number>([
    tick,
    spec.maxSize,
    ...posted.flatMap((q) => [q.bid, q.ask, q.size]),
    typed.bid,
    typed.ask,
    ...review.reveals.map((r) => r.value),
    ...review.trades.map((t) => t.price),
  ]);
  const secret = new Set<number>([
    review.stats.fair,
    value,
    ...review.quotes.map((q) => q.fair),
    ...review.reveals.flatMap((r) => [r.fairBefore, r.fairAfter]),
  ]);
  const leaks: string[] = [];
  for (const x of secret) {
    if (publicFigures.has(x)) continue;
    for (const [id, text] of interviewerTexts)
      if (figure(x).test(text)) leaks.push(`${x} in ${id}: ${text}`);
  }
  // A hidden component named with a value it had not shown.
  const revealedLabels = new Map(review.reveals.map((r) => [r.label, r.value]));
  for (const [id, text] of interviewerTexts)
    for (const m of text.matchAll(revealRe))
      if (revealedLabels.get(m[1] as string) !== Number(m[2]))
        leaks.push(`${m[1]} = ${m[2]} in ${id}: ${text}`);
  expect.soft(leaks, 'no fair value or hidden value before the settlement').toEqual([]);

  console.log(
    [
      `pad ${padId}`,
      ...notes.map((n) => `note: ${n}`),
      `recorded ${pre.length} payloads before the end, ${recs.length} in all; scanned ${gameViews} game views and ${interviewerTexts.size} interviewer texts for ${secret.size} secret figures`,
      `true values ${review.components.map((c) => `${c.label}=${c.value}`).join(', ')}; value ${value}; fair at start ${review.stats.fair}`,
      `end position ${endPosition}, cash ${endCash}, P&L ${pnl}, expected edge ${review.expectedEdge}`,
      '--- chat before the end ---',
      gameChat,
      '--- interviewer, after the end ---',
      endedChat,
      '--- problems ---',
      problems.join('\n') || '(none)',
    ].join('\n'),
  );

  // ---------------------------------------------------------------- tidy up
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /AI key/ }).click();
  const saved = page.getByTestId('ai-key-saved');
  await expect(saved).toContainText(`sk-ant-…${KEY.slice(-4)}`);
  await saved.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('textbox', { name: 'Anthropic API key' })).toHaveValue('');
});
