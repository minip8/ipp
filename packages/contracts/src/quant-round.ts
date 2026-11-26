/**
 * The live quant round: a pad of format `quant` in which the AI interviewer asks a few questions
 * from the quant track one after another, out loud or in chat, under a clock. The questions come
 * from the quiz bank (`short` and `numeric` ones that have a hint ladder or follow-ups); the
 * candidate works on the pad's scratchpad (`YDOC.notes`) and the whiteboard.
 *
 * The round's state (`QuantRoundState`) is server-only and lives in `quant_rounds.state`. It holds
 * the question ids and the interviewer's verdicts, which the browser never sees while the pad is
 * active; what it does see is `QuantRoundView`, made by `publicRound`. Every change to the state
 * goes through `advanceRound`, one pure transition per step, shared by the API (which wraps it in
 * a compare-and-swap on `quant_rounds.version`), the interviewer's test harness and the browser
 * tests' mock API, so all three play the same round.
 *
 *   pending ──start──▶ asking(0) ──turn──▶ asking(0) ──close──▶ asking(1) … ──close──▶ finished
 *      └───────────────────────── end (the pad ended) ─────────────────────────────▶ finished
 *   finished: only `verdict` (the assessment judging a question closed without one)
 *
 * A slot may hold a market-making game instead of a bank question (`QuantRoundQuestion.game`,
 * quant-game.ts, ARCHITECTURE §8.3). While it is the current question the candidate posts quotes
 * (`quote`, raised by the API) and the interviewer's `turn` may trade against the live quote
 * and/or reveal the next component (`QuantGameMove`); every way the question closes (`close`,
 * `end`) settles the game. Its hidden values stay in the state; the view carries `gameView`.
 *
 *   asking(i, game) ──quote──▶ live quote ──turn + trade──▶ no quote ──quote──▶ … ──close──▶ settled
 *                       └──turn + reveal (withdraws the quote)──┘
 */
import { z } from 'zod';
import { Id, IsoDate, Slug } from './common';
import type { MessageIntent } from './pad';
import {
  createGameState,
  drawGame,
  formatQuote,
  gameReview,
  gameView,
  postQuote,
  type QuantGame,
  type QuantGameEntry,
  type QuantGameRefusal,
  QuantGameReview,
  QuantGameState,
  type QuantGameTrade,
  QuantGameView,
  revealNext,
  settleGame,
  tradeQuote,
} from './quant-game';
import { QuantPath, QuizDifficulty } from './quiz';

// ---------------------------------------------------------------- length and clock

/** Round lengths offered, in minutes. */
export const QUANT_ROUND_DURATIONS = [20, 30, 45] as const;
export const QuantRoundDuration = z.union([z.literal(20), z.literal(30), z.literal(45)]);
export type QuantRoundDuration = z.infer<typeof QuantRoundDuration>;

/** How many questions a round of `durationMin` asks: 3, 4 and 6 for the offered lengths. */
export const quantQuestionCount = (durationMin: number) => Math.round(durationMin / 7.5);

/** Kept free at the end of the round for the wrap-up; no question's budget counts on it. */
export const QUANT_WRAP_UP_SEC = 60;
/**
 * The smallest budget a question gets. A question is revealed only while at least this much of
 * the round is left, so no budget runs past the round's end; otherwise the round finishes.
 */
export const QUANT_BUDGET_MIN_SEC = 120;
/** A budget is at most this many times the even share (`durationMin * 60 / total`). */
export const QUANT_BUDGET_MAX_FACTOR = 1.5;
/** The grace after a question's budget before it is closed for time: a quarter, at most this. */
export const QUANT_GRACE_MAX_SEC = 90;

/**
 * How far ahead of the round's clock a close for time may be asked for. The round runs on the
 * database's clock and the interviewer decides on the API's, so a close it asks for as the time
 * runs out could otherwise be refused as `too_early` by a clock a moment behind its own.
 */
export const QUANT_CLOCK_SKEW_MS = 5_000;

/** When the round's clock runs out: the pad's start plus the round's length (the top bar's clock). */
export const quantRoundEndsAt = (startedAt: Date | string, durationMin: number): Date =>
  new Date(new Date(startedAt).getTime() + durationMin * 60_000);

/** The grace a question with this budget gets: a quarter of it, at most `QUANT_GRACE_MAX_SEC`. */
export const quantGraceSec = (budgetSec: number) =>
  Math.min(QUANT_GRACE_MAX_SEC, Math.floor(budgetSec / 4));

/**
 * The time a question gets when it is revealed, and its grace. Time a candidate did not use on
 * earlier questions rolls forward: the round's time left (less the wrap-up) is shared evenly
 * between this question and the ones still to come,
 *
 *   budgetSec = clamp((roundEndsAt − now − QUANT_WRAP_UP_SEC) / remaining,
 *                     QUANT_BUDGET_MIN_SEC, QUANT_BUDGET_MAX_FACTOR × durationMin·60 / total)
 *
 * in whole seconds, rounded down. `remaining` counts this question and every one not yet posed
 * (`total − index`). The grace is `quantGraceSec(budgetSec)`.
 */
export function quantBudgetSec(a: {
  durationMin: number;
  total: number;
  remaining: number;
  now: Date | number;
  roundEndsAt: Date | number;
}): { budgetSec: number; graceSec: number } {
  const base = (a.durationMin * 60) / Math.max(1, a.total);
  const hi = Math.max(QUANT_BUDGET_MIN_SEC, QUANT_BUDGET_MAX_FACTOR * base);
  const leftSec = (+a.roundEndsAt - +a.now) / 1000 - QUANT_WRAP_UP_SEC;
  const share = leftSec / Math.max(1, a.remaining);
  const budgetSec = Math.floor(Math.min(hi, Math.max(QUANT_BUDGET_MIN_SEC, share)));
  return { budgetSec, graceSec: quantGraceSec(budgetSec) };
}

// ---------------------------------------------------------------- what the browser sees

/**
 *  interviewer  the interviewer judged the question done (answered, or given up on)
 *  timeout      its budget and grace ran out
 *  round_time   the round's clock ran out while it was open
 *  ended        the pad was ended while it was open
 */
export const QuantClosedBy = z.enum(['interviewer', 'timeout', 'round_time', 'ended']);
export type QuantClosedBy = z.infer<typeof QuantClosedBy>;

export const QuantPhase = z.enum(['pending', 'asking', 'finished']);
export type QuantPhase = z.infer<typeof QuantPhase>;

/**
 * A question that has been posed, as everyone in the pad sees it. No question id and no
 * subtopic: both hint at the method (and the id finds the answer in the question bank).
 */
export const QuantQuestionView = z.object({
  index: z.int().min(0),
  topic: Slug,
  /** The topic's title when the round was assembled (the slug for a round stored before that). */
  topicTitle: z.string(),
  difficulty: QuizDifficulty,
  /** The exact bank text (Markdown with LaTeX). */
  prompt: z.string(),
  /** numeric questions that have one: the unit the answer is in */
  unit: z.string().nullable(),
  posedAt: IsoDate,
  /** The time the question was given when it was posed (`quantBudgetSec`). */
  budgetSec: z.int(),
  /** null while it is the current question. */
  closedAt: IsoDate.nullable(),
  /**
   * How it closed (null while open). Not sensitive: everyone in the pad saw it happen, and the
   * pad says so ("timed out") rather than leaving it to the report.
   */
  closedBy: QuantClosedBy.nullable(),
  /** Hints given so far, the interviewer's own included. Never their text. */
  hintsGiven: z.int().min(0),
  /**
   * The `question` message that posed it: the chat numbers a question message by looking its id
   * up here, not by counting messages (which breaks once a transcript is paged or capped).
   */
  posedMessageId: Id.nullable(),
  /**
   * A game's public view (`gameView`: no hidden value, no fair value); null for a bank question
   * (and absent from servers before games, hence the default).
   */
  game: QuantGameView.nullable().default(null),
});
export type QuantQuestionView = z.infer<typeof QuantQuestionView>;

/** `PadDetail.round` and the `round.updated` event: the round as the browser may see it. */
export const QuantRoundView = z.object({
  path: QuantPath,
  /** Questions in the round, posed or not. */
  total: z.int().min(0),
  phase: QuantPhase,
  /** The posed questions only, in order; while `asking` the last is the current one. */
  questions: z.array(QuantQuestionView),
  /** `quant_rounds.version`: a client keeps the view with the highest version it has seen. */
  version: z.int().min(0),
});
export type QuantRoundView = z.infer<typeof QuantRoundView>;

// ---------------------------------------------------------------- server-only state

/** The interviewer's judgement of one answer. SERVER-ONLY until the pad ends. */
export const QuantVerdict = z.object({
  /** 0..1 */
  score: z.number().min(0).max(1),
  /** One paragraph: what was right, what was missing. */
  summary: z.string(),
});
export type QuantVerdict = z.infer<typeof QuantVerdict>;

/**
 * One question of a round. SERVER-ONLY (`quant_rounds.state`): the id and the verdict never reach
 * the browser while the pad is active, and nothing about a question does until it is posed.
 */
export const QuantRoundQuestion = z.object({
  questionId: Slug,
  topic: Slug,
  difficulty: QuizDifficulty,
  /**
   * The topic's title. Snapshotted with the prompt; absent in rounds assembled before it was
   * (`quant_rounds.state` is read without parsing), so readers fall back to `topic`.
   */
  topicTitle: z.string().optional(),
  /** Snapshot of the bank question when the round was assembled, so a reveal needs no lookup. */
  prompt: z.string(),
  unit: z.string().nullable(),
  /** Authored hints the question has (the length of its `hints`). */
  hintsAvailable: z.int().min(0),
  /** null until posed. */
  posedAt: IsoDate.nullable(),
  /** The `question` message that posed it. */
  posedMessageId: Id.nullable(),
  budgetSec: z.int().nullable(),
  /** When the interviewer said the budget was up; at most once. */
  nudgedAt: IsoDate.nullable(),
  /**
   * Hints given, in order: the authored rung (1-based) or 0 for one in the interviewer's own
   * words. Authored rungs are given in order, none skipped and none twice.
   */
  hintRungs: z.array(z.int().min(0)),
  /** At most one follow-up per question. */
  followUpAsked: z.boolean(),
  closedAt: IsoDate.nullable(),
  closedBy: QuantClosedBy.nullable(),
  /** null until judged; a question closed for time or by the pad's end may be judged later. */
  verdict: QuantVerdict.nullable(),
  /**
   * A market-making game in this slot (`questionId` is then the game's id, `prompt` its prompt).
   * Absent for a bank question, and in every round stored before games existed: readers treat
   * absent and null alike (`q.game ?? null`).
   */
  game: QuantGameState.nullable().optional(),
});
export type QuantRoundQuestion = z.infer<typeof QuantRoundQuestion>;

/** `quant_rounds.state`. SERVER-ONLY; the browser gets `publicRound(state, version)`. */
export const QuantRoundState = z.object({
  path: QuantPath,
  durationMin: z.int().min(1),
  questions: z.array(QuantRoundQuestion),
  /** -1 while pending, the current question's index while asking, `questions.length` when finished. */
  current: z.int().min(-1),
});
export type QuantRoundState = z.infer<typeof QuantRoundState>;

/**
 * What the round's assembly picks for one slot (`createQuantRound`). A game slot carries the
 * drawn game (`quantGamePick`).
 */
export type QuantPick = Pick<
  QuantRoundQuestion,
  'questionId' | 'topic' | 'difficulty' | 'prompt' | 'unit' | 'hintsAvailable'
> & { topicTitle: string; game?: QuantGameState };

/**
 * The slot of a game: its hidden values drawn now from `rand` (the assembler's seeded PRNG), its
 * mechanics and title snapshotted. `hintsAvailable` counts the game's authored hints.
 */
export function quantGamePick(game: QuantGame, topicTitle: string, rand: () => number): QuantPick {
  return {
    questionId: game.id,
    topic: game.topic,
    topicTitle,
    difficulty: game.difficulty,
    prompt: game.prompt,
    unit: null,
    hintsAvailable: game.hints.length,
    game: createGameState(game, drawGame(game, rand)),
  };
}

/** A pending round over the assembled questions, in the order they will be asked. */
export const createQuantRound = (
  path: QuantPath,
  durationMin: number,
  picks: readonly QuantPick[],
): QuantRoundState => ({
  path,
  durationMin,
  current: -1,
  questions: picks.map((p) => ({
    questionId: p.questionId,
    topic: p.topic,
    topicTitle: p.topicTitle,
    difficulty: p.difficulty,
    prompt: p.prompt,
    unit: p.unit,
    hintsAvailable: p.hintsAvailable,
    posedAt: null,
    posedMessageId: null,
    budgetSec: null,
    nudgedAt: null,
    hintRungs: [],
    followUpAsked: false,
    closedAt: null,
    closedBy: null,
    verdict: null,
    // A bank question's slot stays exactly as before games existed.
    ...(p.game ? { game: p.game } : {}),
  })),
});

export const quantPhase = (state: Pick<QuantRoundState, 'current' | 'questions'>): QuantPhase =>
  state.current < 0 ? 'pending' : state.current >= state.questions.length ? 'finished' : 'asking';

/**
 * The browser's view of a round: the posed questions only, field by field, so nothing the view
 * does not name (question ids, subtopics, verdicts, hint rungs, nudges, the prompts still to
 * come) can reach it. How a question closed is named: it happened in front of everyone.
 */
export function publicRound(state: QuantRoundState, version: number): QuantRoundView {
  const questions: QuantQuestionView[] = [];
  state.questions.forEach((q, index) => {
    if (q.posedAt === null) return;
    questions.push({
      index,
      topic: q.topic,
      topicTitle: q.topicTitle ?? q.topic,
      difficulty: q.difficulty,
      prompt: q.prompt,
      unit: q.unit,
      posedAt: q.posedAt,
      budgetSec: q.budgetSec ?? 0,
      closedAt: q.closedAt,
      closedBy: q.closedBy,
      hintsGiven: q.hintRungs.length,
      posedMessageId: q.posedMessageId,
      game: q.game ? gameView(q.game) : null,
    });
  });
  return {
    path: state.path,
    total: state.questions.length,
    phase: quantPhase(state),
    questions,
    version,
  };
}

// ---------------------------------------------------------------- report (after the pad ended)

/**
 *  answered     the interviewer closed it
 *  timed_out    closed when its budget and grace ran out
 *  unfinished   open when the round's clock ran out or the pad was ended
 *  not_reached  never posed
 */
export const QuantQuestionStatus = z.enum(['answered', 'timed_out', 'unfinished', 'not_reached']);
export type QuantQuestionStatus = z.infer<typeof QuantQuestionStatus>;

export function quantQuestionStatus(
  q: Pick<QuantRoundQuestion, 'posedAt' | 'closedBy'>,
): QuantQuestionStatus {
  if (q.posedAt === null) return 'not_reached';
  if (q.closedBy === 'interviewer') return 'answered';
  if (q.closedBy === 'timeout') return 'timed_out';
  return 'unfinished';
}

/** Whole seconds from posing to closing; null for a question not posed or still open. */
export function quantTimeSec(q: Pick<QuantRoundQuestion, 'posedAt' | 'closedAt'>): number | null {
  if (q.posedAt === null || q.closedAt === null) return null;
  return Math.max(0, Math.round((Date.parse(q.closedAt) - Date.parse(q.posedAt)) / 1000));
}

/**
 * One question in a quant pad's report (`Report.quant`), only after the pad ended. Built when the
 * report is read, from the round's state and the bank question. The hints' and follow-ups' text
 * never leaves the server: the report has their counts, and the hints actually given are in the
 * transcript in the interviewer's words.
 */
export const QuantQuestionReview = z.object({
  index: z.int().min(0),
  questionId: Slug,
  topic: Slug,
  /** As in `QuantQuestionView`: the slug for a round stored before titles were snapshotted. */
  topicTitle: z.string(),
  /** A game has none: empty. */
  subtopic: z.string(),
  difficulty: QuizDifficulty,
  type: z.enum(['short', 'numeric', 'game']),
  prompt: z.string(),
  unit: z.string().nullable(),
  /**
   * short: the reference answer; numeric: `answerText`, else the answer itself; game: its figures
   * before anything was shown (`gameSolution`, plain text).
   */
  solution: z.string(),
  /** short questions; empty for numeric and game. */
  keyPoints: z.array(z.string()),
  /** The authored explanation (a game's from its content; empty when the content is gone). */
  explanation: z.string(),
  status: QuantQuestionStatus,
  verdict: QuantVerdict.nullable(),
  hintsGiven: z.int().min(0),
  hintsAvailable: z.int().min(0),
  timeSec: z.int().nullable(),
  budgetSec: z.int().nullable(),
  /**
   * A posed game's analysis (`quantGameReview`); null for a bank question and a game never
   * posed (and absent from reports built before games, hence the default).
   */
  game: QuantGameReview.nullable().default(null),
});
export type QuantQuestionReview = z.infer<typeof QuantQuestionReview>;

/** `QuantQuestionReview.game` for a round question: its game's review once posed, else null. */
export const quantGameReview = (
  q: Pick<QuantRoundQuestion, 'posedAt' | 'game'>,
): QuantGameReview | null => (q.game && q.posedAt !== null ? gameReview(q.game) : null);

export const QuantReport = z.object({
  path: QuantPath,
  questions: z.array(QuantQuestionReview),
});
export type QuantReport = z.infer<typeof QuantReport>;

// ---------------------------------------------------------------- steps (the interviewer's seam)

/**
 * The current question's clock, in epoch milliseconds, for the interviewer's proactive checks
 * (nudge at `posedAt + budgetMs`, close for time at `+ graceMs` more, close at `roundEndsAt`).
 */
export interface QuantClock {
  index: number;
  posedAt: number;
  budgetMs: number;
  graceMs: number;
  nudged: boolean;
  roundEndsAt: number;
}

/** The clock of the current question; null unless the round is asking. */
export function quantClock(state: QuantRoundState, roundEndsAt: Date | number): QuantClock | null {
  if (quantPhase(state) !== 'asking') return null;
  const q = state.questions[state.current];
  if (!q || q.posedAt === null) return null;
  const budgetSec = q.budgetSec ?? 0;
  return {
    index: state.current,
    posedAt: Date.parse(q.posedAt),
    budgetMs: budgetSec * 1000,
    graceMs: quantGraceSec(budgetSec) * 1000,
    nudged: q.nudgedAt !== null,
    roundEndsAt: +roundEndsAt,
  };
}

/**
 * What the interviewer asks the round to do (`InterviewerDeps.applyQuantStep`). Every step names
 * the round's `version` it was decided on; a step on an older version is refused as `stale` and
 * its message dropped. `say` is the interviewer's message, posted before anything the step
 * reveals (null: say nothing). `note` is a private note to itself.
 *
 *  start    the round begins: the first question is revealed (only while pending)
 *  turn     the conversation goes on with the current question: `stay`, a `hint` (with the rung
 *           given: the next authored one, or 0 for its own words) or the one `follow_up`;
 *           `nudge` marks the message that says the budget is up (once per question). On a game
 *           it may also make a `game` move: a trade against the live quote, a reveal, or both
 *           (the trade first); the whole step is refused when any part of it is.
 *  close    the current question is done; the next is revealed, or the round finishes when none
 *           is left, the round's clock has run out, or too little of it is left for another
 *           (`QUANT_BUDGET_MIN_SEC`). `timeout` needs the question's budget to be up and
 *           `round_time` the round's clock.
 *  verdict  the judgement of a question closed without one (any phase, the round finished included)
 */
export type QuantStep =
  | { type: 'start'; version: number; say: string | null; note?: string }
  | {
      type: 'turn';
      version: number;
      index: number;
      kind: 'chat' | 'proactive';
      say: string | null;
      action: 'stay' | 'hint' | 'follow_up';
      /** `hint` only (ignored otherwise): the authored rung, 1-based, or 0. */
      hintRung?: number;
      nudge?: boolean;
      note?: string;
      /** A game only (`not_game` otherwise). */
      game?: QuantGameMove;
    }
  | {
      type: 'close';
      version: number;
      index: number;
      kind: 'chat' | 'proactive';
      say: string | null;
      by: 'interviewer' | 'timeout' | 'round_time';
      verdict: QuantVerdict | null;
      note?: string;
    }
  | { type: 'verdict'; version: number; index: number; verdict: QuantVerdict };

/**
 * The pad ended (or is being deleted): the open question is closed as `ended`, the rest are never
 * posed. Raised by the API only, so it is not a `QuantStep`, and it is valid on any version (the
 * caller's compare-and-swap still guards the write). Refused as `ended` when already finished.
 */
export type QuantEndStep = { type: 'end' };

/**
 * The interviewer's move in a game, inside a `turn` (in this order when both are given):
 *  trade   trade against the candidate's live quote (`QuantGameTrade`: the INTERVIEWER's side,
 *          `buy` lifting the offer or `sell` hitting the bid, and a whole quantity up to the
 *          quote's size); the quote is consumed
 *  reveal  show the next component in the game's reveal order; the live quote is withdrawn
 * A move with neither is no move.
 */
export interface QuantGameMove {
  trade?: QuantGameTrade;
  reveal?: boolean;
}

/**
 * The candidate posted a market on question `index` (`PostQuantQuoteRequest`). Raised by the API
 * only, so it is not a `QuantStep`, and like `end` it is valid on any version (the caller's
 * compare-and-swap guards the write). Valid only while `index` is the current question and a
 * game: it replaces the live quote, and its effects post `formatQuote(quote)` as the candidate's
 * message.
 */
export type QuantQuoteStep = {
  type: 'quote';
  index: number;
  bid: number;
  ask: number;
  size: number;
};

export type QuantRoundStep = QuantStep | QuantEndStep | QuantQuoteStep;

/**
 * Why a step was refused. Nothing changes and no message is posted.
 *
 *  stale           decided on an older version of the round
 *  ended           the round has finished (only `verdict` is accepted then)
 *  wrong_phase     `start` when not pending; `turn` / `close` / `quote` while pending
 *  wrong_index     not the current question (`turn`, `close`, `quote`) or no such question (`verdict`)
 *  hint_rung       a missing, skipped, repeated or non-existent authored rung
 *  follow_up_used  the question's one follow-up was already asked
 *  nudged          the question was already nudged
 *  too_early       `close` for `timeout` before the budget is up, or `round_time` before the clock
 *                  (by more than `QUANT_CLOCK_SKEW_MS`)
 *  not_closed      `verdict` for a question that is open or was never posed
 *  has_verdict     `verdict` for a question that already has one
 *  invalid         a verdict outside 0..1, a rung that is not a whole number, or a trade's side
 *                  that is neither `buy` nor `sell`
 *  not_game        a `quote`, or a `turn` with a game move, on a question that is not a game
 *  …               and the game's own (`QuantGameRefusal`): `bad_quote`, `quote_limit`,
 *                  `no_quote`, `bad_quantity`, `nothing_to_reveal`, `game_settled`
 */
export type QuantRefusal =
  | 'stale'
  | 'ended'
  | 'wrong_phase'
  | 'wrong_index'
  | 'hint_rung'
  | 'follow_up_used'
  | 'nudged'
  | 'too_early'
  | 'not_closed'
  | 'has_verdict'
  | 'invalid'
  | 'not_game'
  | QuantGameRefusal;

/** What `applyQuantStep` tells the interviewer. On success, the round's new version and clock. */
export type QuantStepResult =
  | { ok: true; version: number; phase: QuantPhase; clock: QuantClock | null }
  | { ok: false; reason: QuantRefusal };

/** What the caller of `advanceRound` must do, in this order, in the same transaction as the write. */
export interface QuantEffects {
  /** Post the interviewer's message (role interviewer). */
  say: { text: string; kind: 'chat' | 'proactive'; intent: MessageIntent } | null;
  /**
   * Post the revealed question: a proactive interviewer message with intent `question`, id
   * `messageId` and exactly `text` (the bank prompt), and a `question` timeline event.
   */
  reveal: { index: number; total: number; messageId: string; text: string } | null;
  /** Append to the interviewer's private notes. */
  note: string | null;
  /** The round finished with this step. */
  finished: boolean;
  /**
   * A `quote` step: post `text` (`formatQuote`) as the poster's chat message (role candidate,
   * kind chat, no intent), before the game's timeline event for it.
   */
  quote: { index: number; text: string } | null;
  /**
   * What the step did to question `index`'s game, in order (a quote; a trade then a reveal; the
   * settlement when the question closed): record each as a `game` timeline event
   * `{ type: 'game', index, entry }`, after `say` and before the next question's `reveal`.
   */
  game: { index: number; entries: QuantGameEntry[] } | null;
}

export type QuantAdvance =
  | { ok: true; state: QuantRoundState; version: number; effects: QuantEffects }
  | { ok: false; reason: QuantRefusal };

export interface QuantAdvanceEnv {
  /** `quant_rounds.version` of `state`; the result's version is one more. */
  version: number;
  now: Date;
  /** `quantRoundEndsAt(pad.startedAt, state.durationMin)` */
  roundEndsAt: Date;
  /** Id for a revealed question's message (`randomUUID` in the API). */
  newId: () => string;
}

/** The intent of the message a step says, decided here so every caller labels it the same. */
function sayIntent(step: QuantStep, finishes: boolean): MessageIntent {
  switch (step.type) {
    case 'start':
      return 'greeting';
    case 'turn':
      if (step.action === 'hint') return 'hint';
      if (step.action === 'follow_up') return 'probe';
      if (step.nudge) return 'time_check';
      return step.kind === 'chat' ? 'answer' : 'nudge';
    case 'close':
      return finishes || step.by === 'round_time' ? 'wrap_up' : 'feedback';
    case 'verdict':
      return 'feedback';
  }
}

const refuse = (reason: QuantRefusal): QuantAdvance => ({ ok: false, reason });

/**
 * One transition of the round (the module comment draws them). Pure: the input state is never
 * modified. Every illegal or repeated step is a refusal (`QuantRefusal`), never a throw.
 *
 * A reveal (by `start` or `close`) poses the next question with `posedAt = now` and its budget
 * from `quantBudgetSec`; when less than `QUANT_BUDGET_MIN_SEC` of the round is left, or no
 * question is left, the round finishes instead. Closing a question that holds a game settles it
 * (`settleGame`) first.
 */
export function advanceRound(
  state: QuantRoundState,
  step: QuantRoundStep,
  env: QuantAdvanceEnv,
): QuantAdvance {
  const phase = quantPhase(state);
  if (phase === 'finished' && step.type !== 'verdict') return refuse('ended');
  if (step.type !== 'end' && step.type !== 'quote' && step.version !== env.version)
    return refuse('stale');

  const nowIso = env.now.toISOString();
  const questions = state.questions.map((q) => ({ ...q, hintRungs: [...q.hintRungs] }));
  const next: QuantRoundState = { ...state, questions };
  const effects: QuantEffects = {
    say: null,
    reveal: null,
    note: null,
    finished: false,
    quote: null,
    game: null,
  };
  // The game transitions return new states (the copy above shares `game` with the input).
  const entries: QuantGameEntry[] = [];
  const settle = (q: QuantRoundQuestion | undefined) => {
    if (!q?.game || q.game.settlement) return;
    const out = settleGame(q.game, env.now);
    if (!out.ok) return;
    q.game = out.state;
    entries.push(out.entry);
  };

  /** Poses question `index`, or finishes the round when it cannot. */
  const reveal = (index: number) => {
    const q = questions[index];
    const leftMs = env.roundEndsAt.getTime() - env.now.getTime();
    if (!q || leftMs < QUANT_BUDGET_MIN_SEC * 1000) {
      next.current = questions.length;
      effects.finished = true;
      return;
    }
    const { budgetSec } = quantBudgetSec({
      durationMin: state.durationMin,
      total: questions.length,
      remaining: questions.length - index,
      now: env.now,
      roundEndsAt: env.roundEndsAt,
    });
    const messageId = env.newId();
    q.posedAt = nowIso;
    q.posedMessageId = messageId;
    q.budgetSec = budgetSec;
    next.current = index;
    effects.reveal = { index, total: questions.length, messageId, text: q.prompt };
  };

  switch (step.type) {
    case 'end': {
      const open = phase === 'asking' ? questions[state.current] : undefined;
      if (open) {
        open.closedAt = nowIso;
        open.closedBy = 'ended';
        settle(open);
      }
      next.current = questions.length;
      effects.finished = true;
      break;
    }

    case 'start': {
      if (phase !== 'pending') return refuse('wrong_phase');
      reveal(0);
      break;
    }

    case 'turn': {
      if (phase !== 'asking') return refuse('wrong_phase');
      if (step.index !== state.current) return refuse('wrong_index');
      const q = questions[state.current];
      if (!q) return refuse('wrong_index');
      if (step.action === 'hint') {
        const rung = step.hintRung;
        if (rung === undefined) return refuse('hint_rung');
        if (!Number.isInteger(rung) || rung < 0) return refuse('invalid');
        if (rung > 0) {
          const given = q.hintRungs.filter((r) => r > 0).length;
          if (rung !== given + 1 || rung > q.hintsAvailable) return refuse('hint_rung');
        }
        q.hintRungs.push(rung);
      } else if (step.action === 'follow_up') {
        if (q.followUpAsked) return refuse('follow_up_used');
        q.followUpAsked = true;
      }
      if (step.nudge) {
        if (q.nudgedAt !== null) return refuse('nudged');
        q.nudgedAt = nowIso;
      }
      const move = step.game;
      if (move && (move.trade || move.reveal)) {
        if (!q.game) return refuse('not_game');
        let game = q.game;
        if (move.trade) {
          const out = tradeQuote(game, move.trade, env.now);
          if (!out.ok) return refuse(out.reason);
          game = out.state;
          entries.push(out.entry);
        }
        if (move.reveal) {
          const out = revealNext(game, env.now);
          if (!out.ok) return refuse(out.reason);
          game = out.state;
          entries.push(out.entry);
        }
        q.game = game;
      }
      break;
    }

    case 'quote': {
      if (phase !== 'asking') return refuse('wrong_phase');
      if (step.index !== state.current) return refuse('wrong_index');
      const q = questions[state.current];
      if (!q) return refuse('wrong_index');
      if (!q.game) return refuse('not_game');
      const quote = { bid: step.bid, ask: step.ask, size: step.size };
      const out = postQuote(q.game, quote, env.now);
      if (!out.ok) return refuse(out.reason);
      q.game = out.state;
      entries.push(out.entry);
      // The normalised quote (snapped to the tick), as the log has it.
      effects.quote = { index: state.current, text: formatQuote(out.state.quote ?? quote) };
      break;
    }

    case 'close': {
      if (phase !== 'asking') return refuse('wrong_phase');
      if (step.index !== state.current) return refuse('wrong_index');
      const q = questions[state.current];
      if (!q || q.posedAt === null) return refuse('wrong_index');
      if (step.verdict !== null && !QuantVerdict.safeParse(step.verdict).success) {
        return refuse('invalid');
      }
      // A clock a little ahead of the round's may ask for it (`QUANT_CLOCK_SKEW_MS`).
      const now = env.now.getTime() + QUANT_CLOCK_SKEW_MS;
      if (step.by === 'timeout' && now < Date.parse(q.posedAt) + (q.budgetSec ?? 0) * 1000) {
        return refuse('too_early');
      }
      if (step.by === 'round_time' && now < env.roundEndsAt.getTime()) return refuse('too_early');
      q.closedAt = nowIso;
      q.closedBy = step.by;
      q.verdict = step.verdict && { score: step.verdict.score, summary: step.verdict.summary };
      settle(q);
      if (step.by === 'round_time') {
        next.current = questions.length;
        effects.finished = true;
      } else {
        reveal(state.current + 1);
      }
      break;
    }

    case 'verdict': {
      const q = Number.isInteger(step.index) ? questions[step.index] : undefined;
      if (!q) return refuse('wrong_index');
      if (q.posedAt === null || q.closedAt === null) return refuse('not_closed');
      if (q.verdict !== null) return refuse('has_verdict');
      if (!QuantVerdict.safeParse(step.verdict).success) return refuse('invalid');
      q.verdict = { score: step.verdict.score, summary: step.verdict.summary };
      break;
    }
  }

  // Every game entry of a step is about the question that was current when it was taken.
  if (entries.length > 0) effects.game = { index: state.current, entries };
  if (step.type !== 'end' && step.type !== 'verdict' && step.type !== 'quote') {
    if (step.say !== null && step.say.trim() !== '') {
      effects.say = {
        text: step.say,
        kind: step.type === 'start' ? 'proactive' : step.kind,
        intent: sayIntent(step, effects.finished),
      };
    }
    if (step.note) effects.note = step.note;
  }
  return { ok: true, state: next, version: env.version + 1, effects };
}
