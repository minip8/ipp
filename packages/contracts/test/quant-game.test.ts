import { describe, expect, it } from 'vitest';
import {
  candidateSideOf,
  createGameState,
  drawGame,
  formatGameNumber,
  formatQuote,
  gameBooks,
  gameConditional,
  gameFair,
  gameReview,
  gameSolution,
  gameStats,
  gameTrades,
  gameValue,
  gameView,
  PostQuantQuoteRequest,
  postQuote,
  QUANT_GAME_MAX_QUOTES,
  QUANT_GAME_PRICE_MAX,
  QuantGame,
  type QuantGameAdvance,
  type QuantGameMechanics,
  QuantGameMechanics as QuantGameMechanicsSchema,
  QuantGameReview,
  type QuantGameState,
  QuantGameState as QuantGameStateSchema,
  QuantGameView,
  quoteProblem,
  revealNext,
  settleGame,
  tradeQuote,
} from '../src';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000);
const DIE = [1, 2, 3, 4, 5, 6];

const mech = (over: Partial<QuantGameMechanics> = {}): QuantGameMechanics & { title: string } => ({
  title: 'Three dice',
  components: [
    { label: 'Die 1', faces: DIE },
    { label: 'Die 2', faces: DIE },
    { label: 'Die 3', faces: DIE },
  ],
  payoff: 'sum',
  reveal: [0, 1],
  tick: 0.5,
  maxSize: 5,
  ...over,
});
const twoDice = (payoff: QuantGameMechanics['payoff']) =>
  mech({
    payoff,
    components: [
      { label: 'A', faces: DIE },
      { label: 'B', faces: DIE },
    ],
    reveal: [0],
  });

/** Applies a transition, failing the test on a refusal. */
function ok(res: QuantGameAdvance): QuantGameState {
  if (!res.ok) throw new Error(`refused: ${res.reason}`);
  expect(() => QuantGameStateSchema.parse(res.state)).not.toThrow();
  return res.state;
}
const refused = (res: QuantGameAdvance) => (res.ok ? 'accepted' : res.reason);

/** Every outcome, weighted, by brute force: what the closed forms must agree with. */
function enumerate(spec: QuantGameMechanics, values: number[], revealed: number) {
  const shown = new Set(spec.reveal.slice(0, revealed));
  const comps = spec.components.map((c, i) =>
    shown.has(i) ? [values[i] as number] : (c.faces as number[]),
  );
  let outcomes: { v: number[]; p: number }[] = [{ v: [], p: 1 }];
  for (const faces of comps)
    outcomes = outcomes.flatMap((o) =>
      faces.map((f) => ({ v: [...o.v, f], p: o.p / faces.length })),
    );
  const xs = outcomes.map((o) => ({ x: gameValue(spec, o.v), p: o.p }));
  const fair = xs.reduce((s, o) => s + o.x * o.p, 0);
  const sd = Math.sqrt(xs.reduce((s, o) => s + (o.x - fair) ** 2 * o.p, 0));
  return {
    fair,
    sd,
    min: Math.min(...xs.map((o) => o.x)),
    max: Math.max(...xs.map((o) => o.x)),
  };
}

const close = (a: number, b: number) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));

/** Small deterministic PRNG (mulberry32), so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- fair values

describe('gameStats and gameConditional', () => {
  it('three dice: 10.5, sd about 2.958, 3 to 18; after a 6 is shown, 13', () => {
    const s = gameStats(mech());
    expect(s.fair).toBe(10.5);
    expect(s.sd).toBeCloseTo(Math.sqrt(35 / 4), 10);
    expect(s.sd).toBeCloseTo(2.958, 3);
    expect([s.min, s.max]).toEqual([3, 18]);
    expect(gameFair(mech(), [6, 1, 1], 1)).toBe(13);
    expect(gameConditional(mech(), [6, 2, 1], 2)).toMatchObject({ fair: 11.5, min: 9, max: 14 });
    // Nothing shown is the unconditional figure; a reveal count past the order shows no more.
    expect(gameConditional(mech(), [6, 2, 1], 0)).toEqual(s);
    expect(gameFair(mech(), [6, 2, 1], 5)).toBe(11.5);
  });

  it('the product, maximum and minimum of two dice', () => {
    const product = gameStats(twoDice('product'));
    expect(product.fair).toBe(12.25);
    expect(product.sd).toBeCloseTo(Math.sqrt((91 / 6) ** 2 - 12.25 ** 2), 9);
    expect([product.min, product.max]).toEqual([1, 36]);
    expect(gameFair(twoDice('product'), [4, 1], 1)).toBe(14);

    const max = gameStats(twoDice('max'));
    close(max.fair, 161 / 36);
    close(max.sd, Math.sqrt(791 / 36 - (161 / 36) ** 2));
    expect([max.min, max.max]).toEqual([1, 6]);
    // A 3 shown: max(3, B) is 3 with probability 1/2, else 4..6.
    close(gameFair(twoDice('max'), [3, 1], 1), (3 * 3 + 4 + 5 + 6) / 6);

    const min = gameStats(twoDice('min'));
    close(min.fair, 91 / 36);
    expect([min.min, min.max]).toEqual([1, 6]);
  });

  it('agrees with enumerating every outcome, for any payoff, faces and reveals', () => {
    const rand = rng(7);
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rand() * 4);
      const components = Array.from({ length: n }, (_, i) => ({
        label: `C${i}`,
        // Decimals, negatives, zero and repeated faces (a weighted component).
        faces: Array.from(
          { length: 2 + Math.floor(rand() * 5) },
          () => Math.round((rand() * 20 - 8) * 4) / 4,
        ),
      }));
      const reveal = [...Array(n).keys()].filter(() => rand() < 0.6);
      const payoff = (['sum', 'product', 'max', 'min'] as const)[Math.floor(rand() * 4)] as
        | 'sum'
        | 'product'
        | 'max'
        | 'min';
      const spec = mech({ components, reveal, payoff });
      const values = drawGame(spec, rand);
      for (let k = 0; k <= reveal.length; k++) {
        const got = gameConditional(spec, values, k);
        const want = enumerate(spec, values, k);
        const tol = (x: number) => 1e-8 * Math.max(1, Math.abs(x));
        for (const key of ['fair', 'sd', 'min', 'max'] as const)
          expect(Math.abs(got[key] - want[key]), `${trial} ${payoff} ${key}`).toBeLessThanOrEqual(
            tol(want[key]),
          );
      }
    }
  });

  it('gameValue, and drawGame from a PRNG', () => {
    expect(gameValue(mech(), [6, 5, 4])).toBe(15);
    expect(gameValue(twoDice('product'), [6, 5])).toBe(30);
    expect(gameValue(twoDice('max'), [2, 5])).toBe(5);
    expect(gameValue(twoDice('min'), [2, 5])).toBe(2);
    expect(gameValue(mech({ payoff: 'sum' }), [0.1, 0.2, 0])).toBe(0.3);
    const values = drawGame(mech(), rng(1));
    expect(values).toHaveLength(3);
    for (const v of values) expect(DIE).toContain(v);
    expect(drawGame(mech(), rng(1))).toEqual(values);
    // The edges of the generator's range, and a broken one, stay on the faces.
    expect(drawGame(mech(), () => 0)).toEqual([1, 1, 1]);
    expect(drawGame(mech(), () => 0.9999999999)).toEqual([6, 6, 6]);
    expect(drawGame(mech(), () => 1)).toEqual([6, 6, 6]);
    expect(drawGame(mech(), () => Number.NaN)).toEqual([1, 1, 1]);
  });
});

// ---------------------------------------------------------------- content schema

describe('QuantGame and QuantGameMechanics', () => {
  const content = {
    id: 'mm-test',
    topic: 'betting-market-making',
    title: 'Three dice',
    difficulty: 'easy',
    prompt: 'Make me a market on the sum of three dice.',
    components: mech().components,
    payoff: 'sum',
    reveal: [0, 1],
    tick: 0.5,
    maxSize: 5,
    counterparty: 'Uninformed at first.',
    explanation: 'Fair is 10.5.',
    expect: { fair: 10.5, sd: 2.958, min: 3, max: 18 },
  };
  const issues = (over: object) => {
    const r = QuantGame.safeParse({ ...content, ...over });
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('parses a game, keeping exact figures as text', () => {
    const g = QuantGame.parse({
      ...content,
      expect: { fair: '161/36', sd: 1.404, min: 1, max: 6 },
    });
    expect(g.expect).toEqual({ fair: '161/36', sd: 1.404, min: '1', max: '6' });
    expect(g.hints).toEqual([]);
  });

  it('refuses mechanics it cannot play', () => {
    expect(issues({ reveal: [0, 3] })).toEqual(['no component 3']);
    expect(issues({ reveal: [1, 1] })).toEqual(['component 1 twice']);
    expect(issues({ tick: 0.0005 }).length).toBeGreaterThan(0);
    expect(issues({ tick: 0.0015 })).toEqual(['a tick is a whole multiple of 0.001']);
    expect(issues({ maxSize: 0 }).length).toBeGreaterThan(0);
    expect(issues({ components: [] }).length).toBeGreaterThan(0);
    expect(issues({ components: [{ label: 'x', faces: [1] }] }).length).toBeGreaterThan(0);
    expect(issues({ components: [{ label: 'x', faces: [2, 2] }], reveal: [0] })).toEqual([
      'the contract has one value',
    ]);
    const many = Array.from({ length: 7 }, (_, i) => ({ label: `D${i}`, faces: DIE }));
    expect(issues({ components: many, reveal: [] })[0]).toMatch(/279936 outcomes/);
    const big = [
      { label: 'x', faces: [1, 90_000] },
      { label: 'y', faces: [1, 2] },
    ];
    expect(issues({ components: big, payoff: 'product', reveal: [] })[0]).toMatch(/±100000/);
    expect(
      issues({ components: [{ label: 'x', faces: [1, Number.NaN] }], reveal: [] }).length,
    ).toBe(1);
    expect(issues({ expect: { ...content.expect, fair: 'ten' } }).length).toBe(1);
    // The snapshot schema has the same rules.
    expect(QuantGameMechanicsSchema.safeParse({ ...mech(), reveal: [5] }).success).toBe(false);
    expect(QuantGameMechanicsSchema.safeParse(mech()).success).toBe(true);
  });
});

// ---------------------------------------------------------------- transitions

describe('quotes', () => {
  const game = (over: Partial<QuantGameMechanics> = {}) => createGameState(mech(over), [6, 2, 5]);

  it('a quote replaces the live one and is snapped to the tick', () => {
    let s = game();
    s = ok(postQuote(s, { bid: 9.5, ask: 11.5, size: 1 }, at(1)));
    expect(s.quote).toEqual({ bid: 9.5, ask: 11.5, size: 1, at: at(1).toISOString() });
    s = ok(postQuote(s, { bid: 10, ask: 11, size: 5 }, at(2)));
    expect(s.quote).toMatchObject({ bid: 10, ask: 11, size: 5 });
    expect(s.events.map((e) => e.kind)).toEqual(['quote', 'quote']);
  });

  it('decimal ticks do not fail on floating point', () => {
    const tenth = game({ tick: 0.1 });
    const s = ok(postQuote(tenth, { bid: 0.1 + 0.2, ask: 0.7, size: 1 }, at(1)));
    expect(s.quote).toMatchObject({ bid: 0.3, ask: 0.7 });
    expect(ok(postQuote(tenth, { bid: -0.3, ask: 1.1, size: 1 }, at(1))).quote?.bid).toBe(-0.3);
    expect(ok(postQuote(tenth, { bid: 10.3, ask: 10.4, size: 1 }, at(1))).quote?.ask).toBe(10.4);
    expect(refused(postQuote(tenth, { bid: 10.35, ask: 10.4, size: 1 }, at(1)))).toBe('bad_quote');
    const quarter = game({ tick: 0.25 });
    expect(ok(postQuote(quarter, { bid: 10.25, ask: 10.75, size: 1 }, at(1))).quote).toMatchObject({
      bid: 10.25,
      ask: 10.75,
    });
    expect(quoteProblem(quarter.spec, { bid: 10.3, ask: 10.75, size: 1 })).toBe('off_tick');
    const nickel = game({ tick: 0.05 });
    expect(quoteProblem(nickel.spec, { bid: 1.15, ask: 1.2, size: 1 })).toBeNull();
    expect(quoteProblem(nickel.spec, { bid: 1.15, ask: 1.21, size: 1 })).toBe('off_tick');
    expect(
      quoteProblem(game({ tick: 0.001 }).spec, { bid: 0.007, ask: 0.009, size: 1 }),
    ).toBeNull();
  });

  it('every quote problem, in the order they are checked', () => {
    const spec = game().spec;
    const p = (bid: unknown, ask: unknown, size: unknown) => quoteProblem(spec, { bid, ask, size });
    expect(p(9.5, 11.5, 1)).toBeNull();
    expect(p(Number.NaN, 11.5, 1)).toBe('not_finite');
    expect(p(9.5, Number.POSITIVE_INFINITY, 1)).toBe('not_finite');
    expect(p(9.5, 11.5, Number.NaN)).toBe('not_finite');
    expect(p('9.5', 11.5, 1)).toBe('not_finite');
    expect(p(9.5, QUANT_GAME_PRICE_MAX + 0.5, 1)).toBe('out_of_range');
    expect(p(-QUANT_GAME_PRICE_MAX - 0.5, 11.5, 1)).toBe('out_of_range');
    expect(p(-QUANT_GAME_PRICE_MAX, QUANT_GAME_PRICE_MAX, 1)).toBeNull();
    expect(p(9.4, 11.5, 1)).toBe('off_tick');
    expect(p(11.5, 11.5, 1)).toBe('crossed');
    expect(p(12, 11.5, 1)).toBe('crossed');
    expect(p(9.5, 11.5, 0)).toBe('size');
    expect(p(9.5, 11.5, 6)).toBe('size');
    expect(p(9.5, 11.5, 1.5)).toBe('size');
    expect(p(9.5, 11.5, 5)).toBeNull();
    for (const bad of [
      { bid: 11.5, ask: 11.5, size: 1 },
      { bid: 9.5, ask: 11.5, size: 0 },
      { bid: 9.4, ask: 11.5, size: 1 },
    ])
      expect(refused(postQuote(game(), bad, at(1)))).toBe('bad_quote');
  });

  it('at most QUANT_GAME_MAX_QUOTES quotes, so the log cannot grow without bound', () => {
    let s = game();
    for (let i = 0; i < QUANT_GAME_MAX_QUOTES; i++)
      s = ok(postQuote(s, { bid: 9.5, ask: 11.5, size: 1 }, at(i)));
    expect(gameView(s).quotesLeft).toBe(0);
    expect(refused(postQuote(s, { bid: 9.5, ask: 11.5, size: 1 }, at(999)))).toBe('quote_limit');
    // Trading, revealing and settling still work.
    s = ok(tradeQuote(s, { interviewerSide: 'buy', quantity: 1 }, at(1000)));
    s = ok(revealNext(s, at(1001)));
    s = ok(settleGame(s, at(1002)));
    expect(s.events.length).toBe(QUANT_GAME_MAX_QUOTES + 3);
  });
});

describe('trades, reveals and settlement', () => {
  const start = () => createGameState(mech(), [6, 2, 5]);

  it('position and cash from the candidate’s side through trades on both sides', () => {
    let s = start();
    s = ok(postQuote(s, { bid: 9.5, ask: 11.5, size: 2 }, at(1)));
    // The interviewer buys: lifts the offer, so the candidate sells 2 at 11.5.
    const lifted = tradeQuote(s, { interviewerSide: 'buy', quantity: 2 }, at(2));
    s = ok(lifted);
    expect(lifted.ok && lifted.entry).toEqual({
      kind: 'trade',
      at: at(2).toISOString(),
      candidateSide: 'sell',
      price: 11.5,
      quantity: 2,
    });
    expect([s.position, s.cash, s.quote]).toEqual([-2, 23, null]);
    expect(s.events.at(-1)).toMatchObject({ kind: 'trade', interviewerSide: 'buy', price: 11.5 });
    // The quote was consumed.
    expect(refused(tradeQuote(s, { interviewerSide: 'buy', quantity: 1 }, at(3)))).toBe('no_quote');
    s = ok(postQuote(s, { bid: 10, ask: 11, size: 3 }, at(4)));
    // The interviewer sells: hits the bid, so the candidate buys 3 at 10.
    s = ok(tradeQuote(s, { interviewerSide: 'sell', quantity: 3 }, at(5)));
    expect([s.position, s.cash]).toEqual([1, -7]);
    expect(candidateSideOf('buy')).toBe('sell');
    expect(candidateSideOf('sell')).toBe('buy');
    expect(gameTrades(gameView(s)).map((t) => [t.candidateSide, t.price, t.quantity])).toEqual([
      ['sell', 11.5, 2],
      ['buy', 10, 3],
    ]);
  });

  it('a partial fill still consumes the quote; quantities must be whole and within the size', () => {
    let s = ok(postQuote(start(), { bid: 9.5, ask: 11.5, size: 3 }, at(1)));
    const t = (quantity: number) => tradeQuote(s, { interviewerSide: 'sell', quantity }, at(2));
    expect(refused(t(0))).toBe('bad_quantity');
    expect(refused(t(4))).toBe('bad_quantity');
    expect(refused(t(1.5))).toBe('bad_quantity');
    expect(refused(t(Number.NaN))).toBe('bad_quantity');
    expect(refused(tradeQuote(s, { interviewerSide: 'hold' as 'buy', quantity: 1 }, at(2)))).toBe(
      'invalid',
    );
    s = ok(t(1));
    expect([s.position, s.cash, s.quote]).toEqual([1, -9.5, null]);
  });

  it('cash stays exact on decimal ticks', () => {
    let s = createGameState(mech({ tick: 0.1 }), [6, 2, 5]);
    for (let i = 0; i < 3; i++) {
      s = ok(postQuote(s, { bid: 0.1, ask: 0.2, size: 1 }, at(i)));
      s = ok(tradeQuote(s, { interviewerSide: 'sell', quantity: 1 }, at(i)));
    }
    expect([s.position, s.cash]).toEqual([3, -0.3]);
    s = ok(settleGame(s, at(10)));
    expect(s.settlement).toEqual({ at: at(10).toISOString(), value: 13, pnl: 38.7 });
  });

  it('reveals follow the order, withdraw the quote, and run out', () => {
    let s = ok(postQuote(start(), { bid: 9.5, ask: 11.5, size: 1 }, at(1)));
    const first = revealNext(s, at(2));
    s = ok(first);
    expect(first.ok && first.entry).toEqual({
      kind: 'reveal',
      at: at(2).toISOString(),
      component: 0,
      label: 'Die 1',
      value: 6,
    });
    expect([s.revealed, s.quote]).toEqual([1, null]);
    s = ok(revealNext(s, at(3)));
    expect(refused(revealNext(s, at(4)))).toBe('nothing_to_reveal');
    // No reveal order at all: nothing is ever shown before the settlement.
    expect(refused(revealNext(createGameState(mech({ reveal: [] }), [1, 2, 3]), at(1)))).toBe(
      'nothing_to_reveal',
    );
    // An order other than the components'.
    const reversed = ok(revealNext(createGameState(mech({ reveal: [2, 0] }), [1, 2, 3]), at(1)));
    expect(gameView(reversed).components.map((c) => c.value)).toEqual([null, null, 3]);
  });

  it('settlement: P&L is cash + position × value; nothing moves afterwards', () => {
    let s = ok(postQuote(start(), { bid: 9.5, ask: 11.5, size: 2 }, at(1)));
    s = ok(tradeQuote(s, { interviewerSide: 'buy', quantity: 2 }, at(2))); // -2, +23
    s = ok(postQuote(s, { bid: 10, ask: 11, size: 1 }, at(3)));
    s = ok(settleGame(s, at(4)));
    expect(s.settlement).toEqual({ at: at(4).toISOString(), value: 13, pnl: 23 - 2 * 13 });
    expect(s.quote).toBeNull();
    const q = { bid: 9.5, ask: 11.5, size: 1 };
    expect(refused(postQuote(s, q, at(5)))).toBe('game_settled');
    expect(refused(tradeQuote(s, { interviewerSide: 'buy', quantity: 1 }, at(5)))).toBe(
      'game_settled',
    );
    expect(refused(revealNext(s, at(5)))).toBe('game_settled');
    expect(refused(settleGame(s, at(5)))).toBe('game_settled');
    // A game nobody traded settles flat.
    expect(ok(settleGame(start(), at(1))).settlement?.pnl).toBe(0);
  });

  it('never modifies its input', () => {
    const s = ok(postQuote(start(), { bid: 9.5, ask: 11.5, size: 2 }, at(1)));
    const frozen = structuredClone(s);
    const deepFreeze = (o: object) => {
      Object.freeze(o);
      for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
    };
    deepFreeze(s);
    ok(tradeQuote(s, { interviewerSide: 'buy', quantity: 1 }, at(2)));
    ok(revealNext(s, at(2)));
    ok(settleGame(s, at(2)));
    ok(postQuote(s, { bid: 9, ask: 12, size: 1 }, at(2)));
    expect(s).toEqual(frozen);
  });

  it('createGameState copies only the mechanics, and refuses values that do not fit', () => {
    const authored = QuantGame.parse({
      id: 'mm-x',
      topic: 'betting-market-making',
      title: 'X',
      difficulty: 'easy',
      prompt: 'p',
      ...mech(),
      counterparty: 'COUNTERPARTY-SECRET',
      hints: ['HINT-SECRET'],
      explanation: 'EXPLANATION-SECRET',
      expect: { fair: 10.5, sd: 2.958, min: 3, max: 18 },
    });
    const s = createGameState(authored, [1, 2, 3]);
    expect(JSON.stringify(s)).not.toMatch(/SECRET|expect/);
    expect(Object.keys(s.spec).sort()).toEqual([
      'components',
      'maxSize',
      'payoff',
      'reveal',
      'tick',
    ]);
    expect(() => createGameState(mech(), [1, 2])).toThrow();
    expect(() => createGameState(mech(), [1, 2, 7])).toThrow();
  });
});

// ---------------------------------------------------------------- what each side sees

describe('gameView', () => {
  // Faces nobody would write by accident, so a leak shows up in the serialised view.
  const odd = mech({
    tick: 1,
    components: [
      { label: 'Die 1', faces: [1001, 2002, 3003] },
      { label: 'Die 2', faces: [4004, 5005, 6006] },
      { label: 'Die 3', faces: [7007, 8008, 9009] },
    ],
    reveal: [1],
  });
  const fresh = () => createGameState(odd, [2002, 6006, 9009]);

  it('shows no hidden value, fair value or mark before the settlement', () => {
    let s = ok(postQuote(fresh(), { bid: 15000, ask: 16000, size: 2 }, at(1)));
    s = ok(tradeQuote(s, { interviewerSide: 'sell', quantity: 2 }, at(2)));
    const hidden = (view: unknown) => {
      const json = JSON.stringify(view);
      expect(json).not.toMatch(/"(values|fair|sd|markToFair|markToValue|interviewerSide|spec)"/);
      // The fair value now (15015) and the true value (17017), however written.
      expect(json).not.toContain('15015');
      expect(json).not.toContain('17017');
      return json;
    };
    let json = hidden(gameView(s));
    for (const v of ['2002', '6006', '9009']) expect(json).not.toContain(v);
    s = ok(revealNext(s, at(3)));
    json = hidden(gameView(s));
    expect(json).toContain('6006');
    for (const v of ['2002', '9009']) expect(json).not.toContain(v);
    expect(gameView(s).components).toEqual([
      { label: 'Die 1', value: null },
      { label: 'Die 2', value: 6006 },
      { label: 'Die 3', value: null },
    ]);
    // Once settled, everything is shown.
    s = ok(settleGame(s, at(4)));
    expect(gameView(s).components.map((c) => c.value)).toEqual([2002, 6006, 9009]);
    expect(gameView(s).settlement).toEqual({ at: at(4).toISOString(), value: 17017, pnl: 4034 });
  });

  it('has exactly the fields of its schema', () => {
    let s = ok(postQuote(fresh(), { bid: 15000, ask: 16000, size: 2 }, at(1)));
    s = ok(tradeQuote(s, { interviewerSide: 'buy', quantity: 1 }, at(2)));
    s = ok(postQuote(s, { bid: 15001, ask: 15999, size: 1 }, at(3)));
    const view = gameView(s);
    expect(QuantGameView.parse(view)).toEqual(view);
    expect(Object.keys(view).sort()).toEqual(Object.keys(QuantGameView.shape).sort());
    expect(view).toEqual({
      title: 'Three dice',
      components: [
        { label: 'Die 1', value: null },
        { label: 'Die 2', value: null },
        { label: 'Die 3', value: null },
      ],
      payoff: 'sum',
      tick: 1,
      maxSize: 5,
      quote: { bid: 15001, ask: 15999, size: 1, at: at(3).toISOString() },
      log: [
        { kind: 'quote', at: at(1).toISOString(), bid: 15000, ask: 16000, size: 2 },
        {
          kind: 'trade',
          at: at(2).toISOString(),
          candidateSide: 'sell',
          price: 16000,
          quantity: 1,
        },
        { kind: 'quote', at: at(3).toISOString(), bid: 15001, ask: 15999, size: 1 },
      ],
      position: -1,
      cash: 16000,
      settlement: null,
      quotesLeft: QUANT_GAME_MAX_QUOTES - 2,
    });
  });
});

describe('gameBooks', () => {
  it('tells the interviewer the fair value now, the true value and both marks', () => {
    let s = createGameState(mech(), [6, 2, 5]);
    s = ok(postQuote(s, { bid: 9.5, ask: 11.5, size: 1 }, at(1)));
    s = ok(tradeQuote(s, { interviewerSide: 'buy', quantity: 1 }, at(2))); // -1, +11.5
    s = ok(revealNext(s, at(3))); // a 6: fair 13
    s = ok(postQuote(s, { bid: 12.5, ask: 13.5, size: 2 }, at(4)));
    const b = gameBooks(s);
    expect(b).toMatchObject({
      revealed: 1,
      nextReveal: { component: 1, label: 'Die 2' },
      fair: 13,
      min: 8,
      max: 18,
      value: 13,
      position: -1,
      cash: 11.5,
      markToFair: -1.5,
      markToValue: -1.5,
      quotesPosted: 2,
      settlement: null,
    });
    expect(b.sd).toBeCloseTo(Math.sqrt(35 / 6), 9);
    expect(b.components).toEqual([
      { label: 'Die 1', value: 6, shown: true },
      { label: 'Die 2', value: 2, shown: false },
      { label: 'Die 3', value: 5, shown: false },
    ]);
    expect(b.quote).toMatchObject({
      mid: 13,
      width: 1,
      fairInside: true,
      hitBid: { vsFair: -0.5, vsValue: -0.5 },
      liftOffer: { vsFair: -0.5, vsValue: -0.5 },
    });
    s = ok(revealNext(s, at(5))); // a 2: fair 11.5, the quote withdrawn
    expect(gameBooks(s)).toMatchObject({ fair: 11.5, nextReveal: null, quote: null });
  });
});

describe('gameReview', () => {
  it('quote quality, updating, risk and P&L on a scripted game', () => {
    let s = createGameState(mech(), [6, 2, 5]); // value 13
    s = ok(postQuote(s, { bid: 9.5, ask: 11.5, size: 1 }, at(10))); // fair 10.5, inside
    s = ok(tradeQuote(s, { interviewerSide: 'buy', quantity: 1 }, at(20))); // sells 1 at 11.5: +1
    s = ok(revealNext(s, at(30))); // a 6: fair 13
    s = ok(postQuote(s, { bid: 12, ask: 14, size: 2 }, at(40))); // mid 13
    s = ok(tradeQuote(s, { interviewerSide: 'sell', quantity: 2 }, at(50))); // buys 2 at 12: +2
    s = ok(revealNext(s, at(60))); // a 2: fair 11.5
    s = ok(postQuote(s, { bid: 12, ask: 13, size: 1 }, at(70))); // fair outside
    s = ok(tradeQuote(s, { interviewerSide: 'sell', quantity: 1 }, at(80))); // buys at 12: -0.5
    s = ok(postQuote(s, { bid: 11, ask: 12, size: 1 }, at(90))); // not traded
    s = ok(settleGame(s, at(100)));

    const r = gameReview(s);
    expect(QuantGameReview.parse(r)).toEqual(r);
    expect(r.value).toBe(13);
    expect(r.stats).toEqual(gameStats(mech()));
    expect(r.components.map((c) => c.value)).toEqual([6, 2, 5]);
    expect(r.quotes.map((q) => [q.mid, q.width, q.fair, q.fairInside, q.traded])).toEqual([
      [10.5, 2, 10.5, true, true],
      [13, 2, 13, true, true],
      [12.5, 1, 11.5, false, true],
      [11.5, 1, 11.5, true, false],
    ]);
    expect(r.quotes[1]?.sd).toBeCloseTo(Math.sqrt(35 / 6), 9);
    expect(
      r.trades.map((t) => [
        t.candidateSide,
        t.price,
        t.quantity,
        t.fair,
        t.edgePerContract,
        t.edge,
      ]),
    ).toEqual([
      ['sell', 11.5, 1, 10.5, 1, 1],
      ['buy', 12, 2, 13, 1, 2],
      ['buy', 12, 1, 11.5, -0.5, -0.5],
    ]);
    expect(r.reveals).toEqual([
      {
        at: at(30).toISOString(),
        component: 0,
        label: 'Die 1',
        value: 6,
        fairBefore: 10.5,
        fairAfter: 13,
        midBefore: 10.5,
        midAfter: 13,
      },
      {
        at: at(60).toISOString(),
        component: 1,
        label: 'Die 2',
        value: 2,
        fairBefore: 13,
        fairAfter: 11.5,
        midBefore: 13,
        midAfter: 12.5,
      },
    ]);
    // Positions -1, +1, +2.
    expect(r.finalPosition).toBe(2);
    expect(r.maxAbsPosition).toBe(2);
    expect(r.expectedEdge).toBe(2.5);
    expect(r.cash).toBe(11.5 - 24 - 12);
    expect(r.pnl).toBe(-24.5 + 2 * 13);
    expect(r.pnl).toBe(s.settlement?.pnl);
  });

  it('a game left without a settlement still reviews, at its true value', () => {
    let s = createGameState(mech(), [1, 1, 1]);
    s = ok(postQuote(s, { bid: 9.5, ask: 11.5, size: 1 }, at(1)));
    s = ok(tradeQuote(s, { interviewerSide: 'buy', quantity: 1 }, at(2)));
    const r = gameReview(s);
    expect(r).toMatchObject({ value: 3, pnl: 8.5, finalPosition: -1, maxAbsPosition: 1 });
    expect(r.reveals).toEqual([]);
    // A reveal with no quote after it.
    const t = ok(revealNext(s, at(3)));
    expect(gameReview(t).reveals[0]).toMatchObject({ midBefore: 10.5, midAfter: null });
  });
});

// ---------------------------------------------------------------- formatting and request

describe('formatting', () => {
  it('formatQuote, the chat text of a quote', () => {
    expect(formatQuote({ bid: 9.5, ask: 11.5, size: 1 })).toBe('9.5 bid, 11.5 offered, 1 lot');
    expect(formatQuote({ bid: 10, ask: 11, size: 5 })).toBe('10 bid, 11 offered, 5 lots');
    expect(formatQuote({ bid: -0.25, ask: 0.1 + 0.2, size: 2 })).toBe(
      '-0.25 bid, 0.3 offered, 2 lots',
    );
  });
  it('figures and the report’s solution line', () => {
    expect(formatGameNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatGameNumber(-0.0001)).toBe('0');
    expect(gameSolution(gameStats(mech()))).toBe(
      'Fair value 10.5, standard deviation 2.96, from 3 to 18',
    );
    expect(gameSolution(gameStats(twoDice('max')))).toBe(
      'Fair value 4.47, standard deviation 1.4, from 1 to 6',
    );
  });
  it('PostQuantQuoteRequest', () => {
    expect(PostQuantQuoteRequest.parse({ index: 1, bid: 9.5, ask: 11.5, size: 1 })).toEqual({
      index: 1,
      bid: 9.5,
      ask: 11.5,
      size: 1,
    });
    expect(
      PostQuantQuoteRequest.safeParse({ index: 1, bid: 9.5, ask: 11.5, size: 1.5 }).success,
    ).toBe(false);
    expect(
      PostQuantQuoteRequest.safeParse({ index: 1, bid: Number.POSITIVE_INFINITY, ask: 1, size: 1 })
        .success,
    ).toBe(false);
  });
});
