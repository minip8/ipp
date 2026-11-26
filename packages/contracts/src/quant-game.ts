/**
 * Market-making games in a live quant round (ARCHITECTURE §8.3).
 *
 * A game is a contract whose value is built from a few hidden components (dice, coins, cards
 * with replacement: each drawn uniformly and independently from its faces). The candidate makes
 * markets on it (bid, ask, size); the AI interviewer, told the truth privately, only decides how
 * to trade against each quote and when to show the next component; this module keeps every book:
 * the hidden values, the live quote, the event log, the candidate's position and cash, and the
 * settlement. Like the round itself, every change is a pure function, applied by `advanceRound`
 * (quant-round.ts), so the API, the interviewer's tests and the browser tests' mock play the same
 * game.
 *
 * Content: one YAML file per game, `packages/content/games/<id>.yaml`, parsed by `QuantGame`.
 *
 * SIGN CONVENTION (everywhere in this file):
 *  - A stored trade (`QuantGameEvent` of kind `trade`, and the interviewer's move) names the
 *    INTERVIEWER's action in `interviewerSide`: `buy` = the interviewer lifts the candidate's
 *    offer (pays the ask; the candidate sells), `sell` = the interviewer hits the candidate's bid
 *    (receives the bid; the candidate buys).
 *  - Everything the browser sees, and `position` / `cash` in every shape, is from the CANDIDATE's
 *    side: `candidateSide` (`candidateSideOf`), position in contracts (positive = long), cash in
 *    price units (positive = received). P&L = cash + position × value.
 *
 * What may be seen by whom:
 *  - `QuantGameState` is SERVER-ONLY (inside `quant_rounds.state`).
 *  - `gameView` is all the browser gets while the pad is active: never a hidden value, the public
 *    fair value or any mark-to-market figure (working out the fair value is the candidate's task).
 *  - `gameBooks` is what the interviewer is told privately: everything, with the fair value now
 *    and the true value.
 *  - `gameReview` is the report's code-built analysis, only after the pad ended.
 */
import { z } from 'zod';
import { IsoDate, Slug } from './common';
import { ContentSource, NumericLiteral, QuizDifficulty } from './quiz';

// ---------------------------------------------------------------- limits

/** At most this many hidden components. */
export const QUANT_GAME_MAX_COMPONENTS = 8;
/** At most this many faces per component. */
export const QUANT_GAME_MAX_FACES = 1000;
/** The product of the face counts is at most this, so enumerating every outcome stays cheap. */
export const QUANT_GAME_MAX_OUTCOMES = 200_000;
/** A face, and the contract's smallest and largest value, lie within ± this. */
export const QUANT_GAME_VALUE_MAX = 100_000;
/** A quoted price lies within ± this. */
export const QUANT_GAME_PRICE_MAX = 1_000_000;
/** The smallest tick; every tick is a whole multiple of it (prices have at most 3 decimals). */
export const QUANT_GAME_TICK_MIN = 0.001;
export const QUANT_GAME_TICK_MAX = 1000;
/** The largest `maxSize` a game may set. */
export const QUANT_GAME_MAX_SIZE = 1000;
/**
 * Quotes per game. Each trade consumes a quote and there are at most 8 reveals and one
 * settlement, so a game's event log holds at most 2 × this + 9 events.
 */
export const QUANT_GAME_MAX_QUOTES = 100;

/** Prices and cash are kept to this many decimals (the tick's finest grain). */
const PRICE_DECIMALS = 3;
const PRICE_SCALE = 10 ** PRICE_DECIMALS;

// ---------------------------------------------------------------- the mechanics (content and snapshot)

/** How the contract's value comes from the components. */
export const QUANT_GAME_PAYOFFS = ['sum', 'product', 'max', 'min'] as const;
export const QuantGamePayoff = z.enum(QUANT_GAME_PAYOFFS);
export type QuantGamePayoff = z.infer<typeof QuantGamePayoff>;

/**
 * One hidden value, drawn uniformly from `faces` (a die is `[1, 2, 3, 4, 5, 6]`, a coin `[0, 1]`).
 * A face may repeat, which weights it (`[0, 0, 1]` is 1 with probability 1/3).
 */
export const QuantGameComponent = z.object({
  /** Shown to the candidate, e.g. "Die 1". */
  label: z.string().trim().min(1).max(40),
  faces: z
    .array(
      z.number().refine((x) => Number.isFinite(x) && Math.abs(x) <= QUANT_GAME_VALUE_MAX, {
        message: `a face is a finite number within ±${QUANT_GAME_VALUE_MAX}`,
      }),
    )
    .min(2)
    .max(QUANT_GAME_MAX_FACES),
});
export type QuantGameComponent = z.infer<typeof QuantGameComponent>;

const mechanicsShape = {
  components: z.array(QuantGameComponent).min(1).max(QUANT_GAME_MAX_COMPONENTS),
  payoff: QuantGamePayoff,
  /**
   * The order in which components may be shown during play (component indices, each at most
   * once; may be empty). A component not listed stays hidden until the settlement.
   */
  reveal: z.array(z.int().min(0)).max(QUANT_GAME_MAX_COMPONENTS),
  /** Prices are whole multiples of this (e.g. 0.5, 0.25, 0.1, 1). */
  tick: z.number().min(QUANT_GAME_TICK_MIN).max(QUANT_GAME_TICK_MAX),
  /** The largest quote size, in contracts. */
  maxSize: z.int().min(1).max(QUANT_GAME_MAX_SIZE),
};

/** The rules a schema cannot say field by field; shared by the content and the snapshot. */
function checkMechanics(m: QuantGameMechanics, ctx: z.RefinementCtx): void {
  const n = m.components.length;
  const outcomes = m.components.reduce((p, c) => p * c.faces.length, 1);
  if (outcomes > QUANT_GAME_MAX_OUTCOMES)
    ctx.addIssue({
      code: 'custom',
      path: ['components'],
      message: `${outcomes} outcomes: the product of the face counts must be at most ${QUANT_GAME_MAX_OUTCOMES}`,
    });
  m.reveal.forEach((i, k) => {
    if (i >= n) ctx.addIssue({ code: 'custom', path: ['reveal', k], message: `no component ${i}` });
    if (m.reveal.indexOf(i) !== k)
      ctx.addIssue({ code: 'custom', path: ['reveal', k], message: `component ${i} twice` });
  });
  if (!isMultiple(m.tick, QUANT_GAME_TICK_MIN))
    ctx.addIssue({
      code: 'custom',
      path: ['tick'],
      message: `a tick is a whole multiple of ${QUANT_GAME_TICK_MIN}`,
    });
  // The range needs well-formed faces; a malformed one is already an issue of its own.
  if (
    m.components.some(
      (c) =>
        !Array.isArray(c.faces) ||
        c.faces.length === 0 ||
        c.faces.some((f) => typeof f !== 'number' || !Number.isFinite(f)),
    )
  )
    return;
  const { min, max } = gameStats(m);
  if (!(Math.abs(min) <= QUANT_GAME_VALUE_MAX && Math.abs(max) <= QUANT_GAME_VALUE_MAX))
    ctx.addIssue({
      code: 'custom',
      path: ['payoff'],
      message: `the contract ranges over ${min}..${max}; keep it within ±${QUANT_GAME_VALUE_MAX}`,
    });
  if (!(min < max))
    ctx.addIssue({ code: 'custom', path: ['components'], message: 'the contract has one value' });
}

/**
 * The mechanics of a game: what `advanceRound` needs to play it, snapshotted into the round when
 * it is assembled (as a question's prompt is), so a step needs no lookup.
 */
export const QuantGameMechanics = z.object(mechanicsShape).superRefine(checkMechanics);
export type QuantGameMechanics = z.infer<typeof QuantGameMechanics>;

/**
 * The authored figures of the contract before anything is shown. The content check recomputes
 * them with the engine (`gameStats`) and fails on a mismatch, and a Python check in
 * `scripts/quant_checks/games.py` recomputes the fair value and sd independently.
 *  fair, min, max  exact, as a number `parseNumeric` reads (`10.5`, `161/36`)
 *  sd              to at least four significant figures
 */
export const QuantGameExpect = z.object({
  fair: NumericLiteral,
  sd: z.number().min(0),
  min: NumericLiteral,
  max: NumericLiteral,
});
export type QuantGameExpect = z.infer<typeof QuantGameExpect>;

/**
 * A game as authored in `packages/content/games/<id>.yaml`, stored in `quant_games.data`.
 * SERVER-ONLY: `counterparty`, `hints` and `expect` never reach the browser, and `explanation`
 * only in the report.
 */
export const QuantGame = z
  .object({
    /** Also the file name. Distinct from every quiz question id. */
    id: Slug,
    /** A quant topic (`betting-market-making` for now). */
    topic: Slug,
    title: z.string().trim().min(1).max(80),
    difficulty: QuizDifficulty,
    /** Markdown with KaTeX, posted word for word as the question message. */
    prompt: z.string().trim().min(1),
    ...mechanicsShape,
    /**
     * Interviewer-only: how to trade against the candidate (informed or not, what to probe, when
     * to ask for a tighter market, when to reveal).
     */
    counterparty: z.string().trim().min(1),
    /** Interviewer-only: a hint ladder, gentlest first, as a question's. */
    hints: z.array(z.string().trim().min(1)).max(8).default([]),
    /** For the report: fair value, a sensible width, how the market moves on each reveal. */
    explanation: z.string().trim().min(1),
    expect: QuantGameExpect,
    source: ContentSource.optional(),
  })
  .superRefine(checkMechanics);
export type QuantGame = z.infer<typeof QuantGame>;

// ---------------------------------------------------------------- state (server-only)

/** A two-sided market: buy `size` at `bid`, sell `size` at `ask`. */
export const QuantGameQuote = z.object({
  bid: z.number(),
  ask: z.number(),
  size: z.int(),
});
export type QuantGameQuote = z.infer<typeof QuantGameQuote>;

/** The candidate's live market, as normalised to the tick when it was posted. */
export const QuantGameLiveQuote = QuantGameQuote.extend({ at: IsoDate });
export type QuantGameLiveQuote = z.infer<typeof QuantGameLiveQuote>;

export const QuantTradeSide = z.enum(['buy', 'sell']);
export type QuantTradeSide = z.infer<typeof QuantTradeSide>;

/** The candidate's side of a trade whose interviewer's side is `interviewerSide`. */
export const candidateSideOf = (interviewerSide: QuantTradeSide): QuantTradeSide =>
  interviewerSide === 'buy' ? 'sell' : 'buy';

/** The game's settlement: the true value and the candidate's final P&L (cash + position × value). */
export const QuantGameSettlement = z.object({
  at: IsoDate,
  value: z.number(),
  pnl: z.number(),
});
export type QuantGameSettlement = z.infer<typeof QuantGameSettlement>;

/**
 * The game's log, SERVER-ONLY form. A trade names the INTERVIEWER's side; a reveal names only
 * the component (its value is in `values`).
 */
export const QuantGameEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quote'),
    at: IsoDate,
    bid: z.number(),
    ask: z.number(),
    size: z.int(),
  }),
  z.object({
    kind: z.literal('trade'),
    at: IsoDate,
    /** `buy`: the interviewer lifted the offer (paid `ask`); `sell`: hit the bid (got `bid`). */
    interviewerSide: QuantTradeSide,
    price: z.number(),
    quantity: z.int().min(1),
  }),
  z.object({ kind: z.literal('reveal'), at: IsoDate, component: z.int().min(0) }),
  z.object({ kind: z.literal('settle'), at: IsoDate, value: z.number(), pnl: z.number() }),
]);
export type QuantGameEvent = z.infer<typeof QuantGameEvent>;

/**
 * A game inside a round question (`QuantRoundQuestion.game`). SERVER-ONLY: `values` are the
 * hidden draws. Changed only by the transitions below, through `advanceRound`.
 */
export const QuantGameState = z.object({
  /** The game's title, snapshotted with the mechanics. */
  title: z.string(),
  spec: QuantGameMechanics,
  /** The hidden draw of each component, from the round's seed when it was assembled. */
  values: z.array(z.number()),
  /** How many components of `spec.reveal` have been shown (a prefix of it). */
  revealed: z.int().min(0),
  /** The candidate's live market; null before the first, after a trade and after a reveal. */
  quote: QuantGameLiveQuote.nullable(),
  events: z.array(QuantGameEvent),
  /** The CANDIDATE's position, in contracts (positive: long). */
  position: z.int(),
  /** The CANDIDATE's cash from trading (positive: received), to `PRICE_DECIMALS` decimals. */
  cash: z.number(),
  /** null until the question closes. */
  settlement: QuantGameSettlement.nullable(),
});
export type QuantGameState = z.infer<typeof QuantGameState>;

// ---------------------------------------------------------------- arithmetic

/** Derived figures (fair values, P&L, edges) to 12 significant figures, so 0.1 + 0.2 shows 0.3. */
const clean = (x: number): number => (Number.isFinite(x) ? Number(x.toPrecision(12)) + 0 : x);
const roundPrice = (x: number): number => Math.round(x * PRICE_SCALE) / PRICE_SCALE + 0;

/** Whether `x` is a whole multiple of `step`, forgiving floating point (`0.3` of `0.1`). */
function isMultiple(x: number, step: number): boolean {
  const k = x / step;
  return Number.isFinite(k) && Math.abs(k - Math.round(k)) <= 1e-6;
}

/** `price` on the tick: snapped to the nearest multiple, to `PRICE_DECIMALS` decimals. */
const onTick = (price: number, tick: number): number => roundPrice(Math.round(price / tick) * tick);

// ---------------------------------------------------------------- the engine: values and fair values

/** The draw of each component, from a `() => number` in [0, 1) (the API's assembler is seeded). */
export function drawGame(
  spec: Pick<QuantGameMechanics, 'components'>,
  rand: () => number,
): number[] {
  return spec.components.map((c) => {
    const r = rand();
    const i = Number.isFinite(r) ? Math.floor(r * c.faces.length) : 0;
    return c.faces[Math.min(c.faces.length - 1, Math.max(0, i))] as number;
  });
}

/** The contract's value for these component values. */
export function gameValue(
  spec: Pick<QuantGameMechanics, 'payoff'>,
  values: readonly number[],
): number {
  switch (spec.payoff) {
    case 'sum':
      return clean(values.reduce((s, v) => s + v, 0));
    case 'product':
      return clean(values.reduce((p, v) => p * v, 1));
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
  }
}

/** The contract's mean, standard deviation and range. */
export const QuantGameStats = z.object({
  fair: z.number(),
  sd: z.number(),
  min: z.number(),
  max: z.number(),
});
export type QuantGameStats = z.infer<typeof QuantGameStats>;

/** A component's distribution: distinct values ascending, with their probabilities. */
interface Dist {
  values: number[];
  probs: number[];
}

function distOf(faces: readonly number[]): Dist {
  const counts = new Map<number, number>();
  for (const f of faces) counts.set(f, (counts.get(f) ?? 0) + 1);
  const values = [...counts.keys()].sort((a, b) => a - b);
  return { values, probs: values.map((v) => (counts.get(v) ?? 0) / faces.length) };
}

/** The components shown after `revealedCount` reveals, in the order shown. */
export function revealedComponents(
  spec: Pick<QuantGameMechanics, 'reveal'>,
  revealedCount: number,
): number[] {
  return spec.reveal.slice(0, Math.max(0, revealedCount));
}

/**
 * Exact moments and range from the components' distributions, using their independence: a sum's
 * variance is the sum of variances, a product's follows from the factors' means and variances, a
 * maximum's distribution function is the product of the components' (a minimum's, of survivals).
 * The same figures as enumerating every outcome (the tests check that), without doing it.
 * Variances are central sums of non-negative terms, so a near-constant contract has an sd near 0
 * rather than the noise of E[X²] − E[X]².
 */
function statsOf(payoff: QuantGamePayoff, dists: readonly Dist[]): QuantGameStats {
  const mean = (d: Dist) => d.values.reduce((s, v, i) => s + v * (d.probs[i] as number), 0);
  const variance = (d: Dist, mu = mean(d)) =>
    d.values.reduce((s, v, i) => s + (v - mu) ** 2 * (d.probs[i] as number), 0);
  const lo = (d: Dist) => d.values[0] as number;
  const hi = (d: Dist) => d.values[d.values.length - 1] as number;
  let fair: number;
  let vari: number;
  let min: number;
  let max: number;
  switch (payoff) {
    case 'sum': {
      fair = dists.reduce((s, d) => s + mean(d), 0);
      vari = dists.reduce((s, d) => s + variance(d), 0);
      min = dists.reduce((s, d) => s + lo(d), 0);
      max = dists.reduce((s, d) => s + hi(d), 0);
      break;
    }
    case 'product': {
      // Var(PX) = Var(P)Var(X) + Var(P)E[X]² + Var(X)E[P]² for independent P and X.
      let mu = 1;
      let v = 0;
      for (const d of dists) {
        const m = mean(d);
        const s2 = variance(d, m);
        v = v * s2 + v * m * m + s2 * mu * mu;
        mu *= m;
      }
      fair = mu;
      vari = v;
      // A product is multilinear, so its extremes are at corners of the box of ranges.
      min = Number.POSITIVE_INFINITY;
      max = Number.NEGATIVE_INFINITY;
      for (let mask = 0; mask < 1 << dists.length; mask++) {
        const p = dists.reduce((acc, d, i) => acc * (mask & (1 << i) ? hi(d) : lo(d)), 1);
        min = Math.min(min, p);
        max = Math.max(max, p);
      }
      break;
    }
    case 'max':
    case 'min': {
      const support = [...new Set(dists.flatMap((d) => d.values))].sort((a, b) => a - b);
      // For max: P(M ≤ v) = Π P(Xi ≤ v). For min: P(m ≥ v) = Π P(Xi ≥ v), walked from the top.
      const up = payoff === 'max';
      const order = up ? support : [...support].reverse();
      // Each component's cumulative probability, advanced as the walk passes its values.
      const walk = dists.map((d) => ({ d, next: up ? 0 : d.values.length - 1, cum: 0 }));
      const pmf: Dist = { values: [], probs: [] };
      let prev = 0;
      for (const v of order) {
        let f = 1;
        for (const w of walk) {
          while (
            w.next >= 0 &&
            w.next < w.d.values.length &&
            (up ? (w.d.values[w.next] as number) <= v : (w.d.values[w.next] as number) >= v)
          ) {
            w.cum += w.d.probs[w.next] as number;
            w.next += up ? 1 : -1;
          }
          f *= w.cum;
        }
        pmf.values.push(v);
        pmf.probs.push(Math.max(0, f - prev));
        prev = f;
      }
      fair = mean(pmf);
      vari = variance(pmf, fair);
      const los = dists.map(lo);
      const his = dists.map(hi);
      min = up ? Math.max(...los) : Math.min(...los);
      max = up ? Math.max(...his) : Math.min(...his);
      break;
    }
  }
  return {
    fair: clean(fair),
    sd: clean(Math.sqrt(Math.max(0, vari))),
    min: clean(min),
    max: clean(max),
  };
}

/** The contract's unconditional fair value, standard deviation, minimum and maximum. */
export function gameStats(spec: Pick<QuantGameMechanics, 'components' | 'payoff'>): QuantGameStats {
  return statsOf(
    spec.payoff,
    spec.components.map((c) => distOf(c.faces)),
  );
}

/**
 * The contract's figures given the components shown after `revealedCount` reveals: those are
 * fixed at their values, the rest still random. `fair` is the PUBLIC fair value, what quotes are
 * judged against.
 */
export function gameConditional(
  spec: Pick<QuantGameMechanics, 'components' | 'payoff' | 'reveal'>,
  values: readonly number[],
  revealedCount: number,
): QuantGameStats {
  const shown = new Set(revealedComponents(spec, revealedCount));
  return statsOf(
    spec.payoff,
    spec.components.map((c, i) =>
      shown.has(i) ? { values: [values[i] as number], probs: [1] } : distOf(c.faces),
    ),
  );
}

/** The public fair value: the contract's expectation given what has been shown. */
export const gameFair = (
  spec: Pick<QuantGameMechanics, 'components' | 'payoff' | 'reveal'>,
  values: readonly number[],
  revealedCount: number,
): number => gameConditional(spec, values, revealedCount).fair;

// ---------------------------------------------------------------- creating a game

/**
 * A fresh game over `values` (from `drawGame`): nothing shown, no quote, flat. Copies only the
 * mechanics and the title (never the counterparty notes, hints or explanation). Throws when the
 * values do not fit the components: that is the assembler's bug, not a step to refuse.
 */
export function createGameState(
  game: QuantGameMechanics & { title: string },
  values: readonly number[],
): QuantGameState {
  if (
    values.length !== game.components.length ||
    values.some((v, i) => !game.components[i]?.faces.includes(v))
  )
    throw new Error('the values do not fit the game’s components');
  return {
    title: game.title,
    spec: {
      components: game.components.map((c) => ({ label: c.label, faces: [...c.faces] })),
      payoff: game.payoff,
      reveal: [...game.reveal],
      tick: game.tick,
      maxSize: game.maxSize,
    },
    values: [...values],
    revealed: 0,
    quote: null,
    events: [],
    position: 0,
    cash: 0,
    settlement: null,
  };
}

// ---------------------------------------------------------------- what everyone sees of the log

/**
 * One line of a game's log as everyone may see it: a trade from the CANDIDATE's side, a reveal
 * with the value shown. Also the `entry` of a `game` timeline event.
 */
export const QuantGameEntry = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quote'),
    at: IsoDate,
    bid: z.number(),
    ask: z.number(),
    size: z.int(),
  }),
  z.object({
    kind: z.literal('trade'),
    at: IsoDate,
    /** `buy`: the candidate bought at their bid; `sell`: sold at their offer. */
    candidateSide: QuantTradeSide,
    price: z.number(),
    quantity: z.int().min(1),
  }),
  z.object({
    kind: z.literal('reveal'),
    at: IsoDate,
    component: z.int().min(0),
    label: z.string(),
    value: z.number(),
  }),
  z.object({ kind: z.literal('settle'), at: IsoDate, value: z.number(), pnl: z.number() }),
]);
export type QuantGameEntry = z.infer<typeof QuantGameEntry>;

/** The public form of one stored event of `state`, field by field. */
export function gameEntry(state: QuantGameState, e: QuantGameEvent): QuantGameEntry {
  switch (e.kind) {
    case 'quote':
      return { kind: 'quote', at: e.at, bid: e.bid, ask: e.ask, size: e.size };
    case 'trade':
      return {
        kind: 'trade',
        at: e.at,
        candidateSide: candidateSideOf(e.interviewerSide),
        price: e.price,
        quantity: e.quantity,
      };
    case 'reveal':
      return {
        kind: 'reveal',
        at: e.at,
        component: e.component,
        label: state.spec.components[e.component]?.label ?? `#${e.component + 1}`,
        value: state.values[e.component] as number,
      };
    case 'settle':
      return { kind: 'settle', at: e.at, value: e.value, pnl: e.pnl };
  }
}

// ---------------------------------------------------------------- transitions

/**
 * Why a game transition was refused (each is also a `QuantRefusal`).
 *
 *  bad_quote          the quote fails `quoteProblem`
 *  quote_limit        the game already has `QUANT_GAME_MAX_QUOTES` quotes
 *  no_quote           a trade with no live quote
 *  bad_quantity       a trade's quantity is not a whole number in 1..the quote's size
 *  nothing_to_reveal  every component of `spec.reveal` is already shown
 *  game_settled       the game is settled (cannot happen through `advanceRound`: a game settles
 *                     only when its question closes)
 *  invalid            a trade's side that is neither `buy` nor `sell`
 */
export type QuantGameRefusal =
  | 'bad_quote'
  | 'quote_limit'
  | 'no_quote'
  | 'bad_quantity'
  | 'nothing_to_reveal'
  | 'game_settled'
  | 'invalid';

/** A transition's result: the next state and the log entry it added, or why it was refused. */
export type QuantGameAdvance =
  | { ok: true; state: QuantGameState; entry: QuantGameEntry }
  | { ok: false; reason: QuantGameRefusal };

/**
 * What is wrong with a quote on this game, or null when it may be posted. The browser can show
 * it before sending; the engine refuses the same quotes (`bad_quote`).
 *
 *  not_finite    a price or the size is not a finite number
 *  out_of_range  a price beyond ±`QUANT_GAME_PRICE_MAX`
 *  off_tick      a price that is not a whole multiple of the tick
 *  crossed       the bid is not below the ask
 *  size          the size is not a whole number in 1..`maxSize`
 */
export type QuantQuoteProblem = 'not_finite' | 'out_of_range' | 'off_tick' | 'crossed' | 'size';

export function quoteProblem(
  spec: Pick<QuantGameMechanics, 'tick' | 'maxSize'>,
  quote: { bid: unknown; ask: unknown; size: unknown },
): QuantQuoteProblem | null {
  const { bid, ask, size } = quote;
  if (
    typeof bid !== 'number' ||
    typeof ask !== 'number' ||
    typeof size !== 'number' ||
    !Number.isFinite(bid) ||
    !Number.isFinite(ask) ||
    !Number.isFinite(size)
  )
    return 'not_finite';
  if (Math.abs(bid) > QUANT_GAME_PRICE_MAX || Math.abs(ask) > QUANT_GAME_PRICE_MAX)
    return 'out_of_range';
  if (!isMultiple(bid, spec.tick) || !isMultiple(ask, spec.tick)) return 'off_tick';
  if (!(onTick(bid, spec.tick) < onTick(ask, spec.tick))) return 'crossed';
  if (!Number.isInteger(size) || size < 1 || size > spec.maxSize) return 'size';
  return null;
}

const quoteCount = (state: QuantGameState) => state.events.filter((e) => e.kind === 'quote').length;

/** Every transition returns a new state; nothing of the input is modified or shared mutably. */
const withEvent = (
  state: QuantGameState,
  event: QuantGameEvent,
  patch: Partial<QuantGameState>,
): QuantGameAdvance => {
  const next: QuantGameState = { ...state, ...patch, events: [...state.events, event] };
  return { ok: true, state: next, entry: gameEntry(next, event) };
};

/**
 * The candidate posts a market. It replaces the live quote; prices are stored snapped to the tick
 * (`0.30000000000000004` is `0.3`).
 */
export function postQuote(
  state: QuantGameState,
  quote: QuantGameQuote,
  now: Date,
): QuantGameAdvance {
  if (state.settlement) return { ok: false, reason: 'game_settled' };
  if (quoteCount(state) >= QUANT_GAME_MAX_QUOTES) return { ok: false, reason: 'quote_limit' };
  if (quoteProblem(state.spec, quote)) return { ok: false, reason: 'bad_quote' };
  const at = now.toISOString();
  const live = {
    bid: onTick(quote.bid, state.spec.tick),
    ask: onTick(quote.ask, state.spec.tick),
    size: quote.size,
    at,
  };
  return withEvent(state, { kind: 'quote', ...live }, { quote: live });
}

/** The interviewer's trade against the live quote (`QuantGameMove.trade`). */
export interface QuantGameTrade {
  /** The INTERVIEWER's side: `buy` lifts the candidate's offer, `sell` hits their bid. */
  interviewerSide: QuantTradeSide;
  /** Whole contracts, 1..the live quote's size. */
  quantity: number;
}

/**
 * The interviewer trades against the live quote: `buy` at the ask (the candidate sells), `sell`
 * at the bid (the candidate buys). The quote is consumed whatever the quantity, so the candidate
 * must quote again.
 */
export function tradeQuote(
  state: QuantGameState,
  trade: QuantGameTrade,
  now: Date,
): QuantGameAdvance {
  if (state.settlement) return { ok: false, reason: 'game_settled' };
  if (trade.interviewerSide !== 'buy' && trade.interviewerSide !== 'sell')
    return { ok: false, reason: 'invalid' };
  const quote = state.quote;
  if (!quote) return { ok: false, reason: 'no_quote' };
  const q = trade.quantity;
  if (!Number.isInteger(q) || q < 1 || q > quote.size) return { ok: false, reason: 'bad_quantity' };
  const buys = trade.interviewerSide === 'buy';
  const price = buys ? quote.ask : quote.bid;
  return withEvent(
    state,
    {
      kind: 'trade',
      at: now.toISOString(),
      interviewerSide: trade.interviewerSide,
      price,
      quantity: q,
    },
    {
      quote: null,
      // The candidate sells when the interviewer buys, and buys when it sells.
      position: state.position + (buys ? -q : q),
      cash: roundPrice(state.cash + (buys ? price * q : -price * q)),
    },
  );
}

/** The next component of `spec.reveal` is shown. The live quote is withdrawn: it was made on less. */
export function revealNext(state: QuantGameState, now: Date): QuantGameAdvance {
  if (state.settlement) return { ok: false, reason: 'game_settled' };
  const component = state.spec.reveal[state.revealed];
  if (component === undefined) return { ok: false, reason: 'nothing_to_reveal' };
  return withEvent(
    state,
    { kind: 'reveal', at: now.toISOString(), component },
    { revealed: state.revealed + 1, quote: null },
  );
}

/** The game closes: the true value is recorded with the candidate's P&L, cash + position × value. */
export function settleGame(state: QuantGameState, now: Date): QuantGameAdvance {
  if (state.settlement) return { ok: false, reason: 'game_settled' };
  const at = now.toISOString();
  const value = gameValue(state.spec, state.values);
  const pnl = clean(state.cash + state.position * value);
  return withEvent(
    state,
    { kind: 'settle', at, value, pnl },
    { quote: null, settlement: { at, value, pnl } },
  );
}

// ---------------------------------------------------------------- the browser's view

/**
 * `QuantQuestionView.game`: what everyone in the pad sees of a game. Never a hidden value, the
 * public fair value or a mark-to-market figure: working out the fair value is the candidate's
 * task. Everything here happened in front of them.
 */
export const QuantGameView = z.object({
  title: z.string(),
  /** Every component, with its value once shown (all of them once settled), null before. */
  components: z.array(z.object({ label: z.string(), value: z.number().nullable() })),
  payoff: QuantGamePayoff,
  tick: z.number(),
  maxSize: z.int(),
  quote: QuantGameLiveQuote.nullable(),
  /** Every quote, trade, reveal and the settlement, in order, trades from the candidate's side. */
  log: z.array(QuantGameEntry),
  /** The candidate's. */
  position: z.int(),
  /** The candidate's. */
  cash: z.number(),
  settlement: QuantGameSettlement.nullable(),
  /** Quotes the candidate may still post (`QUANT_GAME_MAX_QUOTES` less those posted). */
  quotesLeft: z.int().min(0),
});
export type QuantGameView = z.infer<typeof QuantGameView>;

/** The browser's view of a game, field by field (as `publicRound` builds a question's). */
export function gameView(state: QuantGameState): QuantGameView {
  const settled = state.settlement !== null;
  const shown = new Set(revealedComponents(state.spec, state.revealed));
  return {
    title: state.title,
    components: state.spec.components.map((c, i) => ({
      label: c.label,
      value: settled || shown.has(i) ? (state.values[i] ?? null) : null,
    })),
    payoff: state.spec.payoff,
    tick: state.spec.tick,
    maxSize: state.spec.maxSize,
    quote: state.quote && {
      bid: state.quote.bid,
      ask: state.quote.ask,
      size: state.quote.size,
      at: state.quote.at,
    },
    log: state.events.map((e) => gameEntry(state, e)),
    position: state.position,
    cash: state.cash,
    settlement: state.settlement && {
      at: state.settlement.at,
      value: state.settlement.value,
      pnl: state.settlement.pnl,
    },
    quotesLeft: Math.max(0, QUANT_GAME_MAX_QUOTES - quoteCount(state)),
  };
}

/** The trades of a view's log (the candidate's side). */
export const gameTrades = (view: Pick<QuantGameView, 'log'>) =>
  view.log.filter((e): e is Extract<QuantGameEntry, { kind: 'trade' }> => e.kind === 'trade');

// ---------------------------------------------------------------- the interviewer's books

/**
 * What the interviewer is told privately about a game (`gameBooks`): everything, worked out in
 * code so the model never has to. Edges are per contract and TO THE INTERVIEWER: `hitBid` is
 * selling at the candidate's bid (bid − value), `liftOffer` buying at their ask (value − ask);
 * positive means the trade is good for the interviewer against that value.
 */
export interface QuantGameBooks {
  title: string;
  components: { label: string; value: number; shown: boolean }[];
  payoff: QuantGamePayoff;
  tick: number;
  maxSize: number;
  /** Reveals so far, and the component the next reveal shows (null: none left). */
  revealed: number;
  nextReveal: { component: number; label: string } | null;
  quote:
    | (QuantGameLiveQuote & {
        mid: number;
        width: number;
        /** Is the public fair value within the market (bid ≤ fair ≤ ask)? */
        fairInside: boolean;
        hitBid: { vsFair: number; vsValue: number };
        liftOffer: { vsFair: number; vsValue: number };
      })
    | null;
  log: QuantGameEntry[];
  quotesPosted: number;
  quotesLeft: number;
  /** The candidate's position and cash. */
  position: number;
  cash: number;
  /** The public figures, given what has been shown: what the candidate should be quoting around. */
  fair: number;
  sd: number;
  min: number;
  max: number;
  /** The true value (the contract settles at it). */
  value: number;
  /** The candidate's position marked to the public fair value and to the true value. */
  markToFair: number;
  markToValue: number;
  settlement: QuantGameSettlement | null;
}

export function gameBooks(state: QuantGameState): QuantGameBooks {
  const now = gameConditional(state.spec, state.values, state.revealed);
  const value = gameValue(state.spec, state.values);
  const shown = new Set(revealedComponents(state.spec, state.revealed));
  const next = state.spec.reveal[state.revealed];
  const q = state.quote;
  const posted = quoteCount(state);
  return {
    title: state.title,
    components: state.spec.components.map((c, i) => ({
      label: c.label,
      value: state.values[i] as number,
      shown: shown.has(i),
    })),
    payoff: state.spec.payoff,
    tick: state.spec.tick,
    maxSize: state.spec.maxSize,
    revealed: state.revealed,
    nextReveal:
      next === undefined
        ? null
        : { component: next, label: state.spec.components[next]?.label ?? `#${next + 1}` },
    quote: q && {
      bid: q.bid,
      ask: q.ask,
      size: q.size,
      at: q.at,
      mid: clean((q.bid + q.ask) / 2),
      width: clean(q.ask - q.bid),
      fairInside: q.bid <= now.fair && now.fair <= q.ask,
      hitBid: { vsFair: clean(q.bid - now.fair), vsValue: clean(q.bid - value) },
      liftOffer: { vsFair: clean(now.fair - q.ask), vsValue: clean(value - q.ask) },
    },
    log: state.events.map((e) => gameEntry(state, e)),
    quotesPosted: posted,
    quotesLeft: Math.max(0, QUANT_GAME_MAX_QUOTES - posted),
    position: state.position,
    cash: state.cash,
    fair: now.fair,
    sd: now.sd,
    min: now.min,
    max: now.max,
    value,
    markToFair: clean(state.cash + state.position * now.fair),
    markToValue: clean(state.cash + state.position * value),
    settlement: state.settlement,
  };
}

// ---------------------------------------------------------------- the report's review

/**
 * `QuantQuestionReview.game`: the report's analysis of a game, built in code from its log after
 * the pad ended. "Fair" is always the PUBLIC fair value at that moment (given what had been
 * shown), and edges are the CANDIDATE's: (price − fair) × quantity on a sale, (fair − price) ×
 * quantity on a purchase. The four things it answers: quote quality (`quotes`), updating on
 * information (`reveals`), risk taken (`finalPosition`, `maxAbsPosition`) and P&L (`expectedEdge`
 * against `pnl`, where luck is the difference).
 */
export const QuantGameReview = z.object({
  title: z.string(),
  components: z.array(z.object({ label: z.string(), value: z.number() })),
  payoff: QuantGamePayoff,
  tick: z.number(),
  maxSize: z.int(),
  /** Before anything was shown. */
  stats: QuantGameStats,
  /** The true value. */
  value: z.number(),
  quotes: z.array(
    z.object({
      at: IsoDate,
      bid: z.number(),
      ask: z.number(),
      size: z.int(),
      mid: z.number(),
      width: z.number(),
      /** The public fair value and standard deviation when it was posted. */
      fair: z.number(),
      sd: z.number(),
      /** bid ≤ fair ≤ ask */
      fairInside: z.boolean(),
      /** Whether the interviewer traded on it. */
      traded: z.boolean(),
    }),
  ),
  trades: z.array(
    z.object({
      at: IsoDate,
      candidateSide: QuantTradeSide,
      price: z.number(),
      quantity: z.int(),
      fair: z.number(),
      edgePerContract: z.number(),
      /** edgePerContract × quantity */
      edge: z.number(),
    }),
  ),
  reveals: z.array(
    z.object({
      at: IsoDate,
      component: z.int(),
      label: z.string(),
      value: z.number(),
      fairBefore: z.number(),
      fairAfter: z.number(),
      /** The mid of the last quote before the reveal, and of the first after (null: none). */
      midBefore: z.number().nullable(),
      midAfter: z.number().nullable(),
    }),
  ),
  finalPosition: z.int(),
  maxAbsPosition: z.int(),
  /** The sum of the trades' edges: what the trading was worth on average. */
  expectedEdge: z.number(),
  cash: z.number(),
  /** Realised: cash + final position × value. */
  pnl: z.number(),
});
export type QuantGameReview = z.infer<typeof QuantGameReview>;

export function gameReview(state: QuantGameState): QuantGameReview {
  const fairs = Array.from({ length: state.spec.reveal.length + 1 }, (_, k) =>
    gameConditional(state.spec, state.values, k),
  );
  const fairAt = (k: number) => fairs[Math.min(k, fairs.length - 1)] as QuantGameStats;
  const value = state.settlement?.value ?? gameValue(state.spec, state.values);
  const quotes: QuantGameReview['quotes'] = [];
  const trades: QuantGameReview['trades'] = [];
  const reveals: QuantGameReview['reveals'] = [];
  let revealed = 0;
  let position = 0;
  let maxAbs = 0;
  let lastMid: number | null = null;
  let awaitingMid: QuantGameReview['reveals'][number] | null = null;
  let edgeTotal = 0;
  for (const e of state.events) {
    const now = fairAt(revealed);
    if (e.kind === 'quote') {
      const mid = clean((e.bid + e.ask) / 2);
      quotes.push({
        at: e.at,
        bid: e.bid,
        ask: e.ask,
        size: e.size,
        mid,
        width: clean(e.ask - e.bid),
        fair: now.fair,
        sd: now.sd,
        fairInside: e.bid <= now.fair && now.fair <= e.ask,
        traded: false,
      });
      if (awaitingMid) awaitingMid.midAfter = mid;
      awaitingMid = null;
      lastMid = mid;
    } else if (e.kind === 'trade') {
      const last = quotes[quotes.length - 1];
      if (last) last.traded = true;
      const side = candidateSideOf(e.interviewerSide);
      const per = clean(side === 'sell' ? e.price - now.fair : now.fair - e.price);
      const edge = clean(per * e.quantity);
      edgeTotal += edge;
      position += side === 'buy' ? e.quantity : -e.quantity;
      maxAbs = Math.max(maxAbs, Math.abs(position));
      trades.push({
        at: e.at,
        candidateSide: side,
        price: e.price,
        quantity: e.quantity,
        fair: now.fair,
        edgePerContract: per,
        edge,
      });
    } else if (e.kind === 'reveal') {
      revealed++;
      const r = {
        at: e.at,
        component: e.component,
        label: state.spec.components[e.component]?.label ?? `#${e.component + 1}`,
        value: state.values[e.component] as number,
        fairBefore: now.fair,
        fairAfter: fairAt(revealed).fair,
        midBefore: lastMid,
        midAfter: null,
      };
      reveals.push(r);
      awaitingMid = r;
    }
  }
  return {
    title: state.title,
    components: state.spec.components.map((c, i) => ({
      label: c.label,
      value: state.values[i] as number,
    })),
    payoff: state.spec.payoff,
    tick: state.spec.tick,
    maxSize: state.spec.maxSize,
    stats: fairAt(0),
    value,
    quotes,
    trades,
    reveals,
    finalPosition: state.position,
    maxAbsPosition: maxAbs,
    expectedEdge: clean(edgeTotal),
    cash: state.cash,
    pnl: state.settlement?.pnl ?? clean(state.cash + state.position * value),
  };
}

// ---------------------------------------------------------------- formatting

/** A price or figure as written in chat: at most three decimals, no trailing zeros. */
export const formatGameNumber = (x: number, decimals = PRICE_DECIMALS): string =>
  String(Number(x.toFixed(decimals)) + 0);

/**
 * The chat text of a candidate's quote, the same on the server and in the browser tests' mock:
 * "9.5 bid, 11.5 offered, 1 lot".
 */
export const formatQuote = (q: QuantGameQuote): string =>
  `${formatGameNumber(q.bid)} bid, ${formatGameNumber(q.ask)} offered, ${q.size} ${q.size === 1 ? 'lot' : 'lots'}`;

/**
 * `QuantQuestionReview.solution` for a game: its figures before anything is shown, e.g.
 * "Fair value 10.5, standard deviation 2.96, from 3 to 18".
 */
export const gameSolution = (stats: QuantGameStats): string =>
  `Fair value ${formatGameNumber(stats.fair, 2)}, standard deviation ${formatGameNumber(stats.sd, 2)}, from ${formatGameNumber(stats.min, 2)} to ${formatGameNumber(stats.max, 2)}`;

// ---------------------------------------------------------------- request

/**
 * The candidate's market on the current question (the API's quote route or event): turned into a
 * `quote` step. Validated in full by the engine (`quoteProblem`).
 */
export const PostQuantQuoteRequest = z.object({
  /** The question it is for (`QuantQuestionView.index`); another one is refused `wrong_index`. */
  index: z.int().min(0),
  bid: z.number(),
  ask: z.number(),
  size: z.int(),
});
export type PostQuantQuoteRequest = z.infer<typeof PostQuantQuoteRequest>;
