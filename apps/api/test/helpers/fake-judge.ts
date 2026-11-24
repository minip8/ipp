/**
 * Speaks the judge side of contracts/src/judge.ts over real Redis: XREADGROUP judge:jobs,
 * PUBLISH judge:progress, XADD judge:results, XACK. Hidden tests "fail" with output and messages
 * full of SECRET markers so tests can assert none of it reaches a client.
 */
import { JUDGE_KEYS, JudgeJob, type JudgeProgress, type JudgeResult } from '@ipp/contracts';
import { Redis } from 'ioredis';
import { TEST_REDIS_URL } from './env';

export const SECRET = 'SECRET-HIDDEN';

export type JudgeBehaviour = 'normal' | 'silent' | 'duplicate';

export class FakeJudge {
  private redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
  private pub = new Redis(TEST_REDIS_URL);
  private stopped = false;
  private loop: Promise<void> | null = null;
  jobs: JudgeJob[] = [];
  behaviour: JudgeBehaviour = 'normal';
  /** Delay before writing the result (lets tests observe queued/in-flight state). */
  delayMs = 50;

  async start(): Promise<void> {
    await this.redis
      .xgroup('CREATE', JUDGE_KEYS.jobsStream, JUDGE_KEYS.jobsGroup, '0', 'MKSTREAM')
      .catch(() => {});
    this.loop = this.run();
  }

  private async run() {
    while (!this.stopped) {
      try {
        const reply = (await this.redis.call(
          'XREADGROUP',
          'GROUP',
          JUDGE_KEYS.jobsGroup,
          'fake-judge',
          'COUNT',
          1,
          'BLOCK',
          500,
          'STREAMS',
          JUDGE_KEYS.jobsStream,
          '>',
        )) as [string, [string, string[]][]][] | null;
        for (const [id, fields] of reply?.[0]?.[1] ?? []) {
          const job = JudgeJob.parse(JSON.parse(fields[fields.indexOf('payload') + 1] as string));
          this.jobs.push(job);
          // A silent judge never acknowledges (as if it died mid-job).
          if (this.behaviour === 'silent') continue;
          await this.process(job);
          await this.redis.xack(JUDGE_KEYS.jobsStream, JUDGE_KEYS.jobsGroup, id);
        }
      } catch (err) {
        if (this.stopped) return;
        throw err;
      }
    }
  }

  private async progress(p: JudgeProgress) {
    await this.pub.publish(JUDGE_KEYS.progressChannel, JSON.stringify(p));
  }

  private async process(job: JudgeJob) {
    await this.progress({ runId: job.runId, event: { type: 'started' } });
    await this.progress({
      runId: job.runId,
      event: { type: 'running', done: 0, total: job.tests.length },
    });
    // In judged modes this chunk would come from candidate prints during a (possibly hidden) test.
    await this.progress({
      runId: job.runId,
      event: { type: 'output', stream: 'stdout', chunk: `${SECRET}-progress` },
    });
    await new Promise((r) => setTimeout(r, this.delayMs));
    const hiddenish = (id: string) => id.startsWith('h');
    const result: JudgeResult = {
      v: 1,
      runId: job.runId,
      verdict:
        job.mode === 'file'
          ? 'ok'
          : job.tests.some((t) => hiddenish(t.id))
            ? 'wrong_answer'
            : 'accepted',
      compile: { ok: true, output: '', timeMs: 10 },
      file:
        job.mode === 'file'
          ? {
              exitCode: 0,
              signal: null,
              stdout: 'hello\n',
              stderr: '',
              truncated: false,
              timeMs: 3,
            }
          : null,
      tests: job.tests.map((t) =>
        hiddenish(t.id)
          ? {
              id: t.id,
              verdict: 'fail',
              timeMs: 2,
              actual: [`${SECRET}-actual`],
              stdout: `${SECRET}-stdout ${JSON.stringify(t.calls)}`,
              stderr: `${SECRET}-stderr`,
              message: `expected ${JSON.stringify(t.expected)} ${SECRET}-message`,
            }
          : {
              id: t.id,
              verdict: t.expected === null ? 'ran' : 'pass',
              timeMs: 1,
              actual: t.expected ?? [null],
              stdout: 'visible stdout',
              stderr: '',
              message: null,
            },
      ),
      message: null,
      timing: { queueMs: 1, totalMs: 20 },
      sandbox: { runtime: 'fake', image: 'fake' },
    };
    await this.redis.xadd(JUDGE_KEYS.resultsStream, '*', 'payload', JSON.stringify(result));
    if (this.behaviour === 'duplicate') {
      // At-least-once delivery: a second, different result for the same run must be ignored.
      await this.redis.xadd(
        JUDGE_KEYS.resultsStream,
        '*',
        'payload',
        JSON.stringify({ ...result, verdict: 'internal_error' }),
      );
    }
  }

  async stop() {
    this.stopped = true;
    this.redis.disconnect();
    this.pub.disconnect();
    await this.loop?.catch(() => {});
  }
}
