/**
 * Hosts the interviewer: implements InterviewerDeps over the database, the live Y.Doc and the
 * pad rooms, and is the only place Triggers are sent from.
 */
import {
  type AiKeyProblem,
  type AiKeyState,
  type AiModelChoice,
  type DiscussionTurn,
  effectiveModel,
  gameBooks,
  type InterviewerModel,
  type InterviewerSettings,
  type Language,
  type Message,
  type PadFormat,
  type ProblemContent,
  quantClock,
  quantPhase,
  quantRoundEndsAt,
  quantTimeSec,
  type ServerEvent,
} from '@ipp/contracts';
import { aiUsage, interviewerNotes, messages, pads, problems, runs, timelineEvents } from '@ipp/db';
import { and, asc, count, desc, eq, gte, inArray, sql } from '@ipp/db/orm';
import type { Limits } from '../config';
import type { Ctx } from '../context';
import { applyStep, bankQuestions, gameContent, loadRound } from '../quant/round';
import { toInterviewerRun } from '../runs/redact';
import { messageView, padView, storedRun } from '../views';
import type {
  AiScope,
  DiscussionStep,
  InterviewContext,
  Interviewer,
  InterviewerDeps,
  ModelUsage,
  NewMessage,
  QuantContext,
  QuantQuestion,
  QuizQuestionShort,
  ResolvedKey,
  RoomContext,
  ShortAnswerGrade,
  Trigger,
} from './types';
import { defaultModel } from './wiring';

export type InterviewerFactory = (deps: InterviewerDeps) => Interviewer;

const TRANSCRIPT_LIMIT = 200;
const PRIVATE_NOTES_LIMIT = 50;
/** The scratchpad a quant round's interviewer reads (a coding pad's notes are cut at 3,000). */
export const QUANT_SCRATCH_CHARS = 8_000;

/** Head and tail of a long text, as the interviewer's prompts cut it. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.75);
  return `${text.slice(0, head)}\n… [${text.length - max} characters omitted] …\n${text.slice(text.length - (max - head))}`;
}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

interface PadGate {
  active: boolean;
  enabled: boolean;
  format: PadFormat;
  at: number;
}

const OWNER_CACHE_MAX = 2000;

/** The problem with its server-only fields, as the model's private context. */
function problemContent(problem: typeof problems.$inferSelect): Omit<ProblemContent, 'tests'> {
  return {
    slug: problem.slug,
    title: problem.title,
    difficulty: problem.difficulty,
    category: problem.category,
    tags: problem.tags,
    statement: problem.statement,
    signature: problem.signature,
    limits: problem.limits,
    interviewerNotes: problem.interviewerNotes,
    referenceSolutions: problem.referenceSolutions,
    languages: problem.languages,
    starterCode: problem.starterCode,
    // What the tests exercise when the candidate's code is driven by a harness.
    harness: problem.harness,
    ...(problem.source ? { source: problem.source } : {}),
  };
}

export class InterviewerHost {
  readonly interviewer: Interviewer;
  private readonly gates = new Map<string, PadGate>();
  /** pad id -> owner id (immutable), so resolving a pad's key costs one Redis read. */
  private readonly owners = new Map<string, string>();

  constructor(
    private readonly ctx: Ctx,
    factory: InterviewerFactory,
  ) {
    this.interviewer = factory(this.deps());
  }

  /** The state of a user's own key (a pad runs on its owner's). */
  keyState(userId: string): Promise<AiKeyState> {
    return this.ctx.aiKeys.state(userId);
  }

  /**
   * A pad's key state and the model its interviewer runs on: the pad's choice while it is for
   * the owner's key provider, else that provider's default; null without a usable key.
   */
  async padModel(
    ownerId: string,
    settings: InterviewerSettings,
  ): Promise<{ key: AiKeyState; model: InterviewerModel | null }> {
    const s = await this.ctx.aiKeys.status(ownerId);
    if (s.state !== 'active' || !s.provider) return { key: s.state, model: null };
    return {
      key: s.state,
      model: effectiveModel(settings.model, s.provider, defaultModel(this.ctx.config, s.provider)),
    };
  }

  async ownerOf(padId: string): Promise<string | null> {
    const cached = this.owners.get(padId);
    if (cached) return cached;
    const [row] = await this.ctx.db
      .select({ ownerId: pads.ownerId })
      .from(pads)
      .where(eq(pads.id, padId));
    if (!row) return null;
    if (this.owners.size >= OWNER_CACHE_MAX) this.owners.clear();
    this.owners.set(padId, row.ownerId);
    return row.ownerId;
  }

  private async userOf(scope: AiScope): Promise<string | null> {
    return 'padId' in scope ? this.ownerOf(scope.padId) : scope.userId;
  }

  /** Whose key: a pad's owner (collaborators included), or the quiz taker. */
  async resolveKey(scope: AiScope): Promise<ResolvedKey> {
    const userId = await this.userOf(scope);
    if (!userId) return { ok: false, state: 'missing' };
    return this.ctx.aiKeys.resolve(userId);
  }

  async keyRejected(scope: AiScope, keyId: string, problem: AiKeyProblem): Promise<void> {
    const userId = await this.userOf(scope);
    if (!userId) return;
    if (await this.ctx.aiKeys.reject(userId, keyId, problem)) await this.keyChanged(userId);
  }

  /**
   * A user's key was saved, deleted or rejected: tell everyone in that user's open pads (so the
   * interviewer panel updates without a reload), and when a usable key arrived, let the
   * interviewer greet in pads where it has not spoken yet.
   */
  async keyChanged(userId: string): Promise<void> {
    const live = this.ctx.rooms.pads();
    if (live.length === 0) return;
    const owned = await this.ctx.db
      .select({
        id: pads.id,
        status: pads.status,
        kind: pads.kind,
        interviewer: pads.interviewer,
      })
      .from(pads)
      .where(and(eq(pads.ownerId, userId), inArray(pads.id, live)));
    for (const p of owned) {
      const { key: state, model } = await this.padModel(userId, p.interviewer);
      // In a room the AI is the host's private adviser: candidates hear nothing about the key.
      this.ctx.rooms.broadcast(
        p.id,
        { type: 'interviewer.status', key: state, model },
        p.kind === 'room' ? userId : undefined,
      );
      if (state === 'active' && p.status === 'active' && p.interviewer.enabled)
        this.interviewer.handle(p.id, { type: 'session_started' });
    }
  }

  /**
   * The provider would not serve the model chosen for this pad (the key is fine): forget the
   * choice so the pad, and everyone looking at it, shows the default that is used now.
   */
  async modelUnavailable(padId: string, model: AiModelChoice): Promise<void> {
    const [row] = await this.ctx.db
      .select({ interviewer: pads.interviewer, ownerId: pads.ownerId, kind: pads.kind })
      .from(pads)
      .where(eq(pads.id, padId));
    const chosen = row?.interviewer.model;
    if (!row || chosen?.provider !== model.provider || chosen.id !== model.id) return;
    const [updated] = await this.ctx.db
      .update(pads)
      .set({ interviewer: { ...row.interviewer, model: null } })
      .where(eq(pads.id, padId))
      .returning();
    this.invalidate(padId);
    if (!updated) return;
    this.ctx.rooms.broadcast(padId, { type: 'pad.updated', pad: padView(updated, null) });
    const { key, model: now } = await this.padModel(row.ownerId, updated.interviewer);
    this.ctx.rooms.broadcast(
      padId,
      { type: 'interviewer.status', key, model: now },
      row.kind === 'room' ? row.ownerId : undefined,
    );
  }

  /** Call after a pad's status or interviewer settings change. */
  invalidate(padId: string): void {
    this.gates.delete(padId);
  }

  private async gate(padId: string): Promise<PadGate | null> {
    const cached = this.gates.get(padId);
    if (cached && Date.now() - cached.at < 10_000) return cached;
    const [row] = await this.ctx.db
      .select({ status: pads.status, interviewer: pads.interviewer, format: pads.format })
      .from(pads)
      .where(eq(pads.id, padId));
    if (!row) return null;
    const g = {
      active: row.status === 'active',
      enabled: row.interviewer.enabled,
      format: row.format,
      at: Date.now(),
    };
    this.gates.set(padId, g);
    return g;
  }

  /**
   * Fire and forget. Dropped when the interviewer is disabled for the pad or the pad ended. A
   * pad whose owner has no key still gets its triggers: the interviewer keeps track of the
   * session and stays silent until a key is there.
   *
   * A quant pad has no code and no runs: its document changes arrive as `scratch_changed`, and
   * run results, telemetry and language changes are not its business.
   */
  trigger(padId: string, trigger: Trigger): void {
    void this.gate(padId)
      .then((g) => {
        if (!g?.enabled) return;
        if (!g.active && trigger.type !== 'session_ended') return;
        const t = g.format === 'quant' ? quantTrigger(trigger) : trigger;
        if (t) this.interviewer.handle(padId, t);
      })
      .catch((err) =>
        this.ctx.log.error({ err, padId, trigger: trigger.type }, 'interviewer trigger failed'),
      );
  }

  /** The pad was deleted: drop everything held for it. */
  forget(padId: string): void {
    this.gates.delete(padId);
    this.owners.delete(padId);
    this.release(padId);
  }

  release(padId: string): void {
    try {
      this.interviewer.release(padId);
    } catch (err) {
      this.ctx.log.warn({ err, padId }, 'interviewer release failed');
    }
  }

  private deps(): InterviewerDeps {
    const ctx = this.ctx;
    const log = ctx.log.child({ component: 'interviewer' });
    return {
      now: () => new Date(),
      resolveKey: (scope) => this.resolveKey(scope),
      keyRejected: (scope, keyId, problem) => this.keyRejected(scope, keyId, problem),
      modelUnavailable: (padId, model) => this.modelUnavailable(padId, model),
      loadContext: (padId) => this.loadContext(padId),
      loadRoomContext: (padId) => this.loadRoomContext(padId),
      loadQuantContext: (padId, scope) => this.loadQuantContext(padId, scope),
      applyQuantStep: (padId, step) => applyStep(ctx, padId, step),
      saveMessage: (padId, message) => this.saveMessage(padId, message),
      appendPrivateNote: async (padId, note) => {
        await ctx.db.insert(interviewerNotes).values({ padId, note: note.slice(0, 4000) });
      },
      emit: (padId: string, event: ServerEvent) => ctx.rooms.broadcast(padId, event),
      checkBudget: (padId) => this.checkBudget(padId),
      recordUsage: (scope, usage) => {
        void this.recordUsage(scope, usage).catch((err) =>
          log.warn({ err: String(err) }, 'recording AI usage failed'),
        );
      },
      log: {
        info: (obj, msg) => log.info(obj, msg),
        warn: (obj, msg) => log.warn(obj, msg),
        error: (obj, msg) => log.error(obj, msg),
      },
    };
  }

  async loadContext(padId: string): Promise<InterviewContext> {
    const { db } = this.ctx;
    const [pad] = await db.select().from(pads).where(eq(pads.id, padId));
    if (!pad) throw new Error(`pad ${padId} not found`);
    const [problem] = pad.problemSlug
      ? await db.select().from(problems).where(eq(problems.slug, pad.problemSlug))
      : [];
    if (!problem) throw new Error(`pad ${padId} has no problem (${pad.problemSlug})`);
    const [texts, transcript, recent, notes] = await Promise.all([
      this.ctx.collab.readTexts(padId),
      db
        .select()
        .from(messages)
        .where(eq(messages.padId, padId))
        .orderBy(desc(messages.createdAt))
        .limit(TRANSCRIPT_LIMIT),
      db.select().from(runs).where(eq(runs.padId, padId)).orderBy(desc(runs.createdAt)).limit(10),
      db
        .select({ note: interviewerNotes.note })
        .from(interviewerNotes)
        .where(eq(interviewerNotes.padId, padId))
        .orderBy(desc(interviewerNotes.at))
        .limit(PRIVATE_NOTES_LIMIT),
    ]);
    const language: Language = pad.language;
    return {
      pad: padView(pad, null),
      problem: problemContent(problem),
      language,
      code: texts.code[language],
      notes: texts.notes,
      transcript: transcript.reverse().map(messageView),
      recentRuns: recent.map((r) => toInterviewerRun(storedRun(r))),
      privateNotes: notes.map((n) => n.note).reverse(),
      now: new Date(),
    };
  }

  /** A room as its host's adviser sees it: host notes included, the problem possibly absent. */
  async loadRoomContext(padId: string): Promise<RoomContext> {
    const { db } = this.ctx;
    const [pad] = await db.select().from(pads).where(eq(pads.id, padId));
    if (!pad) throw new Error(`pad ${padId} not found`);
    const [problem] = pad.problemSlug
      ? await db.select().from(problems).where(eq(problems.slug, pad.problemSlug))
      : [];
    const [texts, transcript, recent, changes] = await Promise.all([
      this.ctx.collab.readTexts(padId),
      db
        .select()
        .from(messages)
        .where(eq(messages.padId, padId))
        .orderBy(desc(messages.createdAt))
        .limit(TRANSCRIPT_LIMIT),
      db.select().from(runs).where(eq(runs.padId, padId)).orderBy(desc(runs.createdAt)).limit(10),
      db
        .select({ event: timelineEvents.event })
        .from(timelineEvents)
        .where(
          and(eq(timelineEvents.padId, padId), sql`${timelineEvents.event}->>'type' = 'problem'`),
        )
        .orderBy(asc(timelineEvents.at)),
    ]);
    // Each change records the problem moved to; the one before the first is not recorded, so
    // "earlier" is every title moved to except the current one.
    const current = problem?.title ?? 'Blank';
    const earlier = changes
      .map((c) => (c.event.type === 'problem' ? c.event.title : ''))
      .filter((title) => title && title !== current);
    return {
      pad: padView(pad, null),
      problem: problem ? problemContent(problem) : null,
      earlierProblems: [...new Set(earlier)],
      language: pad.language,
      code: texts.code[pad.language],
      notes: texts.notes,
      hostNotes: pad.hostNotes,
      transcript: transcript.reverse().map(messageView),
      recentRuns: recent.map((r) => toInterviewerRun(storedRun(r))),
      now: new Date(),
    };
  }

  /**
   * A quant pad as its interviewer sees it; null for any other pad. Only the current question is
   * in it in full (`all`, for the assessment: every posed one), and nothing at all about the
   * questions still to come: they are not in the transcript either, as they have not been posed.
   * A game's slot (§8.3) is a `kind: 'game'` entry: its content from `quant_games` (counterparty
   * notes, hints, explanation) and `gameBooks` of its state, the hidden values included.
   */
  async loadQuantContext(
    padId: string,
    scope: 'current' | 'all' = 'current',
  ): Promise<QuantContext | null> {
    const { db } = this.ctx;
    const [pad] = await db.select().from(pads).where(eq(pads.id, padId));
    if (pad?.format !== 'quant') return null;
    const row = await loadRound(this.ctx, padId);
    if (!row) throw new Error(`quant pad ${padId} has no round`);
    const { state } = row;
    const phase = quantPhase(state);
    const posed = state.questions
      .map((q, index) => ({ q, index }))
      .filter(({ q }) => q.posedAt !== null);
    const shown =
      scope === 'all'
        ? posed
        : posed.filter(({ index }) => phase === 'asking' && index === state.current);
    const isGame = (q: (typeof shown)[number]['q']) => (q.game ?? null) !== null;
    const [bank, gameRows] = await Promise.all([
      bankQuestions(
        this.ctx,
        shown.filter(({ q }) => !isGame(q)).map(({ q }) => q.questionId),
      ),
      gameContent(
        this.ctx,
        shown.filter(({ q }) => isGame(q)).map(({ q }) => q.questionId),
      ),
    ]);
    const questions: QuantContext['questions'] = [];
    for (const { q, index } of shown) {
      if (q.game) {
        // A market-making game (§8.3): its content (private material) and its books.
        const g = gameRows.get(q.questionId);
        if (!g)
          this.ctx.log.warn({ padId, questionId: q.questionId }, 'quant game missing its content');
        questions.push({
          kind: 'game',
          index,
          game: {
            id: q.questionId,
            topic: q.topic,
            title: q.game.title,
            difficulty: q.difficulty,
            // What was posted and what the round plays, should the content have changed since.
            prompt: q.prompt,
            counterparty: g?.counterparty ?? '',
            hints: (g?.hints ?? []).slice(0, q.hintsAvailable),
            explanation: g?.explanation ?? '',
            mechanics: q.game.spec,
          },
          books: gameBooks(q.game),
          hintRungs: [...q.hintRungs],
          followUpAsked: q.followUpAsked,
        });
        continue;
      }
      const b = bank.get(q.questionId);
      if (b?.type !== 'short' && b?.type !== 'numeric') {
        this.ctx.log.warn(
          { padId, questionId: q.questionId },
          'quant question missing from the bank',
        );
        continue;
      }
      const question: QuantQuestion = {
        ...b,
        // What was posed, should the bank have changed since. The round's books allow only the
        // authored hints it was built with (`hintsAvailable`): a ladder grown since would have
        // the interviewer ask for a rung the round refuses, leaving the candidate unanswered.
        prompt: q.prompt,
        hints: (b.hints ?? []).slice(0, q.hintsAvailable),
        followUps: b.followUps ?? [],
      };
      questions.push({
        kind: 'question',
        index,
        question,
        hintRungs: [...q.hintRungs],
        followUpAsked: q.followUpAsked,
      });
    }

    // 'current': the conversation since the latest question was posed (all of it before one is).
    const last = posed.at(-1)?.q.posedMessageId ?? null;
    const [from] =
      scope === 'current' && last
        ? await db
            .select({ at: messages.createdAt })
            .from(messages)
            .where(and(eq(messages.padId, padId), eq(messages.id, last)))
        : [];
    const [texts, transcript, notes] = await Promise.all([
      this.ctx.collab.readTexts(padId),
      db
        .select()
        .from(messages)
        .where(and(eq(messages.padId, padId), from ? gte(messages.createdAt, from.at) : undefined))
        .orderBy(desc(messages.createdAt))
        .limit(TRANSCRIPT_LIMIT),
      db
        .select({ note: interviewerNotes.note })
        .from(interviewerNotes)
        .where(eq(interviewerNotes.padId, padId))
        .orderBy(desc(interviewerNotes.at))
        .limit(PRIVATE_NOTES_LIMIT),
    ]);
    const roundEndsAt = quantRoundEndsAt(pad.startedAt, state.durationMin);
    return {
      pad: padView(pad, null),
      round: {
        version: row.version,
        total: state.questions.length,
        phase,
        clock: quantClock(state, roundEndsAt),
        path: state.path,
        closed: state.questions.flatMap((q, index) =>
          q.closedAt === null
            ? []
            : [
                {
                  index,
                  topic: q.topic,
                  difficulty: q.difficulty,
                  hints: q.hintRungs.length,
                  timeSec: quantTimeSec(q) ?? 0,
                  verdict: q.verdict,
                  budgetSec: q.budgetSec,
                  closedBy: q.closedBy,
                },
              ],
        ),
      },
      questions,
      transcript: transcript.reverse().map(messageView),
      scratch: cut(texts.notes, QUANT_SCRATCH_CHARS),
      privateNotes: notes.map((n) => n.note).reverse(),
      now: new Date(),
    };
  }

  async saveMessage(padId: string, m: NewMessage): Promise<Message> {
    const { db } = this.ctx;
    const [row] = await db
      .insert(messages)
      .values({
        ...(m.id ? { id: m.id } : {}),
        padId,
        role: 'interviewer',
        kind: m.kind,
        intent: m.intent,
        text: m.text,
        via: 'text',
        userId: null,
      })
      .returning();
    if (!row) throw new Error('message insert failed');
    const [pad] = await db.select({ ownerId: pads.ownerId }).from(pads).where(eq(pads.id, padId));
    if (pad) {
      await db
        .insert(aiUsage)
        .values({ userId: pad.ownerId, day: utcDay(), messages: 1 })
        .onConflictDoUpdate({
          target: [aiUsage.userId, aiUsage.day],
          set: { messages: sql`${aiUsage.messages} + 1` },
        });
    }
    const message = messageView(row);
    this.ctx.rooms.broadcast(padId, { type: 'message.created', message });
    return message;
  }

  /** Token counts per user per day. Pad calls are charged to the pad owner, grading to the quiz taker. */
  async recordUsage(scope: AiScope, usage: ModelUsage): Promise<void> {
    const userId = await this.userOf(scope);
    if (!userId) return;
    const input = usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
    await this.ctx.db
      .insert(aiUsage)
      .values({ userId, day: utcDay(), inputTokens: input, outputTokens: usage.outputTokens })
      .onConflictDoUpdate({
        target: [aiUsage.userId, aiUsage.day],
        set: {
          inputTokens: sql`${aiUsage.inputTokens} + ${input}`,
          outputTokens: sql`${aiUsage.outputTokens} + ${usage.outputTokens}`,
        },
      });
  }

  private async usageToday(
    userId: string,
  ): Promise<{ messages: number; inputTokens: number; outputTokens: number }> {
    const [usage] = await this.ctx.db
      .select({
        messages: aiUsage.messages,
        inputTokens: aiUsage.inputTokens,
        outputTokens: aiUsage.outputTokens,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, utcDay())));
    return usage ?? { messages: 0, inputTokens: 0, outputTokens: 0 };
  }

  /**
   * The user's daily allowance: messages, and tokens (silent decisions and assessments are
   * model calls that produce no message). Null when there is allowance left.
   */
  private async overDailyLimit(userId: string): Promise<string | null> {
    const { config } = this.ctx;
    const u = await this.usageToday(userId);
    if (u.messages >= config.aiDailyMessageLimit)
      return 'The daily interviewer message limit for this account has been reached.';
    const inCap = config.aiDailyInputTokenLimit;
    const outCap = config.aiDailyOutputTokenLimit;
    if ((inCap > 0 && u.inputTokens >= inCap) || (outCap > 0 && u.outputTokens >= outCap))
      return 'The daily interviewer usage limit for this account has been reached.';
    return null;
  }

  /**
   * Short-answer grading runs on the quiz taker's own key. It has no pad, so the interviewer
   * cannot budget it: the API checks the user's daily allowance first and counts each grading
   * call as one message. Null means "fall back to self-grading" (no usable key, over the daily
   * limit, or the model failed).
   */
  async gradeShortAnswer(
    userId: string,
    question: QuizQuestionShort,
    answer: string,
  ): Promise<ShortAnswerGrade | null> {
    if ((await this.keyState(userId)) !== 'active') return null;
    if (await this.overDailyLimit(userId)) return null;
    const grade = await this.interviewer.gradeShortAnswer(userId, question, answer);
    await this.ctx.db
      .insert(aiUsage)
      .values({ userId, day: utcDay(), messages: 1 })
      .onConflictDoUpdate({
        target: [aiUsage.userId, aiUsage.day],
        set: { messages: sql`${aiUsage.messages} + 1` },
      });
    return grade;
  }

  /** One step of a quiz discussion, on the quiz taker's own key and counted like a grading call. */
  async discussShortAnswer(
    userId: string,
    question: QuizQuestionShort,
    turns: DiscussionTurn[],
    final: boolean,
  ): Promise<DiscussionStep | null> {
    if ((await this.keyState(userId)) !== 'active') return null;
    if (await this.overDailyLimit(userId)) return null;
    const step = await this.interviewer.discussShortAnswer(userId, question, turns, final);
    await this.ctx.db
      .insert(aiUsage)
      .values({ userId, day: utcDay(), messages: 1 })
      .onConflictDoUpdate({
        target: [aiUsage.userId, aiUsage.day],
        set: { messages: sql`${aiUsage.messages} + 1` },
      });
    return step;
  }

  async checkBudget(padId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { db, config } = this.ctx;
    const [pad] = await db
      .select({ ownerId: pads.ownerId, format: pads.format, durationMin: pads.durationMin })
      .from(pads)
      .where(eq(pads.id, padId));
    if (!pad) return { ok: false, reason: 'Pad not found.' };
    const over = await this.overDailyLimit(pad.ownerId);
    if (over) return { ok: false, reason: over };
    // A quant round's questions are posted by the server, not the model: they do not count.
    const [perPad] = await db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.padId, padId),
          eq(messages.role, 'interviewer'),
          sql`${messages.intent} is distinct from 'question'`,
        ),
      );
    if ((perPad?.n ?? 0) >= interviewerMessageCap(pad, config.limits)) {
      return { ok: false, reason: 'The interviewer message limit for this pad has been reached.' };
    }
    return { ok: true };
  }
}

/**
 * The most interviewer messages (questions aside) a pad may hold before its interviewer stops
 * answering: `interviewerMessagesPerPad`, or for a quant round
 * `quantInterviewerMessagesPerMinute` per minute of the round when that is more. A spoken round
 * answers far more often than a typed one (every few pieces of speech get a reply), and its
 * length is fixed, so its cap follows its length: 200, 240 and 360 for 20, 30 and 45 minutes by
 * default. What the cap stops is the model; the round's clock still closes questions (canned).
 */
export function interviewerMessageCap(
  pad: { format: PadFormat; durationMin: number | null },
  limits: Pick<Limits, 'interviewerMessagesPerPad' | 'quantInterviewerMessagesPerMinute'>,
): number {
  const base = limits.interviewerMessagesPerPad;
  if (pad.format !== 'quant' || !pad.durationMin) return base;
  return Math.max(base, Math.ceil(pad.durationMin * limits.quantInterviewerMessagesPerMinute));
}

/** What a trigger means on a quant pad: null when it is not its business. */
export function quantTrigger(trigger: Trigger): Trigger | null {
  switch (trigger.type) {
    case 'code_changed':
      return { type: 'scratch_changed' };
    case 'run_finished':
    case 'telemetry':
    case 'language_changed':
      return null;
    default:
      return trigger;
  }
}
