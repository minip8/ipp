/**
 * One turn of a quant round: the model's structured output (`QuantTurnSchema`), and
 * `normaliseTurn`, which turns it into a move the round's books allow. The books themselves are
 * the server's (`advanceRound`); this is where the interviewer makes sure it only ever asks for a
 * step the server will accept, whatever the model wrote.
 */
import type { QuantVerdict } from '@ipp/contracts';
import { z } from 'zod';
import { parseModelJson, repairLatexEscapes } from './latex';

/**
 * The same schema serves every live call (replies, the opening, nudges, stalls, closes for time),
 * so the request settings never change within a round and the cached prefix stays warm. Every
 * field is required: strict structured output makes them so anyway.
 */
export const QuantTurnSchema = z.object({
  /** One short sentence for the logs. */
  reason: z.string(),
  action: z.enum(['silent', 'stay', 'hint', 'follow_up', 'close']),
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

/** A verdict on its own (the assessment judging a question closed without one). */
export const QuantVerdictSchema = z.object({ score: z.number(), summary: z.string() });

/**
 * A string field with the JSON that closed it written inside it: the model sometimes escapes the
 * quote that should end the string and then closes it properly, so the decoded text ends in `"}`
 * or a stray `"` (seen in live runs on the last field, `note`), and once a trailing `<br>`. Only an
 * unbalanced trailing quote is debris: a message that ends by closing a quotation keeps it.
 */
export function stripJsonDebris(text: string): string {
  const s = text.replace(/(?:\s*<br\s*\/?>)+\s*$/i, '');
  const quotes = (s.match(/"/g) ?? []).length;
  if (quotes % 2 === 0) return s;
  return s.replace(/\s*"\s*}?\s*$/, '');
}

/** The turn in the model's text, or null when it is not valid JSON of the right shape. */
export function parseTurn(text: string): QuantTurn | null {
  const parsed = QuantTurnSchema.safeParse(parseModelJson(text));
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

export type QuantMove =
  | { type: 'silent' }
  | {
      type: 'turn';
      action: 'stay' | 'hint' | 'follow_up';
      /** `hint` only: the rung the books will record. */
      hintRung?: number;
      say: string;
    }
  | {
      type: 'close';
      by: 'interviewer' | 'timeout' | 'round_time';
      /** "" when the model wrote none: the caller supplies a closing line. */
      say: string;
      verdict: QuantVerdict | null;
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
 * 6. A turn with nothing to say (`silent`, or any other action with an empty message):
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

  if (opts.forced) return { type: 'close', by: opts.forced, say, verdict };
  if (out.action === 'close') return { type: 'close', by: 'interviewer', say, verdict };

  const nothing = (): QuantMove => {
    if (opts.via === 'voice') return { type: 'silent' };
    if (opts.via === 'text') {
      if (out.action === 'silent' && say) return { type: 'turn', action: 'stay', say };
      return { type: 'invalid', why: 'a typed message needs a reply' };
    }
    if (opts.fallback) return { type: 'turn', action: 'stay', say: say || opts.fallback };
    return { type: 'silent' };
  };

  if (out.action === 'silent' || !say) return nothing();
  if (out.action === 'hint')
    return { type: 'turn', action: 'hint', hintRung: hintRungFor(out.hint_rung, books), say };
  if (out.action === 'follow_up' && !books.followUpAsked)
    return { type: 'turn', action: 'follow_up', say };
  return { type: 'turn', action: 'stay', say };
}
