/**
 * Boundary between apps/api and packages/interviewer. The API owns I/O (database, sockets, the
 * live editor document); this package owns the decision of when to speak and what to say.
 * The interviewer never executes code: it sees the source text, run results and the transcript.
 */
import type {
  AiKeyProblem,
  AiModelChoice,
  AiProvider,
  DiscussionTurn,
  Language,
  Message,
  MessageIntent,
  Pad,
  ProblemContent,
  QuantClock,
  QuantClosedBy,
  QuantGameBooks,
  QuantGameMechanics,
  QuantGameState,
  QuantPath,
  QuantPhase,
  QuantQuestionType,
  QuantSecondOpinion,
  QuantStep,
  QuantStepResult,
  QuantSubject,
  QuantVerdict,
  QuizDifficulty,
  QuizQuestion,
  Report,
  ReportAssessment,
  Run,
  ServerEvent,
  SolutionReview,
  StageKind,
} from '@ipp/contracts';

/** Things the API tells the interviewer about. `handle` returns immediately; work is serialized per pad. */
export type Trigger =
  | { type: 'session_started' }
  | { type: 'candidate_message'; text: string; via: 'text' | 'voice'; userId: string }
  /** The editor document changed. Sent at most once per second; debouncing is the interviewer's job. */
  | { type: 'code_changed' }
  /**
   * A quant pad's scratchpad or whiteboard changed: what `code_changed` is for a coding pad
   * (typing activity), with no code to check. Same rate.
   */
  | { type: 'scratch_changed' }
  /** Full, unredacted run (the interviewer may reason about hidden-test outcomes but must not leak inputs). */
  | { type: 'run_finished'; run: Run; hiddenFailures: number }
  | { type: 'telemetry'; kind: 'paste' | 'blur'; chars?: number; ms?: number }
  | { type: 'language_changed'; language: Language }
  /** Sent every ~5 s for each active pad so idle and time-remaining checks need no timers here. */
  | { type: 'tick' }
  | { type: 'session_ended' };

/**
 * Where a pad sits in a staged interview (@ipp/contracts `interview.ts`): the interviewer opens
 * and closes a stage as one part of a longer interview, not as the whole of it.
 */
export interface StagePosition {
  /** 0-based, of `total`. */
  index: number;
  total: number;
  /** What the stage after this one is; null when this is the last. */
  next: StageKind | null;
}

export interface InterviewContext {
  pad: Pad;
  /** Optional: set when the pad is a stage of a staged interview of more than one stage. */
  stage?: StagePosition | null;
  /** Includes interviewerNotes and reference solutions (server-only fields). Tests are omitted. */
  problem: Omit<ProblemContent, 'tests'>;
  language: Language;
  /** Current editor contents for the active language. */
  code: string;
  notes: string;
  transcript: Message[];
  /** Most recent first, at most 10. */
  recentRuns: Run[];
  /** Notes the interviewer wrote to itself earlier in this session. */
  privateNotes: string[];
  now: Date;
}

/**
 * A room as the model sees it: a person (the host) interviews, the model only advises them.
 * Unlike `InterviewContext` there may be no problem (a blank room), and the chat is between people.
 */
export interface RoomContext {
  pad: Pad;
  /** Includes interviewerNotes and reference solutions; null in a blank room. */
  problem: Omit<ProblemContent, 'tests'> | null;
  /** Titles of the problems the host used before the current one, oldest first. */
  earlierProblems: string[];
  language: Language;
  /** Current editor contents for the active language. */
  code: string;
  /** The notes everyone in the room shares. */
  notes: string;
  /** The host's private notes. */
  hostNotes: string;
  /** `interviewer` messages are the host's, `candidate` messages the candidates'. */
  transcript: Message[];
  /** Most recent first, at most 10. */
  recentRuns: Run[];
  now: Date;
}

/** A question of a quant round with everything the interviewer may use to run it. */
export type QuantQuestion = Extract<QuizQuestion, { type: 'short' | 'numeric' }>;

/**
 * A market-making game's content (ARCHITECTURE §8.3, `QuantGame` in `quant_games`), as the
 * interviewer may use it. SERVER-ONLY: `counterparty`, `hints` and `explanation` are its private
 * material. `prompt` is what was posted; `mechanics` is the snapshot the round plays (the same as
 * the content's unless the content changed since). Built from the round's snapshot alone, with
 * empty notes, hints and explanation, when the game's row is gone.
 */
export interface QuantGameContent {
  id: string;
  topic: string;
  title: string;
  difficulty: QuizDifficulty;
  prompt: string;
  /** How to trade against the candidate: informed or not, when to ask for a tighter market, when to reveal. */
  counterparty: string;
  /** The hint ladder, gentlest first, cut to the rungs the round was built with (`hintsAvailable`). */
  hints: string[];
  /** For the report: fair value, a sensible width, how the market moves on each reveal. */
  explanation: string;
  mechanics: QuantGameMechanics;
}

/** What a question entry of `QuantContext.questions` shares, a bank question's or a game's. */
interface QuantEntryBase {
  index: number;
  /** As in `QuantRoundQuestion.hintRungs`. */
  hintRungs: number[];
  followUpAsked: boolean;
}

/** A bank question of the round. `kind` is absent in entries made before games existed. */
export interface QuantBankEntry extends QuantEntryBase {
  kind?: 'question';
  question: QuantQuestion;
}

/**
 * A slot that holds a market-making game. `books` is `gameBooks(state)`, the interviewer's private
 * view of the game as it is now: every hidden value, the public fair value, the true value, the
 * live quote with the edges against it, position and cash marked to both. `state` is the game's
 * state itself, as the round holds it at the context load: the interviewer plays its moves on it
 * with the engine's own transitions (`tradeQuote`, `revealNext`, `settleGame`), so the facts it
 * posts are the figures the server then records, and builds `gameReview(state)` from it for the
 * verdict and the assessment. Neither may ever be said or written where the candidate can see it.
 */
export interface QuantGameSlotEntry extends QuantEntryBase {
  kind: 'game';
  game: QuantGameContent;
  books: QuantGameBooks;
  state: QuantGameState;
}

/**
 * One posed question of `QuantContext.questions`: a bank question (`kind` absent or `question`,
 * with `question`) or a game (`kind: 'game'`, with `game` and `books`). Narrow on `kind` before
 * reading either: a game is not a short or numeric question and has no answer, reference or key
 * points. `entryHints`, `entryTopic`, … in `quant/entry.ts` read what both have.
 */
export type QuantContextEntry = QuantBankEntry | QuantGameSlotEntry;

/**
 * A quant pad as the interviewer sees it (`InterviewerDeps.loadQuantContext`). Unlike
 * `InterviewContext` there is no problem and no code: the round's questions, the scratchpad and
 * the transcript. Later questions are never in it, in any form, until they are posed.
 */
export interface QuantContext {
  pad: Pad;
  /** Optional: set when the pad is a stage of a staged interview of more than one stage. */
  stage?: StagePosition | null;
  round: {
    /**
     * Optional: what the round's questions are about (`roundSubject`); absent means `quant`. It
     * chooses the interviewer's frame: a trading firm's round or a software team's fundamentals.
     */
    subject?: QuantSubject;
    /** `quant_rounds.version`: every `QuantStep` names the version it was decided on. */
    version: number;
    total: number;
    phase: QuantPhase;
    /** The current question's clock; null unless asking. */
    clock: QuantClock | null;
    /** Optional: the round's path (`QuantRoundState.path`), named in the opening. */
    path?: QuantPath | null;
    /** The questions already closed, oldest first: a code-built summary, no prompts. */
    closed: {
      index: number;
      topic: string;
      difficulty: QuizDifficulty;
      hints: number;
      timeSec: number;
      verdict: QuantVerdict | null;
      /** Optional: the budget it was given (`QuantRoundQuestion.budgetSec`), for the assessment. */
      budgetSec?: number | null;
      /** Optional: how it was closed (`QuantRoundQuestion.closedBy`). */
      closedBy?: QuantClosedBy | null;
    }[];
  };
  /**
   * scope `current`: only the current question (empty unless asking), in full. scope `all` (the
   * assessment): every posed question. Includes the answer, key points, explanation, hints and
   * follow-ups (server-only fields); a game's entry its content and books (`QuantGameSlotEntry`).
   */
  questions: QuantContextEntry[];
  /** scope `current`: the messages since the current question was posed; `all`: the last 200. */
  transcript: Message[];
  /** The scratchpad (`YDOC.notes`). */
  scratch: string;
  /** Notes the interviewer wrote to itself earlier in this session. */
  privateNotes: string[];
  now: Date;
}

export type { QuantClock, QuantStep, QuantStepResult };

/**
 * A question a quant room's host posed (ARCHITECTURE §8.4), as the host's adviser sees it. Any
 * type of the bank. SERVER-ONLY material: the answer, key points, explanation, hints and
 * follow-ups are in `question`, which only the host and the model see.
 */
export interface QuantRoomQuestion {
  index: number;
  /** The bank question in full; null if it has left the bank since (the snapshot below remains). */
  question: QuizQuestion | null;
  /** Exactly what was posed (`hostedPrompt`: a choice question's options and an output question's program in it). */
  prompt: string;
  topic: string;
  topicTitle: string;
  difficulty: QuizDifficulty;
  type: QuantQuestionType;
  posedAt: string;
  /** The `question` message that posed it (it is in the transcript). */
  posedMessageId: string | null;
  closedAt: string | null;
  closedBy: QuantClosedBy | null;
  /** As in `QuantRoundQuestion.hintRungs`: the authored rung given, or 0 for one of the host's own. */
  hintRungs: number[];
  followUpAsked: boolean;
  /** The host's verdict, if they gave one. */
  verdict: QuantVerdict | null;
}

/**
 * A quant room as the host's adviser sees it (`InterviewerDeps.loadQuantRoomContext`): a person
 * (the host) interviews, the model only advises them. There is no round clock, no budgets, and no
 * queue in it (what the host plans to ask is not the model's business).
 */
export interface QuantRoomContext {
  pad: Pad;
  /** Every question the host posed, in the order posed. */
  questions: QuantRoomQuestion[];
  /** The open question's index; null when none is open. */
  open: number | null;
  /** `interviewer` messages are the host's (and the posed questions, intent `question`), `candidate` the candidates'. */
  transcript: Message[];
  /** The scratchpad (`YDOC.notes`); the whiteboard is a drawing the model cannot see. */
  scratch: string;
  /** The host's private notes. */
  hostNotes: string;
  now: Date;
}

export type ReviewResult =
  | { ok: true; review: SolutionReview }
  | { ok: false; reason: 'no_key' | 'budget' | 'failed'; message?: string };

/** `Interviewer.reviewQuantRoom`: the second opinion on one question of a quant room. */
export type QuantReviewResult =
  | { ok: true; review: QuantSecondOpinion }
  | { ok: false; reason: 'no_key' | 'budget' | 'failed'; message?: string };

export interface NewMessage {
  /** Supplied when the text was streamed with message.delta events under this id. */
  id?: string;
  kind: 'chat' | 'proactive';
  intent: MessageIntent;
  text: string;
}

/**
 * Whose API key (and daily allowance) a model call uses: a pad runs on its owner's key
 * (collaborators included), short-answer grading on the quiz taker's. There is no operator key.
 */
export type AiScope = { padId: string } | { userId: string };

/**
 * Result of looking up the key for a scope. `keyId` changes whenever the stored key changes, so
 * the interviewer can tell "the same key again" from "a new key" without comparing secrets.
 */
export type ResolvedKey =
  | { ok: true; keyId: string; provider: AiProvider; apiKey: string }
  | { ok: false; state: 'missing' | 'rejected' };

export interface InterviewerDeps {
  now(): Date;
  /**
   * The key for one model call (or one burst of calls). Called before every model call, so a
   * deleted or replaced key takes effect immediately; the host refreshes the key's expiry on use.
   * The interviewer keeps the plaintext only inside a small, bounded cache of SDK clients.
   */
  resolveKey(scope: AiScope): Promise<ResolvedKey>;
  /**
   * The provider refused the key while it was in use (revoked, out of credit, spend limit, no
   * access to the provider's default model). The host discards it; until a new key is saved
   * `resolveKey` returns `rejected`.
   */
  keyRejected(scope: AiScope, keyId: string, problem: AiKeyProblem): Promise<void>;
  /**
   * Optional: the model chosen for the pad is unknown to the provider or not available to the
   * key (the key itself is fine). The interviewer has switched the pad to the provider default;
   * the host can forget the choice so the UI shows what is used.
   */
  modelUnavailable?(padId: string, model: AiModelChoice): Promise<void>;
  loadContext(padId: string): Promise<InterviewContext>;
  /** Rooms only (optional so hosts without rooms need not provide it). */
  loadRoomContext?(padId: string): Promise<RoomContext>;
  /**
   * Quant pads (optional, like `loadRoomContext`). Null for a pad that is not a quant pad, which
   * is how the interviewer learns a pad's format. `scope` defaults to `current`.
   */
  loadQuantContext?(padId: string, scope?: 'current' | 'all'): Promise<QuantContext | null>;
  /**
   * Quant rooms (optional, like `loadRoomContext`). Null for a pad that is not a quant room. The
   * interviewer never runs a quant room's round: this is only for advising its host.
   */
  loadQuantRoomContext?(padId: string): Promise<QuantRoomContext | null>;
  /**
   * Applies one step to a quant pad's round (`advanceRound` from @ipp/contracts, behind a
   * compare-and-swap on the version) and posts what it says: the interviewer's `say`, then the
   * question it reveals. Refused steps change nothing and post nothing; the interviewer drops
   * their message. Messages posted here do not go through `saveMessage`.
   */
  applyQuantStep?(padId: string, step: QuantStep): Promise<QuantStepResult>;
  /** Persists an interviewer message and broadcasts message.created. */
  saveMessage(padId: string, message: NewMessage): Promise<Message>;
  appendPrivateNote(padId: string, note: string): Promise<void>;
  /** Broadcast to everyone connected to the pad (message.delta, interviewer.thinking). */
  emit(padId: string, event: ServerEvent): void;
  /** Per-user and per-pad spend guard. When not ok the interviewer stays silent and says why once. */
  checkBudget(padId: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Optional: token usage of every model call, for the per-user daily limits (`ai_usage`). */
  recordUsage?(scope: AiScope, usage: ModelUsage): void;
  log: {
    info(obj: object, msg?: string): void;
    warn(obj: object, msg?: string): void;
    error(obj: object, msg?: string): void;
  };
}

export interface ModelUsage {
  /** `turn`: a quant round's reply or proactive moment (one structured call each). */
  purpose: 'reply' | 'decision' | 'assessment' | 'grade' | 'review' | 'turn';
  model: string;
  /** Whose API served the call (what prices it); absent in fakes, which are then unpriced. */
  provider?: AiProvider;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /**
   * The call's cost in micro-dollars as the provider reported it (OpenRouter's `usage.cost`);
   * preferred over a price-table estimate (pricing.ts) when present.
   */
  reportedCostMicros?: number;
}

/** Keys are not configuration: they are resolved per call through `InterviewerDeps.resolveKey`. */
export interface InterviewerConfig {
  /** The Anthropic default model (INTERVIEWER_MODEL). */
  model: string;
  /** Default models of the other providers; missing ones use the built-in defaults. */
  models?: Partial<Record<AiProvider, string>>;
}

export interface ShortAnswerGrade {
  score: number;
  feedback: string;
}

/** One step of a discussion: the grade so far, and the follow-up to ask ("" closes the question). */
export interface DiscussionStep extends ShortAnswerGrade {
  followUp: string;
}

export interface Interviewer {
  handle(padId: string, trigger: Trigger): void;
  /** Drop in-memory state for a pad (after session_ended or when the last client leaves). */
  release(padId: string): void;
  /** Null without a usable key for the pad's owner, over budget, or when the model failed. */
  generateAssessment(padId: string): Promise<ReportAssessment | null>;
  /**
   * A room's assessment: an observer's view of the candidate, written for the host on the
   * host's key. Null under the same conditions as `generateAssessment`.
   */
  generateRoomAssessment(padId: string): Promise<ReportAssessment | null>;
  /**
   * A quant pad's assessment, over the quant dimensions (`QUANT_REPORT_DIMENSIONS`). First judges
   * every closed question that has no verdict (each written back with a `verdict` step). Null
   * under the same conditions as `generateAssessment`.
   */
  generateQuantAssessment(padId: string): Promise<ReportAssessment | null>;
  /** A room host's second opinion on the code as it is now. Never shown to the candidate. */
  reviewSolution(padId: string, question?: string): Promise<ReviewResult>;
  /**
   * A quant room host's second opinion on question `index` (posed): what the candidate has said
   * and written since it was posed, against its solution, the hints the host recorded included;
   * `question` is something the host wants checked. Never shown to the candidate.
   */
  reviewQuantRoom(
    padId: string,
    opts: { index: number; question?: string },
  ): Promise<QuantReviewResult>;
  /**
   * A quant room's assessment, written for its host when they ask, over the quant dimensions
   * (`QUANT_REPORT_DIMENSIONS`): the questions posed, the transcript, the scratchpad, the host's
   * notes and verdicts. It never gives or changes a verdict. Null as for `generateAssessment`.
   */
  generateQuantRoomAssessment(padId: string): Promise<ReportAssessment | null>;
  /**
   * Runs on `userId`'s key; null without a usable key or when the model failed. The question's
   * `hints` and `followUps` are read as `?? []`: a row stored before they existed has neither.
   */
  gradeShortAnswer(
    userId: string,
    question: Extract<QuizQuestion, { type: 'short' }>,
    answer: string,
  ): Promise<ShortAnswerGrade | null>;
  /**
   * Quiz discussion mode: judges what the candidate has said on one question so far and writes
   * the next follow-up. `final` asks for no follow-up. Null as for `gradeShortAnswer`. The
   * follow-ups prefer the question's authored hints (when the candidate is stuck) and its authored
   * follow-ups (once the key points are covered).
   */
  discussShortAnswer(
    userId: string,
    question: Extract<QuizQuestion, { type: 'short' }>,
    turns: DiscussionTurn[],
    final: boolean,
  ): Promise<DiscussionStep | null>;
}

export type CreateInterviewer = (config: InterviewerConfig, deps: InterviewerDeps) => Interviewer;

export type { Report };
