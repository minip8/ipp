/**
 * Hosts the interviewer: implements InterviewerDeps over the database, the live Y.Doc and the
 * pad rooms, and is the only place Triggers are sent from.
 */
import {
  type AiKeyProblem,
  type AiKeyState,
  type AiModelChoice,
  effectiveModel,
  type InterviewerModel,
  type InterviewerSettings,
  type Language,
  type Message,
  type ProblemContent,
  type ServerEvent,
} from '@ipp/contracts';
import { aiUsage, interviewerNotes, messages, pads, problems, runs } from '@ipp/db';
import { and, count, desc, eq, inArray, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { toInterviewerRun } from '../runs/redact';
import { messageView, padView, storedRun } from '../views';
import type {
  AiScope,
  InterviewContext,
  Interviewer,
  InterviewerDeps,
  ModelUsage,
  NewMessage,
  QuizQuestionShort,
  ResolvedKey,
  ShortAnswerGrade,
  Trigger,
} from './types';
import { defaultModel } from './wiring';

export type InterviewerFactory = (deps: InterviewerDeps) => Interviewer;

const TRANSCRIPT_LIMIT = 200;
const PRIVATE_NOTES_LIMIT = 50;

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

interface PadGate {
  active: boolean;
  enabled: boolean;
  at: number;
}

const OWNER_CACHE_MAX = 2000;

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
      .select({ id: pads.id, status: pads.status, interviewer: pads.interviewer })
      .from(pads)
      .where(and(eq(pads.ownerId, userId), inArray(pads.id, live)));
    for (const p of owned) {
      const { key: state, model } = await this.padModel(userId, p.interviewer);
      this.ctx.rooms.broadcast(p.id, { type: 'interviewer.status', key: state, model });
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
      .select({ interviewer: pads.interviewer, ownerId: pads.ownerId })
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
    this.ctx.rooms.broadcast(padId, { type: 'interviewer.status', key, model: now });
  }

  /** Call after a pad's status or interviewer settings change. */
  invalidate(padId: string): void {
    this.gates.delete(padId);
  }

  private async gate(padId: string): Promise<PadGate | null> {
    const cached = this.gates.get(padId);
    if (cached && Date.now() - cached.at < 10_000) return cached;
    const [row] = await this.ctx.db
      .select({ status: pads.status, interviewer: pads.interviewer })
      .from(pads)
      .where(eq(pads.id, padId));
    if (!row) return null;
    const g = { active: row.status === 'active', enabled: row.interviewer.enabled, at: Date.now() };
    this.gates.set(padId, g);
    return g;
  }

  /**
   * Fire and forget. Dropped when the interviewer is disabled for the pad or the pad ended. A
   * pad whose owner has no key still gets its triggers: the interviewer keeps track of the
   * session and stays silent until a key is there.
   */
  trigger(padId: string, trigger: Trigger): void {
    void this.gate(padId)
      .then((g) => {
        if (!g?.enabled) return;
        if (!g.active && trigger.type !== 'session_ended') return;
        this.interviewer.handle(padId, trigger);
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
    const [problem] = await db.select().from(problems).where(eq(problems.slug, pad.problemSlug));
    if (!problem) throw new Error(`problem ${pad.problemSlug} not found`);
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
    const content: Omit<ProblemContent, 'tests'> = {
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
      ...(problem.source ? { source: problem.source } : {}),
    };
    const language: Language = pad.language;
    return {
      pad: padView(pad, null),
      problem: content,
      language,
      code: texts.code[language],
      notes: texts.notes,
      transcript: transcript.reverse().map(messageView),
      recentRuns: recent.map((r) => toInterviewerRun(storedRun(r))),
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

  async checkBudget(padId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { db, config } = this.ctx;
    const [pad] = await db.select({ ownerId: pads.ownerId }).from(pads).where(eq(pads.id, padId));
    if (!pad) return { ok: false, reason: 'Pad not found.' };
    const over = await this.overDailyLimit(pad.ownerId);
    if (over) return { ok: false, reason: over };
    const [perPad] = await db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.padId, padId), eq(messages.role, 'interviewer')));
    if ((perPad?.n ?? 0) >= config.limits.interviewerMessagesPerPad) {
      return { ok: false, reason: 'The interviewer message limit for this pad has been reached.' };
    }
    return { ok: true };
  }
}
