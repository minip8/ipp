/**
 * The interviewer playing a market-making game (ARCHITECTURE §8.3) against an in-memory round
 * driven by the shared `advanceRound` (./quant-harness.ts), with only the model scripted: its
 * moves, the facts it posts, the books after every step, every way a move could disagree with the
 * words, a quote landing mid-turn, closes for time, failures and voice.
 */
import type { ServerEvent } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import type { ModelRequest } from '../src/model';
import { QUANT_MESSAGES } from '../src/quant/round';
import type { Reply } from './harness';
import {
  defaultQuantRespond,
  type QuantHarness,
  quantHarness,
  taskOf,
  turn,
} from './quant-harness';

function scripted(script: Record<string, (n: number, req: ModelRequest) => Reply>) {
  const seen: Record<string, number> = {};
  return (req: ModelRequest, n: number): Reply => {
    const task = taskOf(req);
    seen[task] = (seen[task] ?? 0) + 1;
    const f = script[task];
    return f ? f(seen[task] as number, req) : defaultQuantRespond(req, n);
  };
}
const lastSystem = (req: ModelRequest) => {
  const last = req.messages[req.messages.length - 1];
  return last?.role === 'system' && typeof last.content === 'string' ? last.content : '';
};
type Delta = Extract<ServerEvent, { type: 'message.delta' }>;
const deltas = (h: QuantHarness, from = 0) =>
  h.events.slice(from).filter((e): e is Delta => e.type === 'message.delta');
const streamedText = (h: QuantHarness, from = 0) =>
  deltas(h, from)
    .map((d) => d.delta)
    .join('');
const closeQ1 = turn({ action: 'close', message: 'Right.', score: 1, summary: 'Fine.' });

/** A round whose second question is the harness's game (dice 6, 2, 5: worth 13), now posed. */
async function atGame(replies: (n: number, req: ModelRequest) => Reply) {
  const h = quantHarness({
    game: {},
    respond: scripted({ reply: (n, req) => (n === 1 ? closeQ1 : replies(n - 1, req)) }),
  });
  await h.start();
  await h.say('One sixth, final answer.');
  expect(h.round.current).toBe(1);
  expect(h.posted().at(-1)?.text).toContain('GAME-PROMPT');
  return h;
}
const lastSaid = (h: QuantHarness) => h.interviewerSaid().at(-1)?.text;

describe('a game played through the round', () => {
  it('quote, trade and reveal, a new quote, an informed trade, and a close that settles it', async () => {
    const script: Reply[] = [
      // Quote 1 (9.5 / 11.5 × 2): lift the offer for the full size, then show Die 1.
      turn({
        action: 'stay',
        trade: 'buy',
        quantity: 2,
        reveal: true,
        message: 'Where is your market now?',
      }),
      // Quote 2 (12.5 / 13.5 × 1): hit the bid.
      turn({ action: 'stay', trade: 'sell', quantity: 1, message: 'What is your position?' }),
      // A typed message: no move.
      turn({ action: 'stay', message: 'Fair enough. Post a market.' }),
      // Quote 3 (12 / 14 × 3): pass, and show Die 2.
      turn({ action: 'stay', reveal: true, message: 'New market, please.' }),
      // Quote 4 (14 / 15 × 3): the bid is above the true value 13: hit it for 3.
      turn({ action: 'stay', trade: 'sell', quantity: 3, message: 'What do my trades tell you?' }),
      // The close.
      turn({ action: 'close', message: "Let's stop there.", score: 0.6, summary: 'Moved well.' }),
    ];
    const h = await atGame((n) => script[n - 1] ?? turn({ action: 'stay', message: 'Hm.' }));
    const g = () => h.game();

    // Quote 1.
    expect(await h.quote(9.5, 11.5, 2)).toBe('9.5 bid, 11.5 offered, 2 lots');
    expect(h.applied().at(-1)).toMatchObject({
      type: 'turn',
      action: 'stay',
      game: { trade: { interviewerSide: 'buy', quantity: 2 }, reveal: true },
    });
    expect(lastSaid(h)).toBe(
      'I buy 2 at your offer of 11.5. Die 1 shows 6. Where is your market now?',
    );
    expect(g()).toMatchObject({ position: -2, cash: 23, revealed: 1, quote: null });
    expect(h.gameLog.map((e) => e.kind)).toEqual(['quote', 'trade', 'reveal']);

    // Quote 2: the trade streams (no reveal), facts first, under the posted message's id.
    let mark = h.events.length;
    await h.quote(12.5, 13.5, 1);
    expect(lastSaid(h)).toBe('I sell 1 at your bid of 12.5. What is your position?');
    expect(streamedText(h, mark)).toBe(lastSaid(h));
    expect(deltas(h, mark)[0]?.messageId).toBe(h.interviewerSaid().at(-1)?.id);
    expect(g()).toMatchObject({ position: -1, cash: 10.5, revealed: 1, quote: null });

    // The books the model decided quote 2 on: the live quote, its edges, position after quote 1.
    const req2 = h.turnCalls().at(-1)?.req as ModelRequest;
    const books2 = lastSystem(req2);
    expect(books2).toContain('Live quote: 12.5 bid, 13.5 offered, 1 lot');
    expect(books2).toContain('Candidate: short 2, cash +23');
    expect(books2).toContain('Public fair value now (given what has been shown): 13,');
    expect(books2).toContain('Die 1 = 6 (shown)');
    // The quote is marked as posted through the quote box.
    expect(JSON.stringify(req2.messages.at(-2))).toContain('source=\\"quote\\"');

    // A typed message: answered, no move, and its books show no quote.
    await h.say('I think I am short one now.');
    expect(lastSaid(h)).toBe('Fair enough. Post a market.');
    expect(lastSystem(h.turnCalls().at(-1)?.req as ModelRequest)).toContain('Live quote: none.');
    expect(JSON.stringify(h.turnCalls().at(-1)?.req.messages.at(-2))).not.toContain('source=');

    // Quote 3: a pass and a reveal (not streamed: the value is not public until the step).
    mark = h.events.length;
    await h.quote(12, 14, 3);
    expect(deltas(h, mark)).toEqual([]);
    expect(lastSaid(h)).toBe('Die 2 shows 2. New market, please.');
    expect(g()).toMatchObject({ position: -1, revealed: 2, quote: null });

    // Quote 4: the informed trade.
    await h.quote(14, 15, 3);
    expect(lastSaid(h)).toBe('I sell 3 at your bid of 14. What do my trades tell you?');
    expect(g()).toMatchObject({ position: 2, cash: -31.5 });
    expect(lastSystem(h.turnCalls().at(-1)?.req as ModelRequest)).toContain(
      'Nothing is left to reveal',
    );

    // The close settles: P&L = −31.5 + 2 × 13 = −5.5, stated by the platform first.
    await h.say("I'd like to stop here.");
    expect(h.applied().at(-1)).toMatchObject({ type: 'close', by: 'interviewer' });
    const closing = h.interviewerSaid().at(-1)?.text;
    expect(closing).toBe(
      "That settles the game: Die 1 is 6, Die 2 is 2 and Die 3 is 5, so the contract is worth 13. You finish long 2, a loss of 5.5. Let's stop there.",
    );
    expect(g().settlement).toMatchObject({ value: 13, pnl: -5.5 });
    expect(h.round.questions[1]?.verdict).toEqual({ score: 0.6, summary: 'Moved well.' });
    expect(h.round.current).toBe(2);
    expect(h.gameLog.map((e) => e.kind)).toEqual([
      'quote',
      'trade',
      'reveal',
      'quote',
      'trade',
      'quote',
      'reveal',
      'quote',
      'trade',
      'settle',
    ]);

    // Every figure the interviewer posted is one the books hold.
    const said = h.interviewerSaid().map((m) => m.text);
    for (const t of h.gameLog)
      if (t.kind === 'trade')
        expect(
          said.some((s) => s.includes(` ${t.quantity} at your `) && s.includes(String(t.price))),
        ).toBe(true);

    // Nothing hidden was ever streamed before the step that made it public.
    const hidden = ['Die 2 shows', 'Die 3 is', 'settles the game'];
    for (const d of deltas(h)) for (const x of hidden) expect(d.delta).not.toContain(x);
  });

  it('a close may carry a last trade, made before the settlement, in one step', async () => {
    const h = await atGame(() =>
      turn({
        action: 'close',
        trade: 'buy',
        quantity: 5,
        reveal: true,
        message: "That's the game.",
        score: 0.5,
        summary: 'S.',
      }),
    );
    await h.quote(9.5, 11.5, 2);
    const close = h.applied().at(-1);
    expect(close).toMatchObject({
      type: 'close',
      game: { trade: { interviewerSide: 'buy', quantity: 2 } },
    });
    expect(close && 'game' in close && close.game?.reveal).toBeFalsy();
    expect(lastSaid(h)).toBe(
      "I buy 2 at your offer of 11.5. That settles the game: Die 1 is 6, Die 2 is 2 and Die 3 is 5, so the contract is worth 13. You finish short 2, a loss of 3. That's the game.",
    );
    expect(h.game().settlement?.pnl).toBe(-3);
    expect(h.quantTraces().at(-1)?.adjusted).toEqual([
      'quantity 5 -> 2',
      'reveal dropped: the close settles the game',
    ]);
  });
});

describe('words and books never disagree', () => {
  it('a trade with no live quote is dropped before anything is said, and the words alone are posted', async () => {
    const h = await atGame(() =>
      turn({ action: 'stay', trade: 'buy', quantity: 1, message: 'Make me a market first.' }),
    );
    const mark = h.events.length;
    await h.say('What do you want me to do?');
    expect(h.applied().at(-1)).not.toHaveProperty('game');
    expect(lastSaid(h)).toBe('Make me a market first.');
    expect(streamedText(h, mark)).toBe('Make me a market first.');
    expect(h.game()).toMatchObject({ position: 0, events: [] });
    expect(h.quantTraces().at(-1)?.adjusted).toEqual(['trade dropped: no live quote']);
  });

  it('a quantity beyond the quote’s size is clamped, and the facts say what was traded', async () => {
    const h = await atGame(() => turn({ action: 'stay', trade: 'sell', quantity: 9 }));
    await h.quote(10, 11, 3);
    expect(lastSaid(h)).toBe('I sell 3 at your bid of 10.');
    expect(h.game()).toMatchObject({ position: 3, cash: -30 });
  });

  it('a reveal with nothing left is dropped', async () => {
    let n = 0;
    const h = await atGame(() =>
      turn({ action: 'stay', reveal: true, message: `Market? (${++n})` }),
    );
    await h.say('ok');
    await h.say('ok');
    expect(h.game().revealed).toBe(2);
    await h.say('ok');
    expect(h.game().revealed).toBe(2);
    expect(h.applied().at(-1)).not.toHaveProperty('game');
    expect(lastSaid(h)).toBe('Market? (3)');
    expect(h.quantTraces().at(-1)?.adjusted).toEqual(['reveal dropped: nothing left to reveal']);
    // No step was ever refused for the books' sake.
    expect(h.steps.filter((s) => !s.result.ok)).toEqual([]);
  });

  it('a move on a bank question is ignored', async () => {
    const h = quantHarness({
      game: {},
      respond: scripted({
        reply: () =>
          turn({ action: 'stay', trade: 'sell', quantity: 1, reveal: true, message: 'Go on.' }),
      }),
    });
    await h.start();
    await h.say('thinking');
    expect(h.applied().at(-1)).toMatchObject({ type: 'turn', action: 'stay', say: 'Go on.' });
    expect(h.applied().at(-1)).not.toHaveProperty('game');
    expect(h.quantTraces().at(-1)?.adjusted).toEqual(['move ignored: not a game']);
  });

  it('words that claim a trade the fields did not make are flagged for the logs', async () => {
    const h = await atGame(() =>
      turn({ action: 'stay', message: "I'll buy two from you at 11.5." }),
    );
    await h.quote(9.5, 11.5, 2);
    expect(h.game().position).toBe(0);
    expect(h.quantTraces().at(-1)?.adjusted).toEqual(['words claim a trade, none made']);
  });

  it('a move on a silent spoken turn is not made', async () => {
    const h = quantHarness({
      game: {},
      settings: { voice: true },
      respond: scripted({
        reply: (n) => (n === 1 ? closeQ1 : turn({ action: 'silent', trade: 'buy', quantity: 1 })),
      }),
    });
    await h.start();
    await h.say('One sixth, final answer.');
    h.postQuote(9.5, 11.5, 1);
    await h.say('so I am thinking that maybe', 'voice');
    expect(h.game()).toMatchObject({ position: 0, quote: { bid: 9.5 } });
    expect(h.quantTraces().at(-1)).toMatchObject({
      outcome: 'silent',
      adjusted: ['move dropped: the turn says nothing'],
    });
  });
});

describe('a quote landing while a turn is in flight', () => {
  it('the turn’s step is stale and dropped; the new quote is then answered, on fresh books', async () => {
    let release: (s: string) => void = () => {};
    const first = turn({ action: 'stay', trade: 'buy', quantity: 2, message: 'Thanks.' });
    let h: QuantHarness | null = null;
    h = await atGame((n) => {
      if (n === 1)
        return {
          wait: new Promise<string>((r) => {
            release = r;
          }),
          // Far enough for the facts of its trade to show.
          partial: first.slice(0, first.indexOf('Thanks') + 3),
        };
      return turn({ action: 'stay', trade: 'buy', quantity: 1, message: 'And now?' });
    });
    const hh = h;
    // Quote 1 arrives; the reply is decided on it, slowly.
    hh.postQuote(9.5, 11.5, 2);
    hh.iv.handle(hh.padId, {
      type: 'candidate_message',
      text: '9.5 bid, 11.5 offered, 2 lots',
      via: 'text',
      userId: 'u1',
    });
    await new Promise((r) => setTimeout(r, 5));
    // Quote 2 replaces it while the model is still writing.
    hh.postQuote(10, 10.5, 1);
    hh.iv.handle(hh.padId, {
      type: 'candidate_message',
      text: '10 bid, 10.5 offered, 1 lot',
      via: 'text',
      userId: 'u1',
    });
    expect(streamedText(hh)).toContain('I buy 2 at your offer of 11.5. Tha');
    release(first);
    await hh.iv.idle(hh.padId);
    // The first turn's step was refused as stale: nothing of it was booked or posted.
    const refused = hh.steps.filter((s) => !s.result.ok);
    expect(refused.map((s) => s.result)).toEqual([{ ok: false, reason: 'stale' }]);
    // The second quote was answered: one lot lifted at 10.5, not two at 11.5.
    expect(hh.game()).toMatchObject({ position: -1, cash: 10.5 });
    expect(lastSaid(hh)).toBe('I buy 1 at your offer of 10.5. And now?');
    expect(hh.interviewerSaid().some((m) => m.text.includes('11.5'))).toBe(false);
    // What the stale turn streamed was dropped from every client.
    const discarded = hh.events.filter((e) => e.type === 'message.discarded');
    expect(discarded).toHaveLength(1);
  });
});

describe('the clock and failures on a game', () => {
  it('a close for time settles the game, with the canned line when the model fails', async () => {
    const h = quantHarness({
      game: {},
      respond: scripted({
        reply: (n) => (n === 1 ? closeQ1 : turn({ action: 'stay', message: 'Tighter, please.' })),
        nudge: () => ({ error: 'transient' }),
        timeout: () => ({ error: 'transient' }),
      }),
    });
    await h.start();
    await h.say('One sixth, final answer.');
    await h.quote(9.5, 11.5, 2);
    const c = h.clock();
    await h.advanceTo(c.posedAt + c.budgetMs + c.graceMs + 6000);
    // The canned nudge on a game asks for a last market.
    expect(h.interviewerSaid().some((m) => m.text === QUANT_MESSAGES.gameNudge)).toBe(true);
    const close = h.applied().find((s) => s.type === 'close' && s.by === 'timeout');
    expect(close).toMatchObject({ verdict: null });
    expect(close?.say).toBe(
      `That settles the game: Die 1 is 6, Die 2 is 2 and Die 3 is 5, so the contract is worth 13. We made no trades. ${QUANT_MESSAGES.timeout}`,
    );
    expect(h.game(1).settlement).toMatchObject({ value: 13, pnl: 0 });
    expect(h.round.current).toBe(2);
  });

  it('a failed model call on a quote: the candidate is answered, the game untouched', async () => {
    const h = await atGame((n) =>
      n === 1 ? { error: 'transient' } : turn({ action: 'stay', trade: 'buy', quantity: 1 }),
    );
    await h.quote(9.5, 11.5, 2);
    expect(lastSaid(h)).toBe(QUANT_MESSAGES.gameReplyFailed);
    expect(h.game()).toMatchObject({ position: 0, quote: { bid: 9.5, ask: 11.5 } });
    // Posting it again is answered as any quote.
    await h.quote(9.5, 11.5, 2);
    expect(lastSaid(h)).toBe('I buy 1 at your offer of 11.5.');
    expect(h.game()).toMatchObject({ position: -1, cash: 11.5 });
  });

  it('on voice: the facts are plain words, the task says voice, and a spoken quote is answered', async () => {
    const h = quantHarness({
      game: {},
      settings: { voice: true },
      respond: scripted({
        reply: (n) =>
          n === 1
            ? closeQ1
            : turn({ action: 'stay', trade: 'sell', quantity: 1, message: 'Where now?' }),
      }),
    });
    await h.start();
    await h.say('One sixth, final answer.', 'voice');
    await h.quote(9.5, 11.5, 1);
    expect(lastSaid(h)).toBe('I sell 1 at your bid of 9.5. Where now?');
    expect(lastSaid(h)).not.toMatch(/[$\\]/);
    expect(lastSystem(h.turnCalls().at(-1)?.req as ModelRequest)).toContain(
      'The candidate is on voice',
    );
    expect(h.game().position).toBe(1);
  });
});

describe('what the model is told about a game', () => {
  it('the playbook in the question’s block, the books per turn, and no follow-up', async () => {
    const h = await atGame(() => turn({ action: 'follow_up', message: 'And why that width?' }));
    await h.quote(9.5, 11.5, 2);
    const req = h.turnCalls().at(-1)?.req as ModelRequest;
    const system = JSON.stringify(req.system);
    expect(system).toContain('[GAME-COUNTERPARTY]');
    expect(system).toContain('[GAME-EXPLAIN]');
    expect(system).toContain('# Market-making games');
    expect(system).toContain('uniform on 1 to 6');
    // The cached blocks hold no state: the books are per turn.
    expect(system).not.toContain('Live quote');
    expect(lastSystem(req)).toContain('GAME BOOKS');
    expect(lastSystem(req)).toContain('TASK (reply)');
    expect(lastSystem(req)).toContain('This is a market-making game');
    // A follow-up on a game is a stay.
    expect(h.applied().at(-1)).toMatchObject({ type: 'turn', action: 'stay' });
    expect(h.round.questions[1]?.followUpAsked).toBe(false);
  });

  it('the verdict and the assessment see the game as played', async () => {
    const h = await atGame(() => turn({ action: 'stay', trade: 'buy', quantity: 2 }));
    await h.quote(9.5, 11.5, 2);
    await h.endPad();
    await h.iv.generateQuantAssessment(h.padId);
    const verdict = h.calls.find((c) => taskOf(c.req) === 'verdict');
    const text = JSON.stringify(verdict?.req);
    expect(text).toContain('The game as played');
    expect(text).toContain('they sold 2 at 11.5 (fair 10.5): +1 a contract, +2 in all.');
    expect(text).toContain('this market-making game was closed without a verdict');
    const assessment = h.calls.find((c) => taskOf(c.req) === 'assessment');
    expect(JSON.stringify(assessment?.req)).toContain(
      'A market-making game (type \\"game\\" in the table)',
    );
    expect(h.round.questions[1]?.verdict).not.toBeNull();
  });
});
