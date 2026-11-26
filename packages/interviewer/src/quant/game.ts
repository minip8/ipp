/**
 * The interviewer's side of a market-making game (ARCHITECTURE §8.3): the move a turn may make,
 * the facts of it the platform states, and the game's material in the prompts.
 *
 * Words and books. The model chooses its move in the turn's fields (`trade`, `quantity`,
 * `reveal`), written before its message. `normaliseGameMove` keeps the move inside what the books
 * allow (no trade without a live quote, a quantity within the quote's size, no reveal with nothing
 * left, no reveal on a close), and `moveFacts` plays it on the game's state with the engine's own
 * transitions (`tradeQuote`, `revealNext`, `settleGame`, the ones `advanceRound` applies) and words
 * what they did: "I buy 2 at your offer of 11.5.", "Die 1 shows 6.", the settlement on a close.
 * Those lines open the posted message and the model's words follow them; the model is told never
 * to state a trade, a price, a quantity or a value itself. So the numbers on the screen are the
 * books' numbers, whatever the model's arithmetic or memory, and a step is never sent that the
 * server would refuse for the books' sake.
 *
 * SIGN CONVENTION (as in contracts' quant-game.ts): a trade names the INTERVIEWER's side, `buy`
 * lifting the candidate's offer (they sell) and `sell` hitting their bid (they buy); position and
 * cash are the CANDIDATE's; an edge in the books (`hitBid`, `liftOffer`) is the interviewer's.
 */
import {
  formatGameNumber,
  formatQuote,
  gameConditional,
  gameReview,
  type Message,
  QUANT_GAME_MAX_QUOTES,
  type QuantGameEntry,
  type QuantGameMove,
  type QuantGameReview,
  type QuantGameState,
  type QuantTradeSide,
  revealNext,
  settleGame,
  tradeQuote,
} from '@ipp/contracts';
import { clock, duration } from '../prompts';
import type { QuantGameSlotEntry } from '../types';

// ---------------------------------------------------------------- the move

/** The move fields of a turn as the model wrote them (`QuantTurnSchema`). */
export interface RawGameMove {
  /** The interviewer's side, or `none`. */
  trade: string;
  quantity: number;
  reveal: boolean;
}

export interface NormalisedGameMove {
  /** What the step carries (`{}`: no move). */
  move: QuantGameMove;
  /** What was changed or dropped, for the logs ("quantity 7 -> 5", "trade dropped: no live quote"). */
  adjusted: string[];
}

const isSide = (s: string): s is QuantTradeSide => s === 'buy' || s === 'sell';

/**
 * The move a turn may send on this game, whatever the model wrote:
 *  - a trade needs a live quote (else it is dropped); its quantity is a whole number clamped to
 *    1..the quote's size (the facts line then states the quantity actually traded);
 *  - a reveal needs a component left to show (else it is dropped), and a close carries none: the
 *    settlement shows everything anyway;
 *  - a settled game takes no move (it cannot be current, so this does not happen in play).
 */
export function normaliseGameMove(
  state: QuantGameState,
  raw: RawGameMove,
  closing: boolean,
): NormalisedGameMove {
  const move: QuantGameMove = {};
  const adjusted: string[] = [];
  const wantsTrade = isSide(raw.trade);
  if (state.settlement) {
    if (wantsTrade || raw.reveal) adjusted.push('move dropped: the game is settled');
    return { move, adjusted };
  }
  if (wantsTrade) {
    const quote = state.quote;
    if (!quote) adjusted.push('trade dropped: no live quote');
    else {
      const asked = Number.isFinite(raw.quantity) ? Math.round(raw.quantity) : 1;
      const quantity = Math.min(quote.size, Math.max(1, asked));
      if (quantity !== raw.quantity) adjusted.push(`quantity ${raw.quantity} -> ${quantity}`);
      move.trade = { interviewerSide: raw.trade as QuantTradeSide, quantity };
    }
  }
  if (raw.reveal) {
    if (closing) adjusted.push('reveal dropped: the close settles the game');
    else if (state.spec.reveal[state.revealed] === undefined)
      adjusted.push('reveal dropped: nothing left to reveal');
    else move.reveal = true;
  }
  return { move, adjusted };
}

export const hasMove = (m: QuantGameMove | undefined): boolean => !!(m?.trade || m?.reveal);

// ---------------------------------------------------------------- the facts the platform states

/** "Die 1 is 6, Die 2 is 2 and Die 3 is 5" */
function listed(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const lots = (n: number) => `${n}`;

/** A trade from the interviewer's side, as it says it. */
export function tradeLine(e: Extract<QuantGameEntry, { kind: 'trade' }>): string {
  const price = formatGameNumber(e.price);
  // The candidate sold when the interviewer bought (at their offer), and bought when it sold.
  return e.candidateSide === 'sell'
    ? `I buy ${lots(e.quantity)} at your offer of ${price}.`
    : `I sell ${lots(e.quantity)} at your bid of ${price}.`;
}

export function revealLine(e: Extract<QuantGameEntry, { kind: 'reveal' }>): string {
  return `${e.label} shows ${formatGameNumber(e.value)}.`;
}

/** "long 3", "short 2", "flat" */
export const positionText = (p: number) => (p > 0 ? `long ${p}` : p < 0 ? `short ${-p}` : 'flat');

/** The settled game: every value, the contract's value, the candidate's position and P&L. */
export function settleLine(state: QuantGameState): string {
  const s = state.settlement;
  if (!s) return '';
  const values = state.spec.components.map(
    (c, i) => `${c.label} is ${formatGameNumber(state.values[i] as number)}`,
  );
  const traded = state.events.some((e) => e.kind === 'trade');
  const pnl = formatGameNumber(Math.abs(s.pnl));
  const result = !traded
    ? 'We made no trades.'
    : `You finish ${positionText(state.position)}, ${s.pnl > 0 ? `a profit of ${pnl}` : s.pnl < 0 ? `a loss of ${pnl}` : 'with nothing made or lost'}.`;
  return `That settles the game: ${listed(values)}, so the contract is worth ${formatGameNumber(s.value)}. ${result}`;
}

/**
 * The facts of a move on this game, in the order the server records them: the trade, the
 * reveal, and on a close the settlement. Played with the engine's transitions on the state the
 * turn was decided on, so they are exactly what the step books (the step names that state's
 * version; on any other it is refused as `stale` and nothing is posted). A move the engine would
 * refuse yields no line for its refused part: `normaliseGameMove` keeps that from happening.
 */
export function moveFacts(state: QuantGameState, move: QuantGameMove, closing: boolean): string[] {
  const now = new Date(0);
  const lines: string[] = [];
  let s = state;
  if (move.trade) {
    const out = tradeQuote(s, move.trade, now);
    if (out.ok && out.entry.kind === 'trade') {
      s = out.state;
      lines.push(tradeLine(out.entry));
    }
  }
  if (move.reveal && !closing) {
    const out = revealNext(s, now);
    if (out.ok && out.entry.kind === 'reveal') {
      s = out.state;
      lines.push(revealLine(out.entry));
    }
  }
  if (closing) {
    const out = settleGame(s, now);
    if (out.ok) lines.push(settleLine(out.state));
  }
  return lines;
}

/** The posted message: the platform's facts first, then the model's words. */
export const withFacts = (facts: readonly string[], words: string): string =>
  [...facts, words.trim()].filter(Boolean).join(' ');

/**
 * Words that claim a trade in the first person ("I'll buy two", "I'm lifting you"), for the logs
 * and the simulator: the model is told the platform states its trades, so such words either
 * repeat the facts line or contradict it.
 */
export const claimsTrade = (words: string): boolean =>
  /\bI(?:'ll|’ll| will|'m|’m| am)?\s+(?:buy|buying|sell|selling|lift|lifting|hit|hitting|take|taking)\b/i.test(
    words,
  );

// ---------------------------------------------------------------- quotes in the transcript

/**
 * Whether a candidate message is a quote posted through the quote box: its text is exactly
 * `formatQuote` of a quote in the game's log, posted at that quote's time (the API stamps both
 * with the step's clock). A market typed in the chat is not one.
 */
export function isPostedQuote(
  m: Pick<Message, 'text' | 'createdAt'>,
  state: QuantGameState,
): boolean {
  const at = Date.parse(m.createdAt);
  return state.events.some(
    (e) =>
      e.kind === 'quote' &&
      formatQuote(e) === m.text.trim() &&
      Math.abs(Date.parse(e.at) - at) <= 1500,
  );
}

// ---------------------------------------------------------------- the game in the prompt

const PAYOFF: Record<QuantGameState['spec']['payoff'], string> = {
  sum: 'the sum of the components',
  product: 'the product of the components',
  max: 'the largest component',
  min: 'the smallest component',
};

/** "uniform on 1 to 6", "0 or 1, equally likely", or the faces listed. */
export function facesText(faces: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const f of faces) counts.set(f, (counts.get(f) ?? 0) + 1);
  const values = [...counts.keys()].sort((a, b) => a - b);
  const even = new Set(counts.values()).size === 1;
  const consecutive =
    values.every(Number.isInteger) &&
    values.every((v, i) => i === 0 || v === (values[i - 1] as number) + 1);
  const fmt = (v: number) => formatGameNumber(v);
  if (even && consecutive && values.length >= 3)
    return `uniform on ${fmt(values[0] as number)} to ${fmt(values.at(-1) as number)}`;
  if (even) return `${listed(values.map(fmt)).replace(/ and /, ' or ')}, equally likely`;
  return `one of ${faces.length} equally likely faces: ${faces.map(fmt).join(', ')}`;
}

/**
 * The game's mechanics in words, for the question's system block (the same on every turn of it:
 * no state, no value).
 */
export function mechanicsText(spec: QuantGameState['spec']): string {
  const comps = spec.components.map((c, i) => `${i + 1}. ${c.label}: ${facesText(c.faces)}.`);
  const order = spec.reveal.map((i) => spec.components[i]?.label ?? `#${i + 1}`);
  const never = spec.components.filter((_, i) => !spec.reveal.includes(i)).map((c) => c.label);
  return [
    `Hidden components, each drawn independently:\n${comps.join('\n')}`,
    `The contract settles at ${PAYOFF[spec.payoff]}.`,
    order.length
      ? `You may reveal them during play in this order only: ${listed(order)}.${never.length ? ` ${listed(never)} ${never.length === 1 ? 'stays' : 'stay'} hidden until the settlement.` : ''}`
      : 'Nothing is revealed during play; every component is shown at the settlement.',
    `Prices are in steps of ${formatGameNumber(spec.tick)}; a quote is for 1 to ${spec.maxSize} contracts; the candidate may post at most ${QUANT_GAME_MAX_QUOTES} quotes.`,
  ].join('\n');
}

const signed = (x: number) => (x > 0 ? `+${formatGameNumber(x)}` : formatGameNumber(x));

/** One line of the log, from the interviewer's side for trades. */
function logLine(e: QuantGameEntry, startedAt: number): string {
  const t = `[${clock(Date.parse(e.at) - startedAt)}]`;
  switch (e.kind) {
    case 'quote':
      return `${t} quote ${formatQuote(e)}`;
    case 'trade':
      return e.candidateSide === 'sell'
        ? `${t} you bought ${e.quantity} at their offer of ${formatGameNumber(e.price)} (they sold)`
        : `${t} you sold ${e.quantity} at their bid of ${formatGameNumber(e.price)} (they bought)`;
    case 'reveal':
      return `${t} ${e.label} was revealed: ${formatGameNumber(e.value)}`;
    case 'settle':
      return `${t} settled at ${formatGameNumber(e.value)}`;
  }
}

/** Markets posted, traded, and contracts bought and sold, in the log from `from` on. */
function tally(log: readonly QuantGameEntry[]) {
  let quotes = 0;
  let traded = 0;
  let bought = 0;
  let sold = 0;
  for (const e of log) {
    if (e.kind === 'quote') quotes++;
    if (e.kind === 'trade') {
      traded++;
      if (e.candidateSide === 'sell') bought += e.quantity;
      else sold += e.quantity;
    }
  }
  return { quotes, traded, bought, sold };
}

/**
 * The game's books in words, for the per-turn system message (outside the cached prefix): what
 * the interviewer decides its move on. Everything is the books' own figures; the edges are
 * stated with their sign convention each time.
 */
export function gameBooksLines(
  entry: QuantGameSlotEntry,
  startedAt: number,
  now: number,
): string[] {
  const b = entry.books;
  const st = entry.state;
  const sd = b.sd;
  const n = formatGameNumber;
  const lines: string[] = [
    'GAME BOOKS (private, for your decisions only: never say, hint at or confirm the fair value, the true value, a hidden component, what their position is worth or their P&L, or whether you know more than they do).',
  ];
  const comps = b.components.map((c, i) => {
    const next = b.nextReveal?.component === i;
    const status = c.shown
      ? 'shown'
      : next
        ? 'hidden; the next reveal'
        : st.spec.reveal.includes(i)
          ? 'hidden; revealed later'
          : 'hidden until the settlement';
    return `${c.label} = ${n(c.value)} (${status})`;
  });
  lines.push(`Components: ${comps.join('; ')}.`);
  lines.push(
    `Public fair value now (given what has been shown): ${n(b.fair)}, standard deviation ${n(sd, 2)}, range ${n(b.min)} to ${n(b.max)}. This is what a good market is centred on. True value (the contract settles at it): ${n(b.value)}.`,
  );
  // The stage: what happened since the last reveal (the playbooks count markets per stage).
  const lastReveal = b.log.map((e) => e.kind).lastIndexOf('reveal');
  const stage = tally(b.log.slice(lastReveal + 1));
  const all = tally(b.log);
  lines.push(
    `Stage ${b.revealed + 1} (${b.revealed} reveal${b.revealed === 1 ? '' : 's'} so far). This stage: ${stage.quotes} market${stage.quotes === 1 ? '' : 's'} posted, ${stage.traded} traded; you bought ${stage.bought} and sold ${stage.sold} here. The whole game: ${all.quotes} markets, ${all.traded} trades; you bought ${all.bought} and sold ${all.sold} in all.`,
  );
  const q = b.quote;
  if (q) {
    const width = q.width;
    lines.push(
      `Live quote: ${formatQuote(q)}, posted [${clock(Date.parse(q.at) - startedAt)}], ${duration(now - Date.parse(q.at))} ago. Mid ${n(q.mid)}, width ${n(width)}${sd > 0 ? ` (${n(width / sd, 2)} standard deviations)` : ''}; the public fair value is ${q.fairInside ? 'inside' : 'outside'} it.`,
      `  trade "sell" (you hit their bid: you sell at ${n(q.bid)}, they buy): your edge per contract is bid minus value: ${signed(q.hitBid.vsFair)} against the public fair value, ${signed(q.hitBid.vsValue)} against the true value.`,
      `  trade "buy" (you lift their offer: you buy at ${n(q.ask)}, they sell): your edge per contract is value minus offer: ${signed(q.liftOffer.vsFair)} against the public fair value, ${signed(q.liftOffer.vsValue)} against the true value.`,
      `  Edges are YOURS: positive is good for you and bad for the candidate. A trade's quantity is 1 to ${q.size}; the quote is gone after any trade.`,
    );
  } else {
    lines.push(
      'Live quote: none. You cannot trade now (a trade would be dropped). If you want to trade, ask them to post a market in the quote box.',
    );
  }
  lines.push(
    `Candidate: ${positionText(b.position)}, cash ${signed(b.cash)}; marked to the public fair value ${signed(b.markToFair)}, to the true value ${signed(b.markToValue)} (their P&L: never tell them). They can see their own position.`,
  );
  if (b.nextReveal) {
    const after = gameConditional(st.spec, st.values, b.revealed + 1);
    const v = st.values[b.nextReveal.component] as number;
    lines.push(
      `Next reveal: ${b.nextReveal.label}, which is ${n(v)}; after it the public fair value would be ${n(after.fair)} (standard deviation ${n(after.sd, 2)}). Revealing withdraws the live quote.`,
    );
  } else {
    lines.push('Nothing is left to reveal (a reveal would be dropped).');
  }
  lines.push(
    b.log.length
      ? `Log: ${b.log.map((e) => logLine(e, startedAt)).join('; ')}.`
      : 'Log: nothing yet.',
  );
  lines.push(`Quotes: ${b.quotesPosted} posted, ${b.quotesLeft} left.`);
  return lines;
}

// ---------------------------------------------------------------- the review (verdict, assessment)

/**
 * `gameReview` in words: the report's analysis, code-built, for judging the decisions. "Fair" is
 * the public fair value at the time; every edge here is the CANDIDATE's.
 */
export function reviewText(review: QuantGameReview, startedAt: number): string {
  const n = formatGameNumber;
  const t = (at: string) => `[${clock(Date.parse(at) - startedAt)}]`;
  const lines = [
    `Values: ${listed(review.components.map((c) => `${c.label} ${n(c.value)}`))}; the contract is worth ${n(review.value)}. Before anything was shown: fair ${n(review.stats.fair)}, standard deviation ${n(review.stats.sd, 2)}, range ${n(review.stats.min)} to ${n(review.stats.max)}.`,
  ];
  lines.push(
    review.quotes.length
      ? `Quotes (fair = the public fair value when posted):\n${review.quotes
          .map(
            (q, i) =>
              `${i + 1}. ${t(q.at)} ${formatQuote(q)}: mid ${n(q.mid)} against fair ${n(q.fair)} (off by ${n(Math.abs(q.mid - q.fair))}), width ${n(q.width)}${q.sd > 0 ? ` (${n(q.width / q.sd, 2)} sd)` : ''}, fair ${q.fairInside ? 'inside' : 'OUTSIDE'}; ${q.traded ? 'traded' : 'not traded'}.`,
          )
          .join('\n')}`
      : 'Quotes: none.',
  );
  lines.push(
    review.trades.length
      ? `Trades (the candidate's side; the candidate's edge against the public fair value at the time):\n${review.trades
          .map(
            (x, i) =>
              `${i + 1}. ${t(x.at)} they ${x.candidateSide === 'buy' ? 'bought' : 'sold'} ${x.quantity} at ${n(x.price)} (fair ${n(x.fair)}): ${signed(x.edgePerContract)} a contract, ${signed(x.edge)} in all.`,
          )
          .join('\n')}`
      : 'Trades: none.',
  );
  if (review.reveals.length)
    lines.push(
      `Reveals:\n${review.reveals
        .map(
          (r, i) =>
            `${i + 1}. ${t(r.at)} ${r.label} showed ${n(r.value)}: fair ${n(r.fairBefore)} -> ${n(r.fairAfter)}; their mid ${r.midBefore === null ? 'none' : n(r.midBefore)} before, ${r.midAfter === null ? 'no quote after' : n(r.midAfter)} after.`,
        )
        .join('\n')}`,
    );
  lines.push(
    `Position: final ${positionText(review.finalPosition)}, largest ${review.maxAbsPosition} either way. Expected edge of their trades in all ${signed(review.expectedEdge)}; realised P&L ${signed(review.pnl)} (the difference, ${signed(review.pnl - review.expectedEdge)}, is the dice and the counterparty's information, not their skill).`,
  );
  return lines.join('\n');
}

/** The review of a game slot as it is now (settled or not). */
export const entryReview = (entry: QuantGameSlotEntry): QuantGameReview => gameReview(entry.state);
