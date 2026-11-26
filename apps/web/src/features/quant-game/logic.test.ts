import {
  createGameState,
  gameView,
  postQuote,
  QUANT_GAME_MAX_QUOTES,
  type QuantGameView,
  quoteProblem,
  revealNext,
  settleGame,
  tradeQuote,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import {
  announcement,
  blotter,
  checkDraft,
  dieFace,
  draftOf,
  entryText,
  lastQuote,
  newlyShown,
  num,
  payoffLine,
  positionLabel,
  quoteErrorMessage,
  quoteStatus,
  quotesLeftWarning,
  rulesLine,
  settlementParts,
  shiftMarket,
  signed,
  stepPrice,
  stepSize,
} from './logic';

const DIE = [1, 2, 3, 4, 5, 6];
const GAME = {
  title: 'Sum of three dice',
  components: [
    { label: 'Die 1', faces: DIE },
    { label: 'Die 2', faces: DIE },
    { label: 'Die 3', faces: DIE },
  ],
  payoff: 'sum' as const,
  reveal: [0, 1],
  tick: 0.5,
  maxSize: 5,
};
const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s));

/** A game played by the engine itself, so the views are exactly the server's. */
function play(steps: ((s: ReturnType<typeof createGameState>) => unknown)[]) {
  let state = createGameState(GAME, [6, 2, 5]);
  steps.forEach((f, i) => {
    const out = f(state) as ReturnType<typeof postQuote>;
    if (!out.ok) throw new Error(`step ${i} refused: ${out.reason}`);
    state = out.state;
  });
  return gameView(state);
}
const quote =
  (bid: number, ask: number, size = 1) =>
  (s: Parameters<typeof postQuote>[0]) =>
    postQuote(s, { bid, ask, size }, at(1));
const trade = (side: 'buy' | 'sell', quantity: number) => (s: Parameters<typeof tradeQuote>[0]) =>
  tradeQuote(s, { interviewerSide: side, quantity }, at(2));
const reveal = (s: Parameters<typeof revealNext>[0]) => revealNext(s, at(3));
const settle = (s: Parameters<typeof settleGame>[0]) => settleGame(s, at(4));

describe('numbers', () => {
  it('writes figures as the chat does, with a real minus sign', () => {
    expect(num(10.5)).toBe('10.5');
    expect(num(-3)).toBe('−3');
    expect(num(0.1 + 0.2)).toBe('0.3');
    expect(signed(4.5)).toBe('+4.5');
    expect(signed(-2)).toBe('−2');
    expect(signed(0)).toBe('0');
    expect(signed(-0.0001)).toBe('0');
  });

  it('says the position in words', () => {
    expect(positionLabel(3)).toBe('Long 3');
    expect(positionLabel(-2)).toBe('Short 2');
    expect(positionLabel(0)).toBe('Flat');
  });
});

describe('the contract', () => {
  it('says what it settles at and the rules', () => {
    const v = play([]);
    expect(payoffLine(v)).toBe('Settles at the sum of Die 1, Die 2 and Die 3');
    expect(payoffLine({ ...v, payoff: 'max' })).toBe(
      'Settles at the highest of Die 1, Die 2 and Die 3',
    );
    expect(payoffLine({ ...v, components: [{ label: 'Coin', value: null }] })).toBe(
      'Settles at Coin',
    );
    expect(rulesLine(v)).toBe('Steps of 0.5 · up to 5 lots');
  });

  it('draws a die with pips only when it is one', () => {
    expect(dieFace('Die 1', 6)).toBe(6);
    expect(dieFace('die', 1)).toBe(1);
    expect(dieFace('Die 1', null)).toBeNull();
    expect(dieFace('Die 1', 7)).toBeNull();
    expect(dieFace('Coin', 1)).toBeNull();
    expect(dieFace('Diesel', 3)).toBeNull();
  });

  it('marks components newly shown, none on the first look', () => {
    const hidden = [{ value: null }, { value: null }];
    expect(newlyShown(null, [{ value: 6 }, { value: null }])).toEqual([]);
    expect(newlyShown(hidden, [{ value: 6 }, { value: null }])).toEqual([0]);
    expect(newlyShown([{ value: 6 }, { value: null }], [{ value: 6 }, { value: 2 }])).toEqual([1]);
    expect(newlyShown([{ value: 6 }, { value: 2 }], [{ value: 6 }, { value: 2 }])).toEqual([]);
  });
});

describe('the live quote', () => {
  it('is none before the first market', () => {
    expect(quoteStatus(play([]))).toEqual({ kind: 'none' });
    expect(lastQuote(play([]))).toBeNull();
  });

  it('is working while posted', () => {
    const s = quoteStatus(play([quote(9.5, 11.5, 2)]));
    expect(s.kind).toBe('working');
    if (s.kind === 'working') expect(s.quote).toMatchObject({ bid: 9.5, ask: 11.5, size: 2 });
  });

  it('is traded once the interviewer trades it, from the candidate’s side', () => {
    const v = play([quote(9.5, 11.5, 2), trade('buy', 2)]);
    const s = quoteStatus(v);
    expect(s).toMatchObject({ kind: 'traded', trade: { candidateSide: 'sell', quantity: 2 } });
    if (s.kind === 'traded') expect(s.revealAfter).toBeNull();
    expect(lastQuote(v)).toEqual({ bid: 9.5, ask: 11.5, size: 2 });
  });

  it('says a reveal that followed the trade', () => {
    const s = quoteStatus(play([quote(9.5, 11.5), trade('sell', 1), reveal]));
    expect(s).toMatchObject({ kind: 'traded', revealAfter: { label: 'Die 1', value: 6 } });
  });

  it('is withdrawn when a component is shown on a live market', () => {
    const s = quoteStatus(play([quote(9.5, 11.5), reveal]));
    expect(s).toMatchObject({ kind: 'withdrawn', reveal: { label: 'Die 1', value: 6 } });
  });

  it('is working again after a new market, and settled at the end', () => {
    expect(quoteStatus(play([quote(9.5, 11.5), reveal, quote(12, 14)])).kind).toBe('working');
    expect(quoteStatus(play([quote(9.5, 11.5), settle]))).toMatchObject({
      kind: 'settled',
      settlement: { value: 13 },
    });
  });
});

describe('the blotter', () => {
  it('lists trades with the position after each, and reveals between them, newest first', () => {
    const v = play([
      quote(9.5, 11.5, 2),
      trade('buy', 2),
      reveal,
      quote(12, 13, 3),
      trade('sell', 3),
    ]);
    expect(blotter(v).map((r) => [r.kind, r.text, r.kind === 'trade' ? r.position : null])).toEqual(
      [
        ['trade', 'Bought 3 at 12', 1],
        ['reveal', 'Die 1 shown: 6', null],
        ['trade', 'Sold 2 at 11.5', -2],
      ],
    );
    expect(v.position).toBe(1);
  });

  it('writes every entry of the log', () => {
    const v = play([quote(9.5, 11.5, 1), trade('buy', 1), reveal, settle]);
    expect(v.log.map(entryText)).toEqual([
      'Market 9.5 – 11.5, 1 lot',
      'Sold 1 at 11.5',
      'Die 1 shown: 6',
      'Settled at 13 · P&L −1.5',
    ]);
  });

  it('announces the interviewer’s moves since the last look, not the candidate’s quotes', () => {
    const v = play([quote(9.5, 11.5, 1), trade('buy', 1), reveal]);
    expect(announcement(v, 0)).toBe(
      'You sold 1 at 11.5. Die 1 shown: 6. Your market was withdrawn.',
    );
    expect(announcement(v, 1)).toBe(
      'You sold 1 at 11.5. Die 1 shown: 6. Your market was withdrawn.',
    );
    expect(announcement(v, 3)).toBeNull();
    expect(announcement(play([quote(9.5, 11.5, 1)]), 0)).toBeNull();
  });

  it('shows how the settlement is made up', () => {
    expect(settlementParts(play([]))).toBeNull();
    const short = settlementParts(play([quote(9.5, 11.5, 2), trade('buy', 2), settle]));
    expect(short).toMatchObject({ value: 13, pnl: -3, cash: 23, position: -2 });
    expect(short?.working).toBe('Cash +23, short 2 at 13: −26');
    const long = settlementParts(play([quote(9.5, 11.5, 1), trade('sell', 1), settle]));
    expect(long?.working).toBe('Cash −9.5, long 1 at 13: +13');
    expect(settlementParts(play([settle]))?.working).toBe('Cash 0, flat');
  });

  it('warns only when few quotes are left', () => {
    expect(quotesLeftWarning(QUANT_GAME_MAX_QUOTES)).toBeNull();
    expect(quotesLeftWarning(11)).toBeNull();
    expect(quotesLeftWarning(10)).toBe('10 quotes left for this game');
    expect(quotesLeftWarning(1)).toBe('1 quote left for this game');
    expect(quotesLeftWarning(0)).toBe('No quotes left for this game');
  });
});

describe('the quote form', () => {
  const spec = { tick: 0.5, maxSize: 5 };
  const check = (bid: string, ask: string, size: string) => checkDraft(spec, { bid, ask, size });

  it('accepts a good market, as quoteProblem does', () => {
    expect(check('9.5', '11.5', '2')).toEqual({
      quote: { bid: 9.5, ask: 11.5, size: 2 },
      errors: {},
      missing: {},
    });
    expect(check(' 10 ', '10.5', '5').quote).toEqual({ bid: 10, ask: 10.5, size: 5 });
    expect(check('−1', '.5', '1').quote).toEqual({ bid: -1, ask: 0.5, size: 1 });
  });

  it('says each problem next to its field', () => {
    expect(check('9.3', '11.5', '1').errors).toEqual({ bid: 'Use steps of 0.5' });
    expect(check('9.5', 'x', '1').errors).toEqual({ ask: 'Not a number' });
    expect(check('11.5', '9.5', '1').errors).toEqual({ ask: 'Must be above the bid' });
    expect(check('10', '10', '1').errors).toEqual({ ask: 'Must be above the bid' });
    expect(check('9.5', '11.5', '6').errors).toEqual({ size: 'Whole number, 1 to 5' });
    expect(check('9.5', '11.5', '0').errors).toEqual({ size: 'Whole number, 1 to 5' });
    expect(check('9.5', '11.5', '1.5').errors).toEqual({ size: 'Whole number, 1 to 5' });
    expect(check('2000000', '2000001', '1').errors).toEqual({
      bid: 'Keep within ±1,000,000',
      ask: 'Keep within ±1,000,000',
    });
    // Crossed is said only once both prices are fine on their own.
    expect(check('11.3', '9.5', '1').errors).toEqual({ bid: 'Use steps of 0.5' });
  });

  it('keeps empty fields apart, for when the candidate submits', () => {
    const c = check('', '11.5', '');
    expect(c.quote).toBeNull();
    expect(c.errors).toEqual({});
    expect(c.missing).toEqual({ bid: 'Enter a bid', size: 'Enter a size' });
  });

  it('agrees with quoteProblem on every market it accepts or refuses', () => {
    const prices = ['-1', '0', '0.25', '0.5', '9.5', '10', '10.3', '11.5', 'abc'];
    const sizes = ['0', '1', '3', '5', '6', '2.5'];
    for (const bid of prices)
      for (const ask of prices)
        for (const size of sizes) {
          const c = check(bid, ask, size);
          const problem = quoteProblem(spec, {
            bid: Number(bid),
            ask: Number(ask),
            size: Number(size),
          });
          expect(c.quote !== null, `${bid} / ${ask} × ${size}`).toBe(problem === null);
          expect(Object.keys(c.errors).length > 0, `${bid} / ${ask} × ${size}`).toBe(
            problem !== null,
          );
        }
  });

  it('steps prices by the tick, from the nearest tick in that direction', () => {
    expect(stepPrice('9.5', 1, 0.5)).toBe('10');
    expect(stepPrice('9.5', -1, 0.5)).toBe('9');
    expect(stepPrice('9.3', 1, 0.5)).toBe('9.5');
    expect(stepPrice('9.3', -1, 0.5)).toBe('9');
    expect(stepPrice('0.3', 5, 0.1)).toBe('0.8');
    expect(stepPrice('0', -1, 0.25)).toBe('-0.25');
    expect(stepPrice('', 1, 0.5)).toBe('');
    expect(stepPrice('x', 1, 0.5)).toBe('x');
  });

  it('steps the size within its range', () => {
    expect(stepSize('1', 1, 5)).toBe('2');
    expect(stepSize('5', 1, 5)).toBe('5');
    expect(stepSize('1', -1, 5)).toBe('1');
    expect(stepSize('', 1, 5)).toBe('1');
    expect(stepSize('', -1, 5)).toBe('');
  });

  it('moves the whole market, keeping its width', () => {
    expect(shiftMarket({ bid: '9.5', ask: '11.5', size: '2' }, 1, 0.5)).toEqual({
      bid: '10',
      ask: '12',
      size: '2',
    });
    expect(shiftMarket({ bid: '9.5', ask: '', size: '2' }, -2, 0.5)).toEqual({
      bid: '8.5',
      ask: '',
      size: '2',
    });
  });

  it('starts from a market as the chat writes it', () => {
    expect(draftOf({ bid: 9.5, ask: 11, size: 2 })).toEqual({ bid: '9.5', ask: '11', size: '2' });
  });
});

describe('refusals in words', () => {
  const refused = (code: string, status = 409) => new ApiRequestError(status, code, code);
  const spec = { tick: 0.5, maxSize: 5 };

  it('says each refusal of the round plainly, never as a code', () => {
    const codes = [
      'bad_quote',
      'quote_limit',
      'wrong_index',
      'not_game',
      'ended',
      'pad_ended',
      'wrong_phase',
      'game_settled',
      'wrong_format',
      'validation_error',
    ];
    for (const code of codes) {
      const text = quoteErrorMessage(refused(code), spec);
      expect(text).not.toContain(code);
      expect(text).toMatch(/^[A-Z].*\.$/);
    }
    expect(quoteErrorMessage(refused('wrong_index'))).toBe(
      'That question has just closed, so the market was not posted.',
    );
    expect(quoteErrorMessage(refused('bad_quote'), spec)).toContain('steps of 0.5');
  });

  it('says when to try again after too many', () => {
    expect(quoteErrorMessage(new ApiRequestError(429, 'rate_limited', 'x', 20))).toBe(
      'Too many markets at once. You can quote again in 20s.',
    );
    expect(quoteErrorMessage(new ApiRequestError(0, 'network', 'x'))).toContain(
      'Could not reach the server',
    );
  });

  it('falls back to the server’s message for anything else', () => {
    expect(quoteErrorMessage(new ApiRequestError(500, 'internal', 'Something broke.'))).toBe(
      'Something broke.',
    );
  });
});

// The view type is what the components read; keep the fixtures honest about it.
const _typed: QuantGameView = play([]);
void _typed;
