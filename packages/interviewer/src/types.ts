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
  QuantPath,
  QuantPhase,
  QuantStep,
  QuantStepResult,
  QuantVerdict,
  QuizDifficulty,
  QuizQuestion,
  Report,
  ReportAssessment,
  Run,
  ServerEvent,
  SolutionReview,
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

export interface InterviewContext {
  pad: Pad;
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
 * A quant pad as the interviewer sees it (`InterviewerDeps.loadQuantContext`). Unlike
 * `InterviewContext` there is no problem and no code: the round's questions, the scratchpad and
 * the transcript. Later questions are never in it, in any form, until they are posed.
 */
export interface QuantContext {
  pad: Pad;
  round: {
    /** `quant_rounds.version`: every `QuantStep` names the version it was decided on. */
    version: number;
    total: number;
    phase: QuantPhase;
    /** The current question's clock; null unless asking. */
    clock: QuantClock | null;
    /** Optional: the round's path (`QuantRoundState.path`), named in the opening. */
    path?: QuantPath;
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
   * follow-ups (server-only fields).
   */
  questions: {
    index: number;
    question: QuantQuestion;
    /** As in `QuantRoundQuestion.hintRungs`. */
    hintRungs: number[];
    followUpAsked: boolean;
  }[];
  /** scope `current`: the messages since the current question was posed; `all`: the last 200. */
  transcript: Message[];
  /** The scratchpad (`YDOC.notes`). */
  scratch: string;
  /** Notes the interviewer wrote to itself earlier in this session. */
  privateNotes: string[];
  now: Date;
}

export type { QuantClock, QuantStep, QuantStepResult };

export type ReviewResult =
  | { ok: true; review: SolutionReview }
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
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
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
