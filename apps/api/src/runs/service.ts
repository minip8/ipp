/**
 * Run pipeline, API side:
 *   POST /pads/:id/runs -> validate + caps -> rate limits -> in-flight guard -> queue depth ->
 *   insert run (queued) -> XADD judge:jobs
 *   XREADGROUP judge:results -> finish (idempotent on runId) -> timeline -> WS run.finished
 *   (redacted) -> interviewer run_finished (unredacted)
 *   SUBSCRIBE judge:progress -> WS run.progress (filtered)
 *   watchdog: no result within totalMs + grace -> internal_error
 */
import { randomUUID } from 'node:crypto';
import {
  CAPS,
  type CreateRunRequest,
  JUDGE_KEYS,
  JudgeJob,
  JudgeProgress,
  JudgeResult,
  type JudgeTest,
  limitsForFile,
  limitsForTests,
  type Run,
  type RunMode,
} from '@ipp/contracts';
import { problems, problemTests, runs, timelineEvents } from '@ipp/db';
import { and, asc, eq, lt, ne } from '@ipp/db/orm';
import { Redis } from 'ioredis';
import type { Ctx } from '../context';
import { badRequest, notFound, rateLimited, tooLarge, unavailable } from '../http/errors';
import { isForeignKeyViolation } from '../pg';
import { storedRun } from '../views';
import { hiddenFailures, publicProgress, toInterviewerRun, toPublicRun } from './redact';

type StreamEntry = [id: string, fields: string[]];
type StreamReply = [key: string, entries: StreamEntry[]][] | null;

const MAX_CALLS_PER_CUSTOM_TEST = 100;
/** What the API will parse from Redis (the judge caps frames and `actual` at 4 MiB per run). */
export const MAX_RESULT_BYTES = 16 * 1024 * 1024;
export const MAX_PROGRESS_BYTES = 64 * 1024;
const JOBS_MAXLEN = 10_000;

export class RunService {
  private blocking: Redis | null = null;
  private subscriber: Redis | null = null;
  private stopped = false;
  private loopDone: Promise<void> = Promise.resolve();
  private watchdogTimer: NodeJS.Timeout | null = null;
  /** runId -> what progress forwarding needs; dropped when the run finishes. */
  private readonly live = new Map<string, { padId: string; mode: RunMode; running: boolean }>();

  constructor(private readonly ctx: Ctx) {}

  private inflightKey(userId: string) {
    return `${this.ctx.config.redisPrefix}inflight:${userId}`;
  }

  // ------------------------------------------------------------------ create

  async create(args: {
    userId: string;
    ip: string;
    padId: string;
    problemSlug: string;
    body: CreateRunRequest;
  }): Promise<Run> {
    const { ctx } = this;
    const { body, userId, padId } = args;
    if (Buffer.byteLength(body.source, 'utf8') > CAPS.sourceBytes) {
      throw tooLarge(`Source exceeds ${CAPS.sourceBytes} bytes`);
    }
    if (Buffer.byteLength(body.stdin, 'utf8') > CAPS.stdinBytes)
      throw tooLarge(`stdin exceeds ${CAPS.stdinBytes} bytes`);
    if (body.customTests.length > CAPS.customTests)
      throw badRequest(`At most ${CAPS.customTests} custom tests`);

    const [problem] = await ctx.db
      .select()
      .from(problems)
      .where(eq(problems.slug, args.problemSlug));
    if (!problem) throw badRequest('Problem not found');

    // Choose tests and limits. The API decides; the client only picks the mode.
    let tests: JudgeTest[] = [];
    let hiddenIds: string[] = [];
    if (body.mode === 'samples' || body.mode === 'submit') {
      const rows = await ctx.db
        .select()
        .from(problemTests)
        .where(eq(problemTests.problemSlug, problem.slug))
        .orderBy(asc(problemTests.idx));
      const chosen = body.mode === 'samples' ? rows.filter((r) => !r.hidden) : rows;
      tests = chosen.map((r) => ({
        id: r.data.id,
        ctorArgs: r.data.ctorArgs,
        calls: r.data.calls,
        expected: r.data.expected,
      }));
      hiddenIds = chosen.filter((r) => r.hidden).map((r) => r.data.id);
    } else if (body.mode === 'custom') {
      if (body.customTests.length === 0) throw badRequest('Custom runs need at least one test');
      const sig = problem.signature;
      const methods = new Map(sig.methods.map((m) => [m.name, m.params.length]));
      tests = body.customTests.map((t, i) => {
        const where = `customTests.${i}`;
        if (t.ctorArgs.length !== sig.ctorParams.length) {
          throw badRequest(
            `${where}: constructor takes ${sig.ctorParams.length} arguments`,
            'invalid_custom_test',
          );
        }
        if (t.calls.length > MAX_CALLS_PER_CUSTOM_TEST)
          throw badRequest(`${where}: too many calls`, 'invalid_custom_test');
        if (sig.kind === 'function' && t.calls.length !== 1) {
          throw badRequest(
            `${where}: function problems take exactly one call per test`,
            'invalid_custom_test',
          );
        }
        for (const call of t.calls) {
          const arity = methods.get(call.method);
          if (arity === undefined)
            throw badRequest(`${where}: unknown method "${call.method}"`, 'invalid_custom_test');
          if (call.args.length !== arity) {
            throw badRequest(
              `${where}: ${call.method} takes ${arity} arguments`,
              'invalid_custom_test',
            );
          }
        }
        return { id: `custom-${i + 1}`, ctorArgs: t.ctorArgs, calls: t.calls, expected: null };
      });
    }
    const limits =
      body.mode === 'file'
        ? limitsForFile(body.language)
        : limitsForTests(body.language, problem.limits);

    // Abuse controls.
    const inflightKey = this.inflightKey(userId);
    if (await ctx.redis.exists(inflightKey)) {
      throw rateLimited(2, 'run_in_flight', 'Wait for your current run to finish');
    }
    const l = ctx.config.limits.runs;
    const wait = await ctx.limiter.hit([
      { key: `runs:u:${userId}:burst`, ...l.userBurst },
      { key: `runs:u:${userId}:day`, ...l.userDaily },
      { key: `runs:ip:${args.ip}:burst`, ...l.ipBurst },
      { key: `runs:ip:${args.ip}:day`, ...l.ipDaily },
    ]);
    if (wait > 0) throw rateLimited(wait);
    if ((await this.queueDepth()) >= ctx.config.queueMaxDepth) {
      throw unavailable('queue_full', 'The judge is busy; try again shortly');
    }

    const runId = randomUUID();
    const ttlMs = limits.totalMs + ctx.config.timing.runGraceMs + 5000;
    const acquired = await ctx.redis.set(inflightKey, runId, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK')
      throw rateLimited(2, 'run_in_flight', 'Wait for your current run to finish');

    const now = new Date();
    const job: JudgeJob = JudgeJob.parse({
      v: 1,
      runId,
      language: body.language,
      source: body.source,
      mode: body.mode === 'file' ? 'file' : 'tests',
      stdin: body.mode === 'file' ? body.stdin : '',
      signature: body.mode === 'file' ? null : problem.signature,
      tests,
      limits,
      enqueuedAt: now.toISOString(),
    });

    try {
      const [row] = await ctx.db
        .insert(runs)
        .values({
          id: runId,
          padId,
          userId,
          mode: body.mode,
          language: body.language,
          source: body.source,
          status: 'queued',
          hiddenIds,
          testCount: tests.length,
          deadlineAt: new Date(now.getTime() + limits.totalMs + ctx.config.timing.runGraceMs),
          createdAt: now,
        })
        .returning();
      if (!row) throw new Error('run insert failed');
      this.live.set(runId, { padId, mode: body.mode, running: false });
      try {
        await ctx.redis.xadd(
          JUDGE_KEYS.jobsStream,
          'MAXLEN',
          '~',
          JOBS_MAXLEN,
          '*',
          'payload',
          JSON.stringify(job),
        );
      } catch (err) {
        ctx.log.error({ err, runId }, 'enqueue failed');
        await this.finish(this.syntheticFailure(runId, 'The judge queue is unavailable.'));
        throw unavailable('queue_unavailable', 'The judge queue is unavailable');
      }
      const run = toPublicRun(storedRun(row));
      ctx.rooms.broadcast(padId, { type: 'run.created', run });
      ctx.log.info(
        { runId, padId, mode: body.mode, language: body.language, tests: tests.length },
        'run queued',
      );
      return run;
    } catch (err) {
      await this.releaseInflight(userId, runId);
      // The pad was deleted between the membership check and the insert.
      if (isForeignKeyViolation(err)) throw notFound('Pad');
      throw err;
    }
  }

  /**
   * Unfinished runs of a deleted pad (their rows are gone with it): forget them and give their
   * users back the in-flight slot. A result the judge still sends finds no row and is dropped.
   */
  async forget(unfinished: { id: string; userId: string }[]): Promise<void> {
    for (const r of unfinished) {
      this.live.delete(r.id);
      await this.releaseInflight(r.userId, r.id);
    }
  }

  /** Jobs waiting or being processed: the judge group's lag + pending, or XLEN before the group exists. */
  async queueDepth(): Promise<number> {
    const { redis } = this.ctx;
    try {
      const groups = (await redis.call('XINFO', 'GROUPS', JUDGE_KEYS.jobsStream)) as unknown[][];
      for (const g of groups) {
        const info: Record<string, unknown> = {};
        for (let i = 0; i + 1 < g.length; i += 2) info[String(g[i])] = g[i + 1];
        if (info.name !== JUDGE_KEYS.jobsGroup) continue;
        const pending = Number(info.pending ?? 0);
        const lag = info.lag;
        if (lag === null || lag === undefined)
          return pending + (await redis.xlen(JUDGE_KEYS.jobsStream));
        return pending + Number(lag);
      }
      return await redis.xlen(JUDGE_KEYS.jobsStream);
    } catch {
      return 0; // stream does not exist yet
    }
  }

  private async releaseInflight(userId: string, runId: string): Promise<void> {
    await this.ctx.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      this.inflightKey(userId),
      runId,
    );
  }

  // ------------------------------------------------------------------ finish

  syntheticFailure(runId: string, message: string): JudgeResult {
    return {
      v: 1,
      runId,
      verdict: 'internal_error',
      compile: null,
      file: null,
      tests: [],
      message,
      timing: { queueMs: 0, totalMs: 0 },
      sandbox: { runtime: 'none', image: 'none' },
    };
  }

  /** Idempotent on runId: the first result wins, later ones are ignored. Returns whether it applied. */
  async finish(result: JudgeResult): Promise<boolean> {
    const { ctx } = this;
    const [row] = await ctx.db
      .update(runs)
      .set({ status: 'finished', verdict: result.verdict, result, finishedAt: new Date() })
      .where(and(eq(runs.id, result.runId), ne(runs.status, 'finished')))
      .returning();
    if (!row) return false;
    this.live.delete(row.id);
    await this.releaseInflight(row.userId, row.id);
    const stored = storedRun(row);
    const pub = toPublicRun(stored);
    try {
      await ctx.db.insert(timelineEvents).values({
        padId: row.padId,
        event: {
          type: 'run',
          runId: row.id,
          mode: row.mode,
          verdict: row.verdict,
          passed: pub.passed,
          total: pub.total,
        },
      });
    } catch (err) {
      // The pad was deleted between the update above and this insert: nobody to tell.
      if (isForeignKeyViolation(err)) return false;
      throw err;
    }
    ctx.rooms.broadcast(row.padId, { type: 'run.finished', run: pub });
    ctx.ai.trigger(row.padId, {
      type: 'run_finished',
      run: toInterviewerRun(stored),
      hiddenFailures: hiddenFailures(stored),
    });
    ctx.log.info(
      { runId: row.id, verdict: row.verdict, passed: pub.passed, total: pub.total },
      'run finished',
    );
    return true;
  }

  // ------------------------------------------------------------------ background work

  async start(): Promise<void> {
    const { ctx } = this;
    const opts = { maxRetriesPerRequest: null, lazyConnect: false } as const;
    // The API creates both groups from the start of the stream so nothing enqueued before a
    // consumer first starts is skipped. BUSYGROUP means it already exists.
    for (const [stream, group] of [
      [JUDGE_KEYS.resultsStream, JUDGE_KEYS.resultsGroup],
      [JUDGE_KEYS.jobsStream, JUDGE_KEYS.jobsGroup],
    ] as const) {
      await ctx.redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM').catch((err: Error) => {
        if (!String(err.message).includes('BUSYGROUP')) throw err;
      });
    }
    this.blocking = new Redis(ctx.config.redisUrl, opts);
    this.subscriber = new Redis(ctx.config.redisUrl, opts);
    this.blocking.on('error', (err) => ctx.log.warn({ err }, 'redis (results) error'));
    this.subscriber.on('error', (err) => ctx.log.warn({ err }, 'redis (progress) error'));
    await this.subscriber.subscribe(JUDGE_KEYS.progressChannel);
    // Handle progress strictly in arrival order.
    let chain = Promise.resolve();
    this.subscriber.on('message', (_channel, message) => {
      chain = chain.then(() =>
        this.onProgress(message).catch((err) => ctx.log.warn({ err }, 'progress handling failed')),
      );
    });
    this.loopDone = this.consumeResults();
    this.watchdogTimer = setInterval(() => {
      void this.watchdog().catch((err) => ctx.log.error({ err }, 'watchdog failed'));
    }, ctx.config.timing.watchdogMs);
    this.watchdogTimer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.blocking?.disconnect();
    this.subscriber?.disconnect();
    await this.loopDone;
  }

  private async consumeResults(): Promise<void> {
    const { ctx } = this;
    const blocking = this.blocking;
    if (!blocking) return;
    const { resultsStream: stream, resultsGroup: group } = JUDGE_KEYS;
    let backlog = true; // first re-read entries delivered to us but never acknowledged
    while (!this.stopped) {
      try {
        const args = backlog
          ? ['GROUP', group, ctx.config.consumerName, 'COUNT', 50, 'STREAMS', stream, '0']
          : [
              'GROUP',
              group,
              ctx.config.consumerName,
              'COUNT',
              50,
              'BLOCK',
              2000,
              'STREAMS',
              stream,
              '>',
            ];
        const reply = (await blocking.call('XREADGROUP', ...args)) as StreamReply;
        const entries = reply?.[0]?.[1] ?? [];
        if (backlog && entries.length === 0) backlog = false;
        for (const [id, fields] of entries) await this.handleResultEntry(id, fields);
      } catch (err) {
        if (this.stopped) break;
        ctx.log.warn({ err }, 'results consumer error; retrying');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async handleResultEntry(id: string, fields: string[] | null): Promise<void> {
    const { ctx } = this;
    const { resultsStream: stream, resultsGroup: group } = JUDGE_KEYS;
    if (fields) {
      const i = fields.indexOf('payload');
      const raw = i >= 0 ? fields[i + 1] : undefined;
      let parsed: ReturnType<typeof JudgeResult.safeParse> | null = null;
      try {
        parsed =
          raw && raw.length <= MAX_RESULT_BYTES ? JudgeResult.safeParse(JSON.parse(raw)) : null;
      } catch {
        parsed = null;
      }
      if (parsed?.success) {
        await this.finish(parsed.data);
      } else {
        // Poison message: acknowledge so it does not block the stream. The watchdog fails the run.
        ctx.log.error({ entryId: id }, 'invalid judge result dropped');
      }
    }
    await ctx.redis.xack(stream, group, id);
    await ctx.redis.xdel(stream, id);
  }

  private async onProgress(message: string): Promise<void> {
    let parsed: JudgeProgress;
    if (message.length > MAX_PROGRESS_BYTES) return;
    try {
      const r = JudgeProgress.safeParse(JSON.parse(message));
      if (!r.success) return;
      parsed = r.data;
    } catch {
      return;
    }
    let info = this.live.get(parsed.runId);
    if (!info) {
      const [row] = await this.ctx.db
        .select({ padId: runs.padId, mode: runs.mode, status: runs.status })
        .from(runs)
        .where(eq(runs.id, parsed.runId));
      if (!row || row.status === 'finished') return;
      info = { padId: row.padId, mode: row.mode, running: row.status === 'running' };
      this.live.set(parsed.runId, info);
    }
    if (!info.running) {
      info.running = true;
      await this.ctx.db
        .update(runs)
        .set({ status: 'running' })
        .where(and(eq(runs.id, parsed.runId), eq(runs.status, 'queued')));
    }
    const event = publicProgress(info.mode, parsed.event);
    if (event)
      this.ctx.rooms.broadcast(info.padId, { type: 'run.progress', runId: parsed.runId, event });
  }

  /** Fails runs whose result never arrived, and reclaims results stranded on dead consumers. */
  async watchdog(): Promise<void> {
    const { ctx } = this;
    const overdue = await ctx.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(ne(runs.status, 'finished'), lt(runs.deadlineAt, new Date())))
      .limit(50);
    for (const r of overdue) {
      ctx.log.warn({ runId: r.id }, 'run timed out waiting for the judge');
      await this.finish(
        this.syntheticFailure(r.id, 'The judge did not return a result in time. Please try again.'),
      );
    }
    try {
      const { resultsStream: stream, resultsGroup: group } = JUDGE_KEYS;
      const reply = (await ctx.redis.call(
        'XAUTOCLAIM',
        stream,
        group,
        ctx.config.consumerName,
        60_000,
        '0-0',
        'COUNT',
        50,
      )) as [string, [string, string[] | null][], ...unknown[]];
      for (const [id, fields] of reply?.[1] ?? []) await this.handleResultEntry(id, fields);
    } catch (err) {
      ctx.log.warn({ err }, 'xautoclaim failed');
    }
  }
}
