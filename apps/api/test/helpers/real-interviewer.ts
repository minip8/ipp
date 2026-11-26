/**
 * The real @ipp/interviewer inside the API test harness, with only the model call replaced.
 *
 * - `RealInterviewerRig.factory` is handed to `startApi` as the interviewer factory. It builds
 *   the interviewer exactly as `wiring.ts` does (`createInterviewer(interviewerConfig(config),
 *   deps)`), plus the documented test seam `clientFor`: every model call goes to a
 *   `ScriptedModel` chosen by the API key it runs on, so each test account (its own key) has its
 *   own script and its own record of requests. `restart()` swaps in a fresh interviewer over the
 *   same deps (an API restart, as far as the interviewer is concerned).
 * - `TestClock` moves the whole process's clock: the host (`deps.now`) and the interviewer
 *   (which reads `deps.now`) read the global `Date`, so a process-wide offset is the one clock
 *   both honour. Timers are untouched (sockets, ticks and the harness keep real time). Postgres
 *   stamps some rows with its own `now()` (a message's `created_at`, a pad's `started_at`); a
 *   trigger in the test database adds the same offset to those, and the round service and the
 *   sweeper read the database's clock through `ctx.dbNow`, which the clock shifts too, so every
 *   timestamp in a round comes from one clock, as it does in production.
 */
import type { AiProvider } from '@ipp/contracts';
import { sql } from '@ipp/db/orm';
import {
  createInterviewer,
  type InterviewerRuntime,
  type ModelClient,
  ModelError,
  type ModelRequest,
  type ModelResponse,
  type TraceEvent,
} from '@ipp/interviewer';
import type { Config } from '../../src/config';
import type { Ctx } from '../../src/context';
import type { InterviewerFactory } from '../../src/interviewer/host';
import type { Interviewer, InterviewerDeps, Trigger } from '../../src/interviewer/types';
import { interviewerConfig } from '../../src/interviewer/wiring';

// ---------------------------------------------------------------- the clock

const RealDate = globalThis.Date;

/** A process-wide clock: real time plus an offset that only moves forward. */
export class TestClock {
  private offsetMs = 0;
  private installed = false;
  private readonly db: Ctx['db'];
  private realDbNow: Ctx['dbNow'] | null = null;
  constructor(private readonly ctx: Ctx) {
    this.db = ctx.db;
  }

  get offset() {
    return this.offsetMs;
  }

  async install(): Promise<void> {
    if (this.installed) return;
    const self = this;
    const Shifted = new Proxy(RealDate, {
      construct(target, args, newTarget) {
        return Reflect.construct(
          target,
          args.length === 0 ? [RealDate.now() + self.offsetMs] : args,
          newTarget,
        );
      },
      apply() {
        return new RealDate(RealDate.now() + self.offsetMs).toString();
      },
      get(target, prop, receiver) {
        if (prop === 'now') return () => RealDate.now() + self.offsetMs;
        return Reflect.get(target, prop, receiver);
      },
    });
    globalThis.Date = Shifted as DateConstructor;
    const realDbNow = this.ctx.dbNow;
    this.realDbNow = realDbNow;
    this.ctx.dbNow = async (q) => new RealDate((await realDbNow(q)).getTime() + self.offsetMs);
    this.installed = true;
    await this.db.execute(sql`drop table if exists ipp_test_clock cascade`);
    await this.db.execute(
      sql`create table ipp_test_clock (id int primary key, offset_ms bigint not null)`,
    );
    await this.db.execute(sql`insert into ipp_test_clock values (1, 0)`);
    for (const [table, column] of [
      ['messages', 'created_at'],
      ['pads', 'started_at'],
    ] as const) {
      const fn = sql.raw(`ipp_test_clock_${table}`);
      const col = sql.raw(column);
      await this.db.execute(sql`
        create or replace function ${fn}() returns trigger language plpgsql as $$
        declare off bigint;
        begin
          select offset_ms into off from ipp_test_clock where id = 1;
          -- Only a value Postgres defaulted (the transaction's now()); the API's own stamps stay.
          if off is not null and off <> 0 and new.${col} = now() then
            new.${col} := now() + off * interval '1 millisecond';
          end if;
          return new;
        end $$`);
      await this.db.execute(
        sql`create trigger ${fn} before insert on ${sql.raw(table)} for each row execute function ${fn}()`,
      );
    }
  }

  async uninstall(): Promise<void> {
    if (!this.installed) return;
    globalThis.Date = RealDate;
    if (this.realDbNow) this.ctx.dbNow = this.realDbNow;
    this.installed = false;
    this.offsetMs = 0;
    for (const table of ['messages', 'pads']) {
      await this.db.execute(sql.raw(`drop trigger if exists ipp_test_clock_${table} on ${table}`));
      await this.db.execute(sql.raw(`drop function if exists ipp_test_clock_${table}()`));
    }
    await this.db.execute(sql`drop table if exists ipp_test_clock cascade`);
  }

  /** Moves the clock forward by `ms`. */
  async advance(ms: number): Promise<void> {
    if (ms <= 0) return;
    this.offsetMs += ms;
    await this.db.execute(sql`update ipp_test_clock set offset_ms = ${this.offsetMs} where id = 1`);
  }

  /** Moves the clock forward to epoch ms `at` (no-op when already past it). */
  async advanceTo(at: number): Promise<void> {
    await this.advance(at - Date.now());
  }
}

/** Polls `pred` on real time (the test clock may jump while it waits). */
export async function eventually(
  pred: () => boolean | Promise<boolean>,
  ms = 10_000,
  what = 'condition',
): Promise<void> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`${what} not met in time`);
}

// ---------------------------------------------------------------- the model

/** What a request asks for, read from its task line (quant) or its purpose (coding). */
export type TaskKind =
  | 'opening'
  | 'reply'
  | 'nudge'
  | 'timeout'
  | 'round time'
  | 'stall'
  | 'after the round'
  | 'verdict'
  | 'assessment'
  | 'coding:greeting'
  | 'coding:decision'
  | 'coding:reply'
  | 'coding:assessment'
  | 'other';

export function taskOf(req: ModelRequest): TaskKind {
  const last = req.messages.at(-1);
  const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
  const m = /TASK \(([a-z ]+)\)/.exec(text);
  if (m?.[1]) return m[1] as TaskKind;
  if (JSON.stringify(req.messages).includes('TASK: the session has just started'))
    return 'coding:greeting';
  if (req.purpose === 'decision') return 'coding:decision';
  if (req.purpose === 'reply') return 'coding:reply';
  if (req.purpose === 'assessment') return 'coding:assessment';
  return 'other';
}

/** The whole request as text, for substring checks. */
export const requestText = (req: ModelRequest) =>
  JSON.stringify({ system: req.system, messages: req.messages });

export type Reply =
  | string
  | { refused: true; text?: string }
  | { error: 'transient' | 'permanent' }
  /**
   * Waits until `release` is called (with the reply), or the call is aborted. `partial` is
   * streamed first (and the rest of the released text, if it goes on from there).
   */
  | { hang: true; partial?: string };

export interface RecordedCall<S = unknown> {
  req: ModelRequest;
  task: TaskKind;
  /** The test clock when the call was made. */
  at: number;
  /** What the test's `snapshot` recorded when the call was made (e.g. the round's books). */
  snapshot: S;
  aborted: boolean;
  /** For a `hang`: answers the call. */
  release(reply: Exclude<Reply, { hang: true }>): void;
  done: boolean;
}

/** A quant turn as the model writes it (`QuantTurnSchema`). */
export function turn(o: {
  action: 'silent' | 'stay' | 'hint' | 'follow_up' | 'close';
  message?: string;
  hint_rung?: number;
  score?: number;
  summary?: string;
  note?: string;
}): string {
  return JSON.stringify({
    reason: `scripted ${o.action}`,
    action: o.action,
    hint_rung: o.hint_rung ?? 0,
    message: o.message ?? '',
    score: o.score ?? 0,
    summary: o.summary ?? '',
    note: o.note ?? '',
  });
}

export const assessmentJson = (tag = 'ASSESSED') =>
  JSON.stringify({
    recommendation: 'lean_hire',
    summary: `You worked steadily. ${tag}`,
    scores: {
      structuring: { score: 3, evidence: 'Set up the sample space first.' },
      correctness: { score: 3, evidence: 'Two of three right.' },
      communication: { score: 4, evidence: 'Thought aloud throughout.' },
      speed: { score: 2, evidence: 'Ran out of time on Q2.' },
      independence: { score: 3, evidence: 'One hint on Q1.' },
    },
    strengths: ['Clear setup'],
    improvements: ['Commit to a number sooner'],
  });

/** Defaults when a test has not scripted the call. */
function defaultReply(task: TaskKind): Reply {
  switch (task) {
    case 'opening':
      return turn({ action: 'stay', message: 'Welcome. A few questions, one at a time.' });
    case 'reply':
      return turn({ action: 'stay', message: 'Go on.' });
    case 'nudge':
      return turn({ action: 'stay', message: 'Time is about up on this one. Best answer?' });
    case 'timeout':
    case 'round time':
      return turn({ action: 'close', message: 'That is time.', score: 0.3, summary: 'Ran out.' });
    case 'stall':
      return turn({ action: 'silent' });
    case 'after the round':
      return turn({ action: 'stay', message: 'Thanks again.' });
    case 'verdict':
      return JSON.stringify({ score: 0.5, summary: 'Partway there.' });
    case 'assessment':
      return assessmentJson();
    case 'coding:greeting':
      return 'Hi! Take a look at the problem and tell me your first thoughts.';
    case 'coding:decision':
      return JSON.stringify({
        reason: 'scripted',
        speak: false,
        intent: 'nudge',
        message: '',
        note: '',
      });
    case 'coding:reply':
      return 'Sounds good, go ahead.';
    default:
      return { error: 'permanent' };
  }
}

/**
 * A scripted model client. `script(task, reply)` queues a reply for the next call of that task;
 * unscripted calls get a sensible default. Every request is recorded with the test's snapshot.
 */
export class ScriptedModel<S = unknown> implements ModelClient {
  readonly model = 'scripted-model';
  readonly calls: RecordedCall<S>[] = [];
  private queues = new Map<TaskKind, Reply[]>();
  /** Recorded with every call, before it is answered (e.g. the round's state from the database). */
  snapshot: () => Promise<S> | S = () => undefined as S;
  /** Called on every call once it is recorded (tests wait on it). */
  private listeners: ((c: RecordedCall<S>) => void)[] = [];

  script(task: TaskKind, ...replies: Reply[]): this {
    const q = this.queues.get(task) ?? [];
    q.push(...replies);
    this.queues.set(task, q);
    return this;
  }

  pending(task: TaskKind): number {
    return this.queues.get(task)?.length ?? 0;
  }

  of(...tasks: TaskKind[]) {
    return this.calls.filter((c) => tasks.includes(c.task));
  }

  /** Resolves with the next call of `task` (or the one already made after `from` calls). */
  next(task: TaskKind, from = this.calls.length, ms = 10_000): Promise<RecordedCall<S>> {
    const hit = this.calls.slice(from).find((c) => c.task === task);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${task} call in time`)), ms);
      const l = (c: RecordedCall<S>) => {
        if (c.task !== task) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((x) => x !== l);
        resolve(c);
      };
      this.listeners.push(l);
    });
  }

  async call(req: ModelRequest): Promise<ModelResponse> {
    const task = taskOf(req);
    const reply = this.queues.get(task)?.shift() ?? defaultReply(task);
    let release!: (r: Exclude<Reply, { hang: true }>) => void;
    const released = new Promise<Exclude<Reply, { hang: true }>>((r) => {
      release = r;
    });
    const rec: RecordedCall<S> = {
      req,
      task,
      at: Date.now(),
      snapshot: await this.snapshot(),
      aborted: false,
      release,
      done: false,
    };
    this.calls.push(rec);
    for (const l of [...this.listeners]) l(rec);
    const stream = (t: string) => {
      for (const chunk of t.match(/.{1,16}/gs) ?? []) req.onText?.(chunk);
    };
    let sent = '';
    try {
      let r: Exclude<Reply, { hang: true }>;
      if (typeof reply === 'object' && 'hang' in reply) {
        if (reply.partial) {
          stream(reply.partial);
          sent = reply.partial;
        }
        r = await new Promise<Exclude<Reply, { hang: true }>>((resolve, reject) => {
          const onAbort = () => {
            rec.aborted = true;
            reject(new ModelError('aborted', 'aborted'));
          };
          if (req.signal?.aborted) return onAbort();
          req.signal?.addEventListener('abort', onAbort, { once: true });
          released.then(resolve);
        });
      } else r = reply;
      if (typeof r === 'object' && 'error' in r)
        throw new ModelError(r.error, `scripted ${r.error} failure`, 500);
      const refused = typeof r === 'object' && 'refused' in r;
      const text = typeof r === 'string' ? r : (r.text ?? '');
      if (!refused) stream(!sent ? text : text.startsWith(sent) ? text.slice(sent.length) : '');
      return {
        text,
        stopReason: refused ? 'refusal' : 'end_turn',
        refused,
        model: this.model,
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        latencyMs: 1,
        ttftMs: 1,
        fallback: false,
      };
    } finally {
      rec.done = true;
    }
  }
}

// ---------------------------------------------------------------- the rig

/** Builds the real interviewer for the API under test, and can restart it. */
export class RealInterviewerRig {
  deps!: InterviewerDeps;
  /** The interviewer instance currently serving (a new one after `restart`). */
  iv!: InterviewerRuntime;
  generation = 0;
  /** Every trigger the host sent, with the interviewer generation that got it. */
  readonly triggers: { padId: string; trigger: Trigger; generation: number; at: number }[] = [];
  readonly traces: { padId: string; event: TraceEvent; generation: number }[] = [];
  private readonly models = new Map<string, ScriptedModel<never>>();
  private readonly pads = new Set<string>();

  constructor(private readonly config: Config) {}

  /** The model every call on `apiKey` goes to. */
  model<S>(apiKey: string): ScriptedModel<S> {
    let m = this.models.get(apiKey);
    if (!m) {
      m = new ScriptedModel<never>();
      this.models.set(apiKey, m);
    }
    return m as unknown as ScriptedModel<S>;
  }

  private make(): InterviewerRuntime {
    const generation = this.generation;
    // As wiring.ts builds it, with the model seam pointed at the scripted models.
    return createInterviewer(interviewerConfig(this.config), this.deps, {
      clientFor: (key: { provider: AiProvider; apiKey: string }) => this.model(key.apiKey),
      trace: (padId, event) => this.traces.push({ padId, event, generation }),
    });
  }

  factory: InterviewerFactory = (deps) => {
    this.deps = deps;
    this.iv = this.make();
    return this.facade;
  };

  /** A fresh interviewer over the same database; the old one lets go of every pad. */
  restart(): void {
    const old = this.iv;
    for (const p of this.pads) old.release(p);
    this.generation += 1;
    this.iv = this.make();
  }

  of(type: Trigger['type'], padId: string) {
    return this.triggers.filter((t) => t.padId === padId && t.trigger.type === type);
  }

  /** Resolves once the current interviewer has no work queued or running for the pad. */
  idle(padId: string): Promise<void> {
    return this.iv.idle(padId);
  }

  quantTraces(padId: string) {
    return this.traces.flatMap((t) =>
      t.padId === padId && t.event.type === 'quant'
        ? [{ ...t.event, generation: t.generation }]
        : [],
    );
  }

  private readonly facade: Interviewer = {
    handle: (padId, trigger) => {
      this.pads.add(padId);
      this.triggers.push({ padId, trigger, generation: this.generation, at: Date.now() });
      this.iv.handle(padId, trigger);
    },
    release: (padId) => this.iv.release(padId),
    generateAssessment: (padId) => this.iv.generateAssessment(padId),
    generateRoomAssessment: (padId) => this.iv.generateRoomAssessment(padId),
    generateQuantAssessment: (padId) => this.iv.generateQuantAssessment(padId),
    reviewSolution: (padId, question) => this.iv.reviewSolution(padId, question),
    gradeShortAnswer: (userId, question, answer) =>
      this.iv.gradeShortAnswer(userId, question, answer),
    discussShortAnswer: (userId, question, turns, final) =>
      this.iv.discussShortAnswer(userId, question, turns, final),
  };
}
