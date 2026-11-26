/**
 * The pure pieces of the interviewer's side of a market-making game (ARCHITECTURE §8.3): the turn
 * schema's move fields, `normaliseGameMove` / `normaliseTurn` on a game, the facts the platform
 * states, the stream's gate, the books and the review in words.
 */
import {
  advanceRound,
  createGameState,
  createQuantRound,
  gameBooks,
  gameReview,
  postQuote,
  type QuantGameState,
  quantGamePick,
  revealNext,
  settleGame,
  tradeQuote,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  claimsTrade,
  facesText,
  gameBooksLines,
  isPostedQuote,
  moveFacts,
  normaliseGameMove,
  reviewText,
  settleLine,
  withFacts,
} from '../src/quant/game';
import { MessageStream, type StreamGate, TurnJsonReader } from '../src/quant/stream';
import {
  normaliseTurn,
  parseTurn,
  type QuantTurn,
  QuantTurnSchema,
  type TurnBooks,
} from '../src/quant/turn';
import type { QuantGameSlotEntry } from '../src/types';
import { GAME, turn } from './quant-harness';

const T = (s: number) => new Date(Date.parse('2026-11-26T10:00:00.000Z') + s * 1000);
const fresh = () => createGameState(GAME, [6, 2, 5]);
const ok = <S>(r: { ok: true; state: S } | { ok: false; reason: string }): S => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
/** The game with a live quote (bid, ask, size). */
const quoted = (bid: number, ask: number, size = 2, s: QuantGameState = fresh()) =>
  ok(postQuote(s, { bid, ask, size }, T(10)));

const raw = (o: Partial<{ trade: string; quantity: number; reveal: boolean }>) => ({
  trade: 'none',
  quantity: 0,
  reveal: false,
  ...o,
});

describe('the turn schema', () => {
  it('has the move between the action and the message, so the move is decided first', () => {
    const keys = Object.keys(QuantTurnSchema.shape);
    expect(keys).toEqual([
      'reason',
      'action',
      'trade',
      'quantity',
      'reveal',
      'hint_rung',
      'message',
      'score',
      'summary',
      'note',
    ]);
  });

  it('reads a turn without the move fields as a turn with no move', () => {
    const t = parseTurn(
      JSON.stringify({
        reason: 'r',
        action: 'stay',
        hint_rung: 0,
        message: 'Go on.',
        score: 0,
        summary: '',
        note: '',
      }),
    );
    expect(t).toMatchObject({ trade: 'none', quantity: 0, reveal: false, message: 'Go on.' });
    expect(
      parseTurn(turn({ action: 'stay', trade: 'buy', quantity: 2, reveal: true })),
    ).toMatchObject({ trade: 'buy', quantity: 2, reveal: true });
    // A move field of the wrong kind is no move, not an unreadable turn.
    const odd = JSON.parse(turn({ action: 'stay', message: 'Hi' }));
    expect(parseTurn(JSON.stringify({ ...odd, trade: 'hold', reveal: 'yes' }))).toMatchObject({
      trade: 'none',
      reveal: false,
    });
  });
});

describe('normaliseGameMove', () => {
  it('trades only against a live quote, a whole quantity within its size', () => {
    expect(normaliseGameMove(fresh(), raw({ trade: 'buy', quantity: 1 }), false)).toEqual({
      move: {},
      adjusted: ['trade dropped: no live quote'],
    });
    const s = quoted(9.5, 11.5, 3);
    expect(normaliseGameMove(s, raw({ trade: 'sell', quantity: 2 }), false)).toEqual({
      move: { trade: { interviewerSide: 'sell', quantity: 2 } },
      adjusted: [],
    });
    expect(normaliseGameMove(s, raw({ trade: 'buy', quantity: 7 }), false)).toEqual({
      move: { trade: { interviewerSide: 'buy', quantity: 3 } },
      adjusted: ['quantity 7 -> 3'],
    });
    expect(
      normaliseGameMove(s, raw({ trade: 'buy', quantity: 0 }), false).move.trade?.quantity,
    ).toBe(1);
    expect(
      normaliseGameMove(s, raw({ trade: 'buy', quantity: 1.6 }), false).move.trade?.quantity,
    ).toBe(2);
    expect(normaliseGameMove(s, raw({ trade: 'none', quantity: 3 }), false).move).toEqual({});
  });

  it('reveals only what is left, and never on a close', () => {
    expect(normaliseGameMove(fresh(), raw({ reveal: true }), false).move).toEqual({ reveal: true });
    const all = ok(revealNext(ok(revealNext(fresh(), T(1))), T(2)));
    expect(normaliseGameMove(all, raw({ reveal: true }), false)).toEqual({
      move: {},
      adjusted: ['reveal dropped: nothing left to reveal'],
    });
    const s = quoted(9.5, 11.5);
    expect(normaliseGameMove(s, raw({ trade: 'buy', quantity: 1, reveal: true }), true)).toEqual({
      move: { trade: { interviewerSide: 'buy', quantity: 1 } },
      adjusted: ['reveal dropped: the close settles the game'],
    });
  });

  it('every move it lets through is one the engine accepts, on every reachable state', () => {
    // Walk many random games: whatever the model asks for, the normalised move applies.
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let g = 0; g < 200; g++) {
      let s = createGameState(GAME, [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6), 3]);
      for (let k = 0; k < 12; k++) {
        if (rand() < 0.5) {
          const bid = Math.floor(rand() * 30) / 2;
          s = ok(
            postQuote(
              s,
              {
                bid,
                ask: bid + 0.5 + Math.floor(rand() * 6) / 2,
                size: 1 + Math.floor(rand() * 5),
              },
              T(k),
            ),
          );
        }
        const r = raw({
          trade: ['none', 'buy', 'sell', 'hold'][Math.floor(rand() * 4)] as string,
          quantity: Math.floor(rand() * 9) - 2,
          reveal: rand() < 0.4,
        });
        const closing = rand() < 0.1;
        const { move } = normaliseGameMove(s, r, closing);
        if (move.trade) s = ok(tradeQuote(s, move.trade, T(k)));
        if (move.reveal) s = ok(revealNext(s, T(k)));
        if (closing) break;
      }
    }
  });
});

describe('the facts of a move', () => {
  it('are the engine’s figures, in the order the server records them', () => {
    const s = quoted(9.5, 11.5, 2);
    expect(moveFacts(s, { trade: { interviewerSide: 'buy', quantity: 2 } }, false)).toEqual([
      'I buy 2 at your offer of 11.5.',
    ]);
    expect(
      moveFacts(s, { trade: { interviewerSide: 'sell', quantity: 1 }, reveal: true }, false),
    ).toEqual(['I sell 1 at your bid of 9.5.', 'Die 1 shows 6.']);
    expect(moveFacts(fresh(), {}, false)).toEqual([]);
    // A close: the last trade, then the settlement (the candidate sold 2 at 11.5; the dice are 13).
    expect(moveFacts(s, { trade: { interviewerSide: 'buy', quantity: 2 } }, true)).toEqual([
      'I buy 2 at your offer of 11.5.',
      'That settles the game: Die 1 is 6, Die 2 is 2 and Die 3 is 5, so the contract is worth 13. You finish short 2, a loss of 3.',
    ]);
    expect(moveFacts(fresh(), {}, true)).toEqual([
      'That settles the game: Die 1 is 6, Die 2 is 2 and Die 3 is 5, so the contract is worth 13. We made no trades.',
    ]);
    // The settlement line says what the engine settles.
    const long = ok(
      tradeQuote(quoted(9.5, 11.5, 1), { interviewerSide: 'sell', quantity: 1 }, T(11)),
    );
    const settled = ok(settleGame(long, T(12)));
    expect(settled.settlement?.pnl).toBe(3.5);
    expect(settleLine(settled)).toContain('You finish long 1, a profit of 3.5.');
  });

  it('open the posted message; the model’s words follow', () => {
    expect(withFacts(['I buy 2 at your offer of 11.5.'], '  New market? ')).toBe(
      'I buy 2 at your offer of 11.5. New market?',
    );
    expect(withFacts(['A.', 'B.'], '')).toBe('A. B.');
    expect(withFacts([], 'Words.')).toBe('Words.');
  });

  it('words that claim a trade are noticed', () => {
    for (const w of [
      "I'll buy two at 11.5.",
      'I am selling to you.',
      'I lift your offer.',
      'I hit you.',
    ])
      expect(claimsTrade(w), w).toBe(true);
    for (const w of ['What is your new market?', 'Would you buy here?', 'If I bought, what then?'])
      expect(claimsTrade(w), w).toBe(false);
  });
});

describe('normaliseTurn on a game', () => {
  const books = (game: QuantGameState | null): TurnBooks => ({
    hintRungs: [],
    hintsAvailable: 2,
    followUpAsked: false,
    game,
  });
  const out = (o: Partial<QuantTurn> & { action: QuantTurn['action'] }) =>
    parseTurn(turn(o)) as QuantTurn;
  const reply = { forced: null, via: 'text' as const, fallback: null };

  it('ignores a move on a bank question, and notes it', () => {
    expect(
      normaliseTurn(
        out({ action: 'stay', trade: 'buy', quantity: 1, message: 'Hm.' }),
        books(null),
        reply,
      ),
    ).toEqual({ type: 'turn', action: 'stay', say: 'Hm.', adjusted: ['move ignored: not a game'] });
  });

  it('carries the move the books allow on any spoken action, a close included', () => {
    const s = quoted(9.5, 11.5, 2);
    expect(
      normaliseTurn(
        out({ action: 'hint', hint_rung: 1, trade: 'sell', quantity: 5, message: 'Think.' }),
        books(s),
        reply,
      ),
    ).toEqual({
      type: 'turn',
      action: 'hint',
      hintRung: 1,
      say: 'Think.',
      game: { trade: { interviewerSide: 'sell', quantity: 2 } },
      adjusted: ['quantity 5 -> 2'],
    });
    expect(
      normaliseTurn(
        out({
          action: 'close',
          trade: 'buy',
          quantity: 1,
          reveal: true,
          score: 0.7,
          summary: 'S.',
        }),
        books(s),
        reply,
      ),
    ).toMatchObject({
      type: 'close',
      by: 'interviewer',
      game: { trade: { interviewerSide: 'buy', quantity: 1 } },
      adjusted: ['reveal dropped: the close settles the game'],
    });
    // The clock's close keeps a last trade too.
    expect(
      normaliseTurn(out({ action: 'stay', trade: 'buy', quantity: 1 }), books(s), {
        ...reply,
        forced: 'timeout',
      }),
    ).toMatchObject({ type: 'close', by: 'timeout', game: { trade: { quantity: 1 } } });
  });

  it('a move needs no words; a silent turn makes none; follow_up is a stay', () => {
    const s = quoted(9.5, 11.5, 2);
    // A typed message answered with a trade and no words: the facts line is the reply.
    expect(
      normaliseTurn(out({ action: 'stay', trade: 'buy', quantity: 1 }), books(s), reply),
    ).toEqual({
      type: 'turn',
      action: 'stay',
      say: '',
      game: { trade: { interviewerSide: 'buy', quantity: 1 } },
    });
    // …but a trade dropped for want of a quote leaves nothing to say: the canned reply.
    expect(
      normaliseTurn(out({ action: 'stay', trade: 'buy', quantity: 1 }), books(fresh()), reply),
    ).toEqual({ type: 'invalid', why: 'a typed message needs a reply' });
    expect(
      normaliseTurn(out({ action: 'silent', trade: 'buy', quantity: 1 }), books(s), {
        ...reply,
        via: 'voice',
      }),
    ).toEqual({ type: 'silent', adjusted: ['move dropped: the turn says nothing'] });
    expect(
      normaliseTurn(out({ action: 'follow_up', message: 'And now?' }), books(s), reply),
    ).toMatchObject({ type: 'turn', action: 'stay' });
    // The nudge with a move and no words still says its line.
    expect(
      normaliseTurn(out({ action: 'stay', reveal: true }), books(s), {
        forced: null,
        via: null,
        fallback: 'One last market.',
      }),
    ).toMatchObject({ type: 'turn', say: 'One last market.', game: { reveal: true } });
  });
});

describe('the stream gate', () => {
  /** A gate like the pump's, on `state`: no reveal, no close, a known head; the trade's facts first. */
  const gate =
    (state: QuantGameState): StreamGate =>
    (head) => {
      if (head.action === 'close') return null;
      if (head.trade === null || head.quantity === null || head.reveal === null) return null;
      const { move } = normaliseGameMove(
        state,
        { trade: head.trade, quantity: head.quantity, reveal: head.reveal },
        false,
      );
      if (move.reveal) return null;
      return moveFacts(state, move, false).join(' ');
    };
  const streamed = (raw: string, g: StreamGate | null, cut = 7) => {
    const m = new MessageStream(g);
    let out = '';
    for (let i = 0; i < raw.length; i += cut) out += m.push(raw.slice(i, i + cut));
    return { out, text: m.text };
  };

  it('reads the move fields before the message', () => {
    const r = new TurnJsonReader();
    const t = turn({ action: 'stay', trade: 'sell', quantity: 3, reveal: true, message: 'x' });
    r.push(t.slice(0, t.indexOf('"message":"') + 11));
    expect([r.action, r.trade, r.scalars.quantity, r.scalars.reveal]).toEqual([
      'stay',
      'sell',
      '3',
      'true',
    ]);
    expect(r.messageStarted).toBe(true);
  });

  it('shows the facts of a trade, then the words; nothing for a reveal or a close', () => {
    const s = quoted(9.5, 11.5, 2);
    const trade = turn({
      action: 'stay',
      trade: 'buy',
      quantity: 2,
      message: 'Your position now?',
    });
    for (const cut of [1, 3, 7, 40]) {
      const { out, text } = streamed(trade, gate(s), cut);
      expect(out).toBe('I buy 2 at your offer of 11.5. Your position now?');
      expect(text).toBe(out);
    }
    // What is streamed is what is posted.
    const move = normaliseTurn(
      parseTurn(trade) as QuantTurn,
      { hintRungs: [], hintsAvailable: 0, followUpAsked: false, game: s },
      { forced: null, via: 'text', fallback: null },
    );
    if (move.type !== 'turn') throw new Error('turn');
    expect(withFacts(moveFacts(s, move.game ?? {}, false), move.say)).toBe(
      'I buy 2 at your offer of 11.5. Your position now?',
    );
    expect(
      streamed(turn({ action: 'stay', reveal: true, message: 'New market?' }), gate(s)).out,
    ).toBe('');
    expect(
      streamed(turn({ action: 'close', message: 'Thanks.', score: 1, summary: 'S' }), gate(s)).out,
    ).toBe('');
    // No move: the words alone, as on a bank question.
    expect(streamed(turn({ action: 'stay', message: 'Tighter?' }), gate(s)).out).toBe('Tighter?');
    expect(streamed(turn({ action: 'stay', message: 'Tighter?' }), null).out).toBe('Tighter?');
    // A trade with no words streams the facts alone.
    expect(streamed(turn({ action: 'stay', trade: 'sell', quantity: 1 }), gate(s)).out).toBe(
      'I sell 1 at your bid of 9.5.',
    );
  });

  it('waits for the message to begin, and hides it when the move comes after it', () => {
    const m = new MessageStream(gate(quoted(9.5, 11.5)));
    expect(m.push('{"reason":"r","action":"stay","trade":"buy",')).toBe('');
    expect(m.push('"quantity":1,"reveal":false,"hint_rung":0,"message":"Go')).toBe(
      'I buy 1 at your offer of 11.5. Go',
    );
    const late = new MessageStream(gate(quoted(9.5, 11.5)));
    expect(
      late.push('{"action":"stay","message":"Go on","trade":"buy","quantity":1,"reveal":false}'),
    ).toBe('');
  });
});

describe('the books and the review in words', () => {
  const T0 = Date.parse('2026-11-26T10:00:00.000Z');
  const slot = (state: QuantGameState): QuantGameSlotEntry => ({
    kind: 'game',
    index: 1,
    game: {
      id: GAME.id,
      topic: GAME.topic,
      title: GAME.title,
      difficulty: GAME.difficulty,
      prompt: GAME.prompt,
      counterparty: GAME.counterparty,
      hints: GAME.hints,
      explanation: GAME.explanation,
      mechanics: state.spec,
    },
    books: gameBooks(state),
    state,
    hintRungs: [],
    followUpAsked: false,
  });

  it('state every figure from the books, with the sign convention', () => {
    const s = quoted(9.5, 12, 2);
    const text = gameBooksLines(slot(s), T0, T0 + 40_000).join('\n');
    expect(text).toContain(
      'Die 1 = 6 (hidden; the next reveal); Die 2 = 2 (hidden; revealed later); Die 3 = 5 (hidden until the settlement)',
    );
    expect(text).toContain(
      'Public fair value now (given what has been shown): 10.5, standard deviation 2.96, range 3 to 18',
    );
    expect(text).toContain('True value (the contract settles at it): 13.');
    expect(text).toContain(
      'Live quote: 9.5 bid, 12 offered, 2 lots, posted [00:10], 30 s ago. Mid 10.75, width 2.5 (0.85 standard deviations); the public fair value is inside it.',
    );
    // Selling at the bid: bid − value; buying at the offer: value − offer (the interviewer's).
    expect(text).toContain(
      'trade "sell" (you hit their bid: you sell at 9.5, they buy): your edge per contract is bid minus value: -1 against the public fair value, -3.5 against the true value.',
    );
    expect(text).toContain(
      'trade "buy" (you lift their offer: you buy at 12, they sell): your edge per contract is value minus offer: -1.5 against the public fair value, +1 against the true value.',
    );
    expect(text).toContain('Edges are YOURS');
    expect(text).toContain(
      'Next reveal: Die 1, which is 6; after it the public fair value would be 13 (standard deviation 2.42).',
    );
    expect(text).toContain('Stage 1 (0 reveals so far). This stage: 1 market posted, 0 traded');
    // After a trade and a reveal: no quote, the position, the log, the next stage.
    const t = ok(
      revealNext(ok(tradeQuote(s, { interviewerSide: 'buy', quantity: 2 }, T(20))), T(20)),
    );
    const after = gameBooksLines(slot(t), T0, T0 + 60_000).join('\n');
    expect(after).toContain('Live quote: none. You cannot trade now');
    expect(after).toContain(
      'Candidate: short 2, cash +24; marked to the public fair value -2, to the true value -2',
    );
    expect(after).toContain('you bought 2 at their offer of 12 (they sold)');
    expect(after).toContain('Die 1 was revealed: 6');
    expect(after).toContain('Stage 2 (1 reveal so far). This stage: 0 markets posted, 0 traded');
    expect(after).toContain('The whole game: 1 markets, 1 trades; you bought 2 and sold 0 in all.');
    const done = ok(revealNext(t, T(30)));
    expect(gameBooksLines(slot(done), T0, T0).join('\n')).toContain('Nothing is left to reveal');
  });

  it('the review: quotes, trades with the candidate’s edge, reveals, risk and P&L', () => {
    let s = quoted(9.5, 11.5, 2);
    s = ok(tradeQuote(s, { interviewerSide: 'buy', quantity: 2 }, T(20)));
    s = ok(revealNext(s, T(25)));
    s = ok(postQuote(s, { bid: 12, ask: 14, size: 1 }, T(40)));
    s = ok(settleGame(s, T(60)));
    const text = reviewText(gameReview(s), Date.parse('2026-11-26T10:00:00.000Z'));
    expect(text).toContain('the contract is worth 13');
    expect(text).toContain(
      '1. [00:10] 9.5 bid, 11.5 offered, 2 lots: mid 10.5 against fair 10.5 (off by 0), width 2 (0.68 sd), fair inside; traded.',
    );
    expect(text).toContain('they sold 2 at 11.5 (fair 10.5): +1 a contract, +2 in all.');
    expect(text).toContain('Die 1 showed 6: fair 10.5 -> 13; their mid 10.5 before, 13 after.');
    expect(text).toContain('Expected edge of their trades in all +2; realised P&L -3');
  });

  it('a quote is one posted through the quote box: its exact text, at its time', () => {
    const s = quoted(9.5, 11.5, 2);
    const at = T(10).toISOString();
    expect(isPostedQuote({ text: '9.5 bid, 11.5 offered, 2 lots', createdAt: at }, s)).toBe(true);
    expect(
      isPostedQuote({ text: '9.5 bid, 11.5 offered, 2 lots', createdAt: T(40).toISOString() }, s),
    ).toBe(false);
    expect(isPostedQuote({ text: '9.5 at 11.5, two lots', createdAt: at }, s)).toBe(false);
  });

  it('describes faces in words', () => {
    expect(facesText([1, 2, 3, 4, 5, 6])).toBe('uniform on 1 to 6');
    expect(facesText([0, 1])).toBe('0 or 1, equally likely');
    expect(facesText([1, 2, 10, 10])).toBe('one of 4 equally likely faces: 1, 2, 10, 10');
  });

  it('the round helper places the game where asked (a sanity check of the fixtures)', () => {
    const pick = quantGamePick(GAME, 'Market making', () => 0.99);
    const r = createQuantRound('trader', 20, [pick]);
    const a = advanceRound(
      r,
      { type: 'start', version: 0, say: null },
      {
        version: 0,
        now: T(0),
        roundEndsAt: T(1200),
        newId: () => 'm1',
      },
    );
    expect(a.ok).toBe(true);
  });
});
