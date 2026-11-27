/**
 * One turn of a quant round: the model's structured output (`QuantTurnSchema`), and
 * `normaliseTurn`, which turns it into a move the round's books allow. The books themselves are
 * the server's (`advanceRound`); this is where the interviewer makes sure it only ever asks for a
 * step the server will accept, whatever the model wrote.
 */
import type { QuantGameMove, QuantGameState, QuantVerdict } from '@ipp/contracts';
import { z } from 'zod';
import { normaliseGameMove } from './game';
import { parseModelJson, repairLatexEscapes } from './latex';

/**
 * The same schema serves every live call (replies, the opening, nudges, stalls, closes for time)
 * of every round, with a game or without, so the request settings never change within a round
 * and the cached prefix stays warm. Every field is required: strict structured output makes them
 * so anyway.
 *
 * Field order is the order the model writes them in (structured output keeps the schema's): the
 * reason and the action, then the game move (`trade`, `quantity`, `reveal`), so the move is
 * decided before the message that follows it is written, and the stream can check the move
 * against the books before showing a word of the message (`MessageStream`).
 */
export const QuantTurnSchema = z.object({
  /** One short sentence for the logs. */
  reason: z.string(),
  action: z.enum(['silent', 'stay', 'hint', 'follow_up', 'close']),
  /**
   * A market-making game only (else `none`): the INTERVIEWER's trade against the live quote,
   * `buy` lifting the candidate's offer, `sell` hitting their bid.
   */
  trade: z.enum(['none', 'buy', 'sell']),
  /** With a trade: whole contracts, 1 to the quote's size. Else 0. */
  quantity: z.number().int(),
  /** A game only: show the next hidden component (after the trade, if there is one). */
  reveal: z.boolean(),
  /** `hint`: the authored rung given (1-based), or 0 for a hint in its own words. Else 0. */
  hint_rung: z.number().int(),
  /** What the interviewer says. Empty only with `silent`. */
  message: z.string(),
  /** `close`: 0..1. Else 0. */
  score: z.number(),
  /** `close`: one paragraph for the report. Else "". */
  summary: z.string(),
  /** A private note for the report, or "". */
  note: z.string(),
});
export type QuantTurn = z.infer<typeof QuantTurnSchema>;

/**
 * How a turn is read: as the schema, except that a turn without the move fields is a turn with no
 * move (a provider that does not enforce the schema, or a turn written before games).
 */
const QuantTurnRead = QuantTurnSchema.extend({
  trade: z.enum(['none', 'buy', 'sell']).catch('none').default('none'),
  quantity: z.number().catch(0).default(0),
  reveal: z.boolean().catch(false).default(false),
});

/** A verdict on its own (the assessment judging a question closed without one). */
export const QuantVerdictSchema = z.object({ score: z.number(), summary: z.string() });

/**
 * A string field with the JSON that closed it written inside it: the model sometimes escapes the
 * quote that should end the string and then closes it properly, so the decoded text ends in `"}`
 * or a stray `"` (seen in live runs on the last field, `note`), once `","` (the start of a field
 * that never came), and once a trailing `<br>`. Only unbalanced trailing quotes are debris: a
 * message that ends by closing a quotation keeps it.
 */
export function stripJsonDebris(text: string): string {
  const s = text.replace(/(?:\s*<br\s*\/?>)+\s*$/i, '');
  const quotes = (s.match(/"/g) ?? []).length;
  if (quotes % 2 === 0) return s;
  return s.replace(/\s*"[\s",}]*$/, '');
}

/** The turn in the model's text, or null when it is not valid JSON of the right shape. */
export function parseTurn(text: string): QuantTurn | null {
  const parsed = QuantTurnRead.safeParse(parseModelJson(text));
  if (!parsed.success) return null;
  const t = parsed.data;
  return {
    ...t,
    reason: stripJsonDebris(t.reason),
    message: stripJsonDebris(t.message),
    summary: stripJsonDebris(t.summary),
    note: stripJsonDebris(t.note),
  };
}

/** The books of the current question that a turn must respect. */
export interface TurnBooks {
  /** As in `QuantRoundQuestion.hintRungs`: authored rungs (1-based) and 0 for own-words hints. */
  hintRungs: readonly number[];
  /** The question's authored hints. */
  hintsAvailable: number;
  followUpAsked: boolean;
  /**
   * The question's game as the round held it when the turn was decided
   * (`QuantGameSlotEntry.state`); null for a bank question, on which any move is ignored.
   */
  game?: QuantGameState | null;
}

export interface NormaliseOptions {
  /** The clock closes the question: whatever the model chose, this turn is a close. */
  forced: 'timeout' | 'round_time' | null;
  /**
   * The turn answers a candidate message sent this way; null for a proactive turn. Only a spoken
   * message may go unanswered (`silent`): the candidate is thinking aloud.
   */
  via: 'text' | 'voice' | null;
  /**
   * A proactive turn that must say something (the nudge, the opening): what to say when the
   * model said nothing. Null: a proactive turn may stay silent.
   */
  fallback: string | null;
}

/**
 * A move a turn makes. `say` is the model's words only; on a game the platform's facts of the move
 * (`moveFacts`) are put before them when the step is built. `game` is the move the books allow
 * (absent: none); `adjusted` says what of the model's move was changed or dropped, for the logs.
 */
export type QuantMove =
  | { type: 'silent'; adjusted?: string[] }
  | {
      type: 'turn';
      action: 'stay' | 'hint' | 'follow_up';
      /** `hint` only: the rung the books will record. */
      hintRung?: number;
      say: string;
      game?: QuantGameMove;
      adjusted?: string[];
    }
  | {
      type: 'close';
      by: 'interviewer' | 'timeout' | 'round_time';
      /** "" when the model wrote none: the caller supplies a closing line. */
      say: string;
      verdict: QuantVerdict | null;
      /** A last trade on the game, made before it settles. */
      game?: QuantGameMove;
      adjusted?: string[];
    }
  /** Nothing usable for a turn that must answer: the caller treats it as a failed call. */
  | { type: 'invalid'; why: string };

/** Strip role labels and wrapping quotes the model occasionally adds (as for coding replies). */
export function cleanSay(text: string): string {
  let t = text.trim();
  t = t.replace(/^(interviewer|assistant)\s*:\s*/i, '');
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"') && !t.slice(1, -1).includes('"'))
    t = t.slice(1, -1);
  return t.trim();
}

/** A message as it is posted: LaTeX escapes repaired, then cleaned. */
export const sayOf = (text: string): string => cleanSay(repairLatexEscapes(text));

/** 0..1, two decimals; anything that is not a finite number is 0. */
export const clampScore = (score: number): number =>
  Number.isFinite(score) ? Math.round(Math.min(1, Math.max(0, score)) * 100) / 100 : 0;

/** A verdict from a score and a summary; no summary, no verdict. */
export function verdictOf(score: number, summary: string): QuantVerdict | null {
  const s = repairLatexEscapes(stripJsonDebris(summary)).trim();
  return s ? { score: clampScore(score), summary: s } : null;
}

/**
 * The rung the books will record for a hint the model says is rung `requested`: the next unused
 * authored rung (never one further down, never one already given), or 0 (a hint in its own words)
 * when the model says 0, names a rung already given, or the ladder is used up.
 */
export function hintRungFor(requested: number, books: TurnBooks): number {
  const next = books.hintRungs.filter((r) => r > 0).length + 1;
  if (!Number.isFinite(requested) || requested < next) return 0;
  return next <= books.hintsAvailable ? next : 0;
}

/**
 * The move a turn makes, kept inside what the round's books allow:
 *
 * 1. `message` and `summary` have their LaTeX escapes repaired; the message is cleaned.
 * 2. A forced turn (the clock closes the question) is a close by the clock, whatever the action.
 * 3. `close` is a close by the interviewer. Its verdict is the score clamped to 0..1 (two
 *    decimals) with the summary; an empty summary means no verdict (null).
 * 4. `hint` records the rung from `hintRungFor` (clamped to the next unused authored rung, never
 *    skipping one; 0 for its own words).
 * 5. `follow_up` when the question's one follow-up was already asked is a plain `stay`.
 * 6. The game move (`turnGameMove`): ignored on a bank question; on a game kept inside the
 *    books (`normaliseGameMove`): no trade without a live quote, the quantity clamped to the
 *    quote's size, no reveal with nothing left or on a close. A turn that says nothing makes no
 *    move. On a game `follow_up` is a plain `stay` (a game has no follow-up: the trading is the
 *    dialogue).
 * 7. A turn with nothing to say (`silent`, or any other action with an empty message and no
 *    move; a move needs no words, the platform's facts line says it):
 *    - a reply to a spoken message is silent (they are thinking aloud);
 *    - a reply to a typed message is invalid: it must be answered (the caller sends the canned
 *      reply), except that `silent` with a message is posted as a `stay`;
 *    - a proactive turn is silent; one that must speak says its message as a `stay`, or
 *      `fallback` when it has none. A `silent` turn that need not speak says nothing even if the
 *      model wrote a message.
 */
export function normaliseTurn(out: QuantTurn, books: TurnBooks, opts: NormaliseOptions): QuantMove {
  const say = sayOf(out.message);
  const verdict = verdictOf(out.score, out.summary);
  const closing = opts.forced !== null || out.action === 'close';
  const { move, adjusted } = turnGameMove(out, books.game ?? null, closing);
  const extra = adjusted.length ? { adjusted } : {};
  const game = move.trade || move.reveal ? { game: move } : {};

  if (opts.forced) return { type: 'close', by: opts.forced, say, verdict, ...game, ...extra };
  if (out.action === 'close')
    return { type: 'close', by: 'interviewer', say, verdict, ...game, ...extra };

  const nothing = (): QuantMove => {
    const notes = [...adjusted, ...(game.game ? ['move dropped: the turn says nothing'] : [])];
    const why = notes.length ? { adjusted: notes } : {};
    if (opts.via === 'voice') return { type: 'silent', ...why };
    if (opts.via === 'text') {
      if (out.action === 'silent' && say) return { type: 'turn', action: 'stay', say, ...why };
      return { type: 'invalid', why: 'a typed message needs a reply' };
    }
    if (opts.fallback) return { type: 'turn', action: 'stay', say: say || opts.fallback, ...why };
    return { type: 'silent', ...why };
  };

  if (out.action === 'silent' || (!say && !game.game)) return nothing();
  // A move without words on a turn that must speak (the nudge) still says what it must.
  const spoken = say || opts.fallback || '';
  if (out.action === 'hint')
    return {
      type: 'turn',
      action: 'hint',
      hintRung: hintRungFor(out.hint_rung, books),
      say: spoken,
      ...game,
      ...extra,
    };
  if (out.action === 'follow_up' && !books.followUpAsked && !books.game)
    return { type: 'turn', action: 'follow_up', say: spoken, ...game, ...extra };
  return { type: 'turn', action: 'stay', say: spoken, ...game, ...extra };
}

/**
 * The game move of a turn's fields: none on a bank question (noted when the model made one), and
 * on a game what `normaliseGameMove` allows. Shared by `normaliseTurn` and the stream's gate, so
 * what is streamed is decided on exactly the move that is posted.
 */
export function turnGameMove(
  out: Pick<QuantTurn, 'trade' | 'quantity' | 'reveal'>,
  game: QuantGameState | null,
  closing: boolean,
): { move: QuantGameMove; adjusted: string[] } {
  if (!game) {
    const made = out.trade !== 'none' || out.reveal;
    return { move: {}, adjusted: made ? ['move ignored: not a game'] : [] };
  }
  return normaliseGameMove(game, out, closing);
}
