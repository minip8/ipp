/**
 * Boundary between apps/api and packages/interviewer. The API owns I/O (database, sockets, the
 * live editor document); this package owns the decision of when to speak and what to say.
 * The interviewer never executes code: it sees the source text, run results and the transcript.
 */
import type {
  AiKeyProblem,
  AiModelChoice,
  AiProvider,
  Language,
  Message,
  MessageIntent,
  Pad,
  ProblemContent,
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
  purpose: 'reply' | 'decision' | 'assessment' | 'grade' | 'review';
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
  /** A room host's second opinion on the code as it is now. Never shown to the candidate. */
  reviewSolution(padId: string, question?: string): Promise<ReviewResult>;
  /** Runs on `userId`'s key; null without a usable key or when the model failed. */
  gradeShortAnswer(
    userId: string,
    question: Extract<QuizQuestion, { type: 'short' }>,
    answer: string,
  ): Promise<ShortAnswerGrade | null>;
}

export type CreateInterviewer = (config: InterviewerConfig, deps: InterviewerDeps) => Interviewer;

export type { Report };
