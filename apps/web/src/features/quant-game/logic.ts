/**
 * Pure rules for a market-making game as the candidate sees it (ARCHITECTURE §8.3): what the
 * live quote is doing, the blotter, the quote form's checks and steps, and the words for every
 * entry of the game's log. Everything here reads `QuantGameView`, which never carries a hidden
 * value, the fair value or a mark-to-market figure, and nothing here works one out: that is the
 * candidate's job. Figures are written as the chat writes them (`formatGameNumber`).
 */
import {
  formatGameNumber,
  QUANT_GAME_PRICE_MAX,
  type QuantGameEntry,
  type QuantGamePayoff,
  type QuantGameView,
  type QuantQuoteProblem,
  type QuantTradeSide,
  quoteProblem,
} from '@ipp/contracts';
import { ApiRequestError, errorMessage, formatRetry } from '@/lib/api';
import { plural } from '@/lib/format';

// ---------------------------------------------------------------- numbers

/** The minus sign used on screen (U+2212), so negative figures line up with positive ones. */
export const MINUS = '−';

/** A price or figure as written in chat: "10.5", "−3". */
export function num(x: number): string {
  const s = formatGameNumber(x);
  return s.startsWith('-') ? `${MINUS}${s.slice(1)}` : s;
}

/** A figure with its sign: "+4.5", "−2", "0" (a figure that rounds to zero has none). */
export function signed(x: number): string {
  const r = Number(formatGameNumber(x));
  if (r === 0) return '0';
  return r > 0 ? `+${formatGameNumber(r)}` : `${MINUS}${formatGameNumber(-r)}`;
}

export const lots = (n: number) => plural(n, 'lot');

/** "Long 3", "Short 2", "Flat": the candidate's position in contracts. */
export function positionLabel(position: number): string {
  if (position > 0) return `Long ${position}`;
  if (position < 0) return `Short ${-position}`;
  return 'Flat';
}

/** "9.5 – 11.5" */
export const marketText = (q: { bid: number; ask: number }) => `${num(q.bid)} – ${num(q.ask)}`;

// ---------------------------------------------------------------- the contract

const PAYOFF_WORD: Record<QuantGamePayoff, string> = {
  sum: 'the sum',
  product: 'the product',
  max: 'the highest',
  min: 'the lowest',
};

/** "Die 1, Die 2 and Die 3" */
export function listLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** "Settles at the sum of Die 1, Die 2 and Die 3" (one component: "Settles at Die 1"). */
export function payoffLine(view: Pick<QuantGameView, 'payoff' | 'components'>): string {
  const labels = view.components.map((c) => c.label);
  if (labels.length === 1) return `Settles at ${labels[0]}`;
  return `Settles at ${PAYOFF_WORD[view.payoff]} of ${listLabels(labels)}`;
}

/** "Steps of 0.5 · up to 5 lots" */
export const rulesLine = (view: Pick<QuantGameView, 'tick' | 'maxSize'>) =>
  `Steps of ${num(view.tick)} · up to ${lots(view.maxSize)}`;

/** A die's face (1 to 6) when the component is a die, so it is drawn with pips; else null. */
export function dieFace(label: string, value: number | null): number | null {
  if (value === null || !Number.isInteger(value) || value < 1 || value > 6) return null;
  return /\b(die|dice)\b/i.test(label) ? value : null;
}

/** Components shown in `next` that were hidden in `prev` (none on the first look). */
export function newlyShown(
  prev: readonly { value: number | null }[] | null,
  next: readonly { value: number | null }[],
): number[] {
  if (!prev) return [];
  return next.flatMap((c, i) => (c.value !== null && prev[i]?.value == null ? [i] : []));
}

// ---------------------------------------------------------------- the log

type Trade = Extract<QuantGameEntry, { kind: 'trade' }>;
type Reveal = Extract<QuantGameEntry, { kind: 'reveal' }>;

/** "Bought 2 at 9.5" / "Sold 1 at 11.5": the candidate's side. */
export const tradeText = (t: { candidateSide: QuantTradeSide; quantity: number; price: number }) =>
  `${t.candidateSide === 'buy' ? 'Bought' : 'Sold'} ${t.quantity} at ${num(t.price)}`;

/** "Die 1 shown: 6" */
export const revealText = (r: { label: string; value: number }) =>
  `${r.label} shown: ${num(r.value)}`;

/** One line of the log, for the report's transcript and the panel's announcements. */
export function entryText(e: QuantGameEntry): string {
  switch (e.kind) {
    case 'quote':
      return `Market ${marketText(e)}, ${lots(e.size)}`;
    case 'trade':
      return tradeText(e);
    case 'reveal':
      return revealText(e);
    case 'settle':
      return `Settled at ${num(e.value)} · P&L ${signed(e.pnl)}`;
  }
}

/**
 * What the candidate's market is doing now:
 *  none       no market posted yet
 *  working    the live quote, waiting for the interviewer
 *  traded     the last market was traded (and so consumed); `revealAfter` a reveal that followed it
 *  withdrawn  the last market was withdrawn because a component was shown
 *  settled    the game is over
 */
export type QuoteStatus =
  | { kind: 'none' }
  | { kind: 'working'; quote: NonNullable<QuantGameView['quote']> }
  | { kind: 'traded'; trade: Trade; revealAfter: Reveal | null }
  | { kind: 'withdrawn'; reveal: Reveal }
  | { kind: 'settled'; settlement: NonNullable<QuantGameView['settlement']> };

export function quoteStatus(
  view: Pick<QuantGameView, 'quote' | 'log' | 'settlement'>,
): QuoteStatus {
  if (view.settlement) return { kind: 'settled', settlement: view.settlement };
  if (view.quote) return { kind: 'working', quote: view.quote };
  const last = view.log.findLastIndex((e) => e.kind === 'quote');
  if (last < 0) return { kind: 'none' };
  const after = view.log.slice(last + 1);
  const first = after.find((e) => e.kind === 'trade' || e.kind === 'reveal');
  if (first?.kind === 'trade') {
    const revealAfter = after.find((e): e is Reveal => e.kind === 'reveal') ?? null;
    return { kind: 'traded', trade: first, revealAfter };
  }
  if (first?.kind === 'reveal') return { kind: 'withdrawn', reveal: first };
  return { kind: 'none' };
}

/** The last market posted (live or not), for the form's starting point; null before the first. */
export function lastQuote(view: Pick<QuantGameView, 'log'>) {
  const q = view.log.findLast((e) => e.kind === 'quote');
  return q?.kind === 'quote' ? { bid: q.bid, ask: q.ask, size: q.size } : null;
}

/** A row of the blotter: a trade with the position it left, or a component shown. */
export type BlotterRow =
  | { kind: 'trade'; key: string; text: string; side: QuantTradeSide; position: number }
  | { kind: 'reveal'; key: string; text: string };

/** The trades and the components shown between them, newest first. */
export function blotter(view: Pick<QuantGameView, 'log'>): BlotterRow[] {
  const rows: BlotterRow[] = [];
  let position = 0;
  view.log.forEach((e, i) => {
    if (e.kind === 'trade') {
      position += e.candidateSide === 'buy' ? e.quantity : -e.quantity;
      rows.push({
        kind: 'trade',
        key: `t${i}`,
        text: tradeText(e),
        side: e.candidateSide,
        position,
      });
    } else if (e.kind === 'reveal')
      rows.push({ kind: 'reveal', key: `r${i}`, text: revealText(e) });
  });
  return rows.reverse();
}

/**
 * What a screen reader is told when the log grows: the interviewer's trades, the components
 * shown and the settlement (the candidate's own quotes they already know). Null for nothing new.
 */
export function announcement(view: Pick<QuantGameView, 'log'>, seen: number): string | null {
  const fresh = view.log.slice(Math.max(0, seen)).filter((e) => e.kind !== 'quote');
  if (fresh.length === 0) return null;
  const parts = fresh.map((e) => {
    if (e.kind === 'trade')
      return `You ${e.candidateSide === 'buy' ? 'bought' : 'sold'} ${e.quantity} at ${num(e.price)}.`;
    if (e.kind === 'reveal') return `${revealText(e)}. Your market was withdrawn.`;
    return `${entryText(e)}.`;
  });
  return parts.join(' ');
}

/** "3 quotes left for this game", only once few are left (or none). */
export const QUOTES_LOW = 10;
export function quotesLeftWarning(left: number): string | null {
  if (left > QUOTES_LOW) return null;
  if (left === 0) return 'No quotes left for this game';
  return `${plural(left, 'quote')} left for this game`;
}

/** P&L at the settlement: cash + position × value, with its parts. */
export function settlementParts(view: Pick<QuantGameView, 'position' | 'cash' | 'settlement'>) {
  const s = view.settlement;
  if (!s) return null;
  return {
    value: s.value,
    pnl: s.pnl,
    cash: view.cash,
    position: view.position,
    /** "Cash +23.5, short 2 at 13: −26" */
    working:
      view.position === 0
        ? `Cash ${signed(view.cash)}, flat`
        : `Cash ${signed(view.cash)}, ${positionLabel(view.position).toLowerCase()} at ${num(s.value)}: ${signed(view.position * s.value)}`,
  };
}

// ---------------------------------------------------------------- the quote form

export type QuoteField = 'bid' | 'ask' | 'size';
export const QUOTE_FIELDS: readonly QuoteField[] = ['bid', 'ask', 'size'];
export type QuoteDraft = Record<QuoteField, string>;
export const EMPTY_DRAFT: QuoteDraft = { bid: '', ask: '', size: '' };

export const FIELD_LABEL: Record<QuoteField, string> = { bid: 'Bid', ask: 'Offer', size: 'Size' };

/** A typed number: null when empty, NaN when it is not one ("10.", "−3" and ".5" are). */
export function parseField(s: string): number | null {
  const t = s.trim().replace(/^[−–]/, '-');
  if (t === '') return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return Number.NaN;
  return Number(t);
}

export const draftOf = (q: { bid: number; ask: number; size: number }): QuoteDraft => ({
  bid: formatGameNumber(q.bid),
  ask: formatGameNumber(q.ask),
  size: String(q.size),
});

export type Spec = Pick<QuantGameView, 'tick' | 'maxSize'>;

/** What is wrong with one price on its own (finite, in range, on the tick), by `quoteProblem`. */
function priceProblem(spec: Spec, x: number): QuantQuoteProblem | null {
  // A one-point market fails only for being crossed once the price itself is fine.
  const p = quoteProblem(spec, { bid: x, ask: x, size: 1 });
  return p === 'crossed' ? null : p;
}

function sizeProblem(spec: Spec, n: number): QuantQuoteProblem | null {
  return quoteProblem(spec, { bid: 0, ask: spec.tick, size: n });
}

export function problemText(spec: Spec, p: QuantQuoteProblem): string {
  switch (p) {
    case 'not_finite':
      return 'Not a number';
    case 'out_of_range':
      return `Keep within ±${QUANT_GAME_PRICE_MAX.toLocaleString('en')}`;
    case 'off_tick':
      return `Use steps of ${num(spec.tick)}`;
    case 'crossed':
      return 'Must be above the bid';
    case 'size':
      return `Whole number, 1 to ${spec.maxSize}`;
  }
}

const MISSING: Record<QuoteField, string> = {
  bid: 'Enter a bid',
  ask: 'Enter an offer',
  size: 'Enter a size',
};

export type DraftCheck = {
  /** The quote to post: set only when `quoteProblem` finds nothing wrong with it. */
  quote: { bid: number; ask: number; size: number } | null;
  /** Each field's problem in words (an empty field is not one: see `missing`). */
  errors: Partial<Record<QuoteField, string>>;
  /** The empty fields, each with what to enter ("Enter a bid"), shown once the candidate submits. */
  missing: Partial<Record<QuoteField, string>>;
};

/**
 * Checks a draft with the contract's own `quoteProblem`, said field by field: a price on its own
 * (finite, in range, on the tick), the size, then the two prices together (bid below the offer).
 * `quote` is set exactly when `quoteProblem` accepts the whole market.
 */
export function checkDraft(spec: Spec, draft: QuoteDraft): DraftCheck {
  const errors: DraftCheck['errors'] = {};
  const missing: DraftCheck['missing'] = {};
  const values: Partial<Record<QuoteField, number>> = {};
  for (const f of QUOTE_FIELDS) {
    const v = parseField(draft[f]);
    if (v === null) {
      missing[f] = MISSING[f];
      continue;
    }
    values[f] = v;
    const p = f === 'size' ? sizeProblem(spec, v) : priceProblem(spec, v);
    if (p) errors[f] = problemText(spec, p);
  }
  const { bid, ask, size } = values;
  if (bid !== undefined && ask !== undefined && !errors.bid && !errors.ask) {
    if (quoteProblem(spec, { bid, ask, size: 1 }) === 'crossed')
      errors.ask = problemText(spec, 'crossed');
  }
  const complete = bid !== undefined && ask !== undefined && size !== undefined;
  const ok = complete && Object.keys(errors).length === 0;
  const quote = ok && quoteProblem(spec, { bid, ask, size }) === null ? { bid, ask, size } : null;
  return { quote, errors, missing };
}

/**
 * A price moved `steps` ticks (negative: down), from the nearest tick in that direction when it
 * is off the tick. An empty or unreadable field is left as it is.
 */
export function stepPrice(s: string, steps: number, tick: number): string {
  const x = parseField(s);
  if (x === null || !Number.isFinite(x) || steps === 0) return s;
  const k = x / tick;
  const onTick = Math.abs(k - Math.round(k)) <= 1e-6;
  const base = onTick ? Math.round(k) : steps > 0 ? Math.floor(k) : Math.ceil(k);
  const next = (base + steps) * tick;
  const clamped = Math.max(-QUANT_GAME_PRICE_MAX, Math.min(QUANT_GAME_PRICE_MAX, next));
  return formatGameNumber(clamped);
}

/** A size moved by `steps`, kept within 1..maxSize (an empty one starts at 1). */
export function stepSize(s: string, steps: number, maxSize: number): string {
  const x = parseField(s);
  if (x === null) return steps > 0 ? '1' : s;
  if (!Number.isFinite(x)) return s;
  return String(Math.max(1, Math.min(maxSize, Math.round(x) + steps)));
}

/** The whole market moved `steps` ticks, its width kept. */
export function shiftMarket(draft: QuoteDraft, steps: number, tick: number): QuoteDraft {
  return {
    ...draft,
    bid: stepPrice(draft.bid, steps, tick),
    ask: stepPrice(draft.ask, steps, tick),
  };
}

// ---------------------------------------------------------------- posting

/**
 * Why a quote was not posted, in words, where the candidate is looking. A 409 from the round
 * names the refusal (`QuantRefusal`); the rest are the usual HTTP failures.
 */
export function quoteErrorMessage(e: unknown, spec?: Spec): string {
  if (!(e instanceof ApiRequestError)) return errorMessage(e);
  if (e.isRateLimited)
    return e.retryAfter
      ? `Too many markets at once. You can quote again in ${formatRetry(e.retryAfter)}.`
      : 'Too many markets at once. Wait a moment and quote again.';
  switch (e.code) {
    case 'bad_quote':
      return spec
        ? `That market was refused: the bid must be below the offer, both in steps of ${num(spec.tick)}, for 1 to ${lots(spec.maxSize)}.`
        : 'That market was refused: check the bid, the offer and the size.';
    case 'quote_limit':
      return 'You have used every quote this game allows.';
    case 'wrong_index':
      return 'That question has just closed, so the market was not posted.';
    case 'not_game':
      return 'This question is not a market-making game.';
    case 'game_settled':
      return 'The game has settled; there is nothing left to trade.';
    case 'ended':
      return 'The round has finished, so markets can no longer be posted.';
    case 'pad_ended':
      return 'This interview has ended, so markets can no longer be posted.';
    case 'wrong_phase':
      return 'The round has not started yet.';
    case 'wrong_format':
      return 'This pad is not a quant round.';
    case 'validation_error':
      return 'That market could not be read. Check the three fields and post it again.';
    case 'network':
      return 'Could not reach the server, so the market was not posted. Check your connection and post it again.';
  }
  return errorMessage(e);
}
