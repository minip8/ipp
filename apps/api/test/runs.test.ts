import { request } from 'node:http';
import { JUDGE_KEYS, Run } from '@ipp/contracts';
import { runs } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config';
import { MAX_RESULT_BYTES } from '../src/runs/service';
import { TEST_WEB_ORIGIN } from './helpers/env';
import { FakeJudge, SECRET } from './helpers/fake-judge';
import {
  Client,
  EventSocket,
  flushRedis,
  type Harness,
  sleep,
  startApi,
  until,
} from './helpers/harness';

let h: Harness;
let judge: FakeJudge;
let ipCounter = 0;

beforeAll(async () => {
  await flushRedis();
  h = await startApi();
  judge = new FakeJudge();
  await judge.start();
});
afterAll(async () => {
  await judge?.stop();
  await h?.stop();
});
beforeEach(() => {
  h.api.ctx.config.limits = structuredClone(DEFAULT_LIMITS);
  h.api.ctx.config.queueMaxDepth = 100;
  judge.behaviour = 'normal';
  judge.delayMs = 50;
});

async function userWithPad(name: string, ip = `192.0.2.${++ipCounter}`) {
  const c = new Client(h.base, ip);
  const user = await c.signUp(name);
  const pad = (await c.post('/api/pads', { problemSlug: 'two-sum', language: 'python' })).json;
  return { c, user, pad };
}

const SOURCE = 'class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]\n';

/** Sends only the headers of a large request and returns the status the server answers with. */
function declaredLength(path: string, length: number, c: Client): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(h.base + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(length),
        origin: TEST_WEB_ORIGIN,
        cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    req.on('error', reject);
    req.write('{"mode":"file"');
  });
}

function assertNoSecrets(s: string) {
  expect(s).not.toContain(SECRET);
  expect(s).not.toContain('"h1"');
}

describe('run pipeline', () => {
  it('submit goes through the judge and comes back redacted on every client path', async () => {
    const { c, pad } = await userWithPad('Runner');
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );

    const res = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'submit',
      language: 'python',
      source: SOURCE,
    });
    expect(res.status).toBe(201);
    const created = Run.parse(res.json);
    expect(created).toMatchObject({
      status: 'queued',
      verdict: null,
      tests: [],
      total: 3,
      passed: 0,
      mode: 'submit',
    });

    const finished = await ws.waitFor('run.finished', (e) => e.run.id === created.id);
    expect(Run.parse(finished.run)).toBeTruthy();
    expect(finished.run.verdict).toBe('wrong_answer');
    expect(finished.run.passed).toBe(2);
    expect(finished.run.tests).toEqual([
      expect.objectContaining({
        id: 's1',
        hidden: false,
        verdict: 'pass',
        stdout: 'visible stdout',
      }),
      expect.objectContaining({ id: 's2', hidden: false, verdict: 'pass' }),
      { hidden: true, id: 'hidden-1', verdict: 'fail', timeMs: 2 },
    ]);
    expect(ws.events.some((e) => e.type === 'run.created' && e.run.id === created.id)).toBe(true);
    const progress = ws.events.filter((e) => e.type === 'run.progress');
    expect(progress.map((e) => e.type === 'run.progress' && e.event.type)).toEqual([
      'started',
      'running',
    ]);

    // The judge got the hidden test with its expected output, and the full signature.
    const job = judge.jobs.find((j) => j.runId === created.id);
    expect(job?.tests.map((t) => t.id)).toEqual(['s1', 's2', 'h1']);
    expect(job?.mode).toBe('tests');
    expect(job?.signature?.className).toBe('Solution');

    // REST paths.
    const fetched = await c.get(`/api/runs/${created.id}`);
    expect(fetched.json).toEqual(finished.run);
    const detail = await c.get(`/api/pads/${pad.id}`);
    expect(detail.json.runs).toEqual([finished.run]);
    const playback = await c.get(`/api/pads/${pad.id}/playback`);
    expect(playback.json.events).toEqual([
      expect.objectContaining({
        event: {
          type: 'run',
          runId: created.id,
          mode: 'submit',
          verdict: 'wrong_answer',
          passed: 2,
          total: 3,
        },
      }),
    ]);
    for (const s of [...ws.raw, fetched.text, detail.text, playback.text]) assertNoSecrets(s);

    // The interviewer got the unredacted view.
    const trig = h.fake.of('run_finished', pad.id)[0]?.trigger;
    expect(trig?.type === 'run_finished' && trig.hiddenFailures).toBe(1);
    expect(JSON.stringify(trig)).toContain(SECRET);

    // The in-flight slot was released: another run is accepted.
    const again = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source: SOURCE,
    });
    expect(again.status).toBe(201);
    expect(again.json.total).toBe(2);
    const f2 = await ws.waitFor('run.finished', (e) => e.run.id === again.json.id);
    expect(f2.run.verdict).toBe('accepted');
    expect(judge.jobs.find((j) => j.runId === again.json.id)?.tests.map((t) => t.id)).toEqual([
      's1',
      's2',
    ]);
    ws.close();
  });

  it('file mode forwards live output and stdin; custom tests are validated', async () => {
    const { c, pad } = await userWithPad('Filer');
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    const res = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'cpp',
      source: 'int main(){}',
      stdin: 'in',
    });
    expect(res.status).toBe(201);
    const fin = await ws.waitFor('run.finished', (e) => e.run.id === res.json.id);
    expect(fin.run).toMatchObject({ verdict: 'ok', file: { stdout: 'hello\n' }, total: 0 });
    expect(ws.events.some((e) => e.type === 'run.progress' && e.event.type === 'output')).toBe(
      true,
    );
    const job = judge.jobs.find((j) => j.runId === res.json.id);
    expect(job).toMatchObject({ mode: 'file', stdin: 'in', signature: null, tests: [] });
    expect(job?.limits.runMs).toBe(10_000);

    const bad = [
      { customTests: [] },
      { customTests: [{ calls: [{ method: 'nope', args: [] }] }] },
      { customTests: [{ calls: [{ method: 'twoSum', args: [[1]] }] }] },
      { customTests: [{ ctorArgs: [1], calls: [{ method: 'twoSum', args: [[1], 1] }] }] },
    ];
    for (const b of bad) {
      const r = await c.post(`/api/pads/${pad.id}/runs`, {
        mode: 'custom',
        language: 'python',
        source: SOURCE,
        ...b,
      });
      expect(r.status).toBe(400);
    }
    const six = Array.from({ length: 6 }, () => ({
      calls: [{ method: 'twoSum', args: [[1, 2], 3] }],
    }));
    expect(
      (
        await c.post(`/api/pads/${pad.id}/runs`, {
          mode: 'custom',
          language: 'python',
          source: SOURCE,
          customTests: six,
        })
      ).status,
    ).toBe(400);
    const custom = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'custom',
      language: 'python',
      source: SOURCE,
      customTests: [{ calls: [{ method: 'twoSum', args: [[1, 2], 3] }] }],
    });
    expect(custom.status).toBe(201);
    const cf = await ws.waitFor('run.finished', (e) => e.run.id === custom.json.id);
    expect(cf.run.tests).toEqual([
      expect.objectContaining({ id: 'custom-1', hidden: false, verdict: 'ran' }),
    ]);
    expect(judge.jobs.find((j) => j.runId === custom.json.id)?.tests[0]?.expected).toBeNull();
    ws.close();
  });

  it('enforces size caps', async () => {
    const { c, pad } = await userWithPad('Big');
    const big = 'x'.repeat(64 * 1024 + 1);
    const r1 = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'cpp',
      source: big,
    });
    expect(r1.status).toBe(413);
    expect(r1.json.error.code).toBe('too_large');
    // Over the route's body limit: rejected from Content-Length before the body is read.
    expect(await declaredLength(`/api/pads/${pad.id}/runs`, 600 * 1024, c)).toBe(413);
    const r3 = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'cpp',
      source: 'ok',
      stdin: big,
    });
    expect(r3.status).toBe(413);
    const r4 = await c.post('/api/pads', { language: 'cpp', title: 'y'.repeat(70 * 1024) });
    expect(r4.status).toBe(413);
  });

  it('allows one in-flight run per user', async () => {
    const { c, pad } = await userWithPad('Busy');
    judge.delayMs = 1500;
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    const first = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source: SOURCE,
    });
    expect(first.status).toBe(201);
    const second = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source: SOURCE,
    });
    expect(second.status).toBe(429);
    expect(second.json.error).toMatchObject({ code: 'run_in_flight', retryAfter: 2 });
    expect(second.headers.get('retry-after')).toBe('2');
    await ws.waitFor('run.finished', (e) => e.run.id === first.json.id);
    const third = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source: SOURCE,
    });
    expect(third.status).toBe(201);
    await ws.waitFor('run.finished', (e) => e.run.id === third.json.id);
    ws.close();
  });

  it('rate limits runs per user and per IP', async () => {
    h.api.ctx.config.limits.runs.userBurst = { limit: 2, windowSec: 60 };
    const { c, pad } = await userWithPad('Spammer', '192.0.2.200');
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    for (let i = 0; i < 2; i++) {
      const r = await c.post(`/api/pads/${pad.id}/runs`, {
        mode: 'file',
        language: 'python',
        source: 'print(1)',
      });
      expect(r.status).toBe(201);
      await ws.waitFor('run.finished', (e) => e.run.id === r.json.id);
    }
    const limited = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source: 'print(1)',
    });
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe('rate_limited');
    expect(limited.json.error.retryAfter).toBeGreaterThan(50);
    ws.close();

    // Per IP: a second account from the same address shares the IP budget.
    h.api.ctx.config.limits.runs.userBurst = DEFAULT_LIMITS.runs.userBurst;
    h.api.ctx.config.limits.runs.ipBurst = { limit: 3, windowSec: 60 };
    const second = await userWithPad('SameIp', '192.0.2.200');
    const r = await second.c.post(`/api/pads/${second.pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source: 'print(1)',
    });
    expect(r.status).toBe(201);
    await until(
      async () => (await second.c.get(`/api/runs/${r.json.id}`)).json.status === 'finished',
    );
    const r2 = await second.c.post(`/api/pads/${second.pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source: 'print(1)',
    });
    expect(r2.status).toBe(429);
  });

  it('refuses with 503 when the queue is too deep, and the watchdog fails runs that never finish', async () => {
    judge.behaviour = 'silent';
    h.api.ctx.config.queueMaxDepth = 1;
    const a = await userWithPad('QueueA');
    const b = await userWithPad('QueueB');
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${a.pad.id}?ticket=${await a.c.ticket(a.pad.id)}`,
    );
    const first = await a.c.post(`/api/pads/${a.pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source: 'print(1)',
    });
    expect(first.status).toBe(201);
    // The silent judge read it (pending = 1).
    await until(() => judge.jobs.some((j) => j.runId === first.json.id));
    const full = await b.c.post(`/api/pads/${b.pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source: 'print(1)',
    });
    expect(full.status).toBe(503);
    expect(full.json.error.code).toBe('queue_full');

    // Pretend the deadline passed.
    await h.api.ctx.db
      .update(runs)
      .set({ deadlineAt: new Date(Date.now() - 1000) })
      .where(eq(runs.id, first.json.id));
    const fin = await ws.waitFor('run.finished', (e) => e.run.id === first.json.id);
    expect(fin.run).toMatchObject({ verdict: 'internal_error', status: 'finished' });
    expect(fin.run.message).toMatch(/did not return a result/);
    // Acknowledge the stranded job so the queue depth goes back down for later tests.
    const pending = (await h.api.ctx.redis.xpending(
      JUDGE_KEYS.jobsStream,
      JUDGE_KEYS.jobsGroup,
      '-',
      '+',
      100,
    )) as [string][];
    for (const [id] of pending)
      await h.api.ctx.redis.xack(JUDGE_KEYS.jobsStream, JUDGE_KEYS.jobsGroup, id);
    ws.close();
  });

  it('drops oversized judge results and rejects deeply nested bodies', async () => {
    judge.behaviour = 'silent';
    const { c, pad } = await userWithPad('Oversized');
    const r = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source: 'print(1)',
    });
    expect(r.status).toBe(201);
    await until(() => judge.jobs.some((j) => j.runId === r.json.id));
    const result = {
      v: 1,
      runId: r.json.id,
      verdict: 'ok',
      compile: null,
      file: null,
      tests: [],
      message: 'x'.repeat(MAX_RESULT_BYTES),
      timing: { queueMs: 0, totalMs: 0 },
      sandbox: { runtime: 'runc', image: 'x' },
    };
    await h.api.ctx.redis.xadd(JUDGE_KEYS.resultsStream, '*', 'payload', JSON.stringify(result));
    await until(async () => (await h.api.ctx.redis.xlen(JUDGE_KEYS.resultsStream)) === 0);
    expect((await c.get(`/api/runs/${r.json.id}`)).json.status).not.toBe('finished');
    await h.api.ctx.redis.xadd(
      JUDGE_KEYS.resultsStream,
      '*',
      'payload',
      JSON.stringify({ ...result, message: null }),
    );
    await until(async () => (await c.get(`/api/runs/${r.json.id}`)).json.status === 'finished');
    const pending = (await h.api.ctx.redis.xpending(
      JUDGE_KEYS.jobsStream,
      JUDGE_KEYS.jobsGroup,
      '-',
      '+',
      100,
    )) as [string][];
    for (const [id] of pending)
      await h.api.ctx.redis.xack(JUDGE_KEYS.jobsStream, JUDGE_KEYS.jobsGroup, id);

    const deep = `{"mode":"custom","language":"python","source":"x","customTests":[{"calls":[{"method":"twoSum","args":[${'['.repeat(300)}${']'.repeat(300)},1]}]}]}`;
    const bad = await c.post(`/api/pads/${pad.id}/runs`, deep);
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/nested deeper/);
  });

  it('is idempotent on runId (duplicate results are ignored)', async () => {
    judge.behaviour = 'duplicate';
    const { c, pad } = await userWithPad('Dup');
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    const r = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source: SOURCE,
    });
    await ws.waitFor('run.finished', (e) => e.run.id === r.json.id);
    await sleep(500);
    expect(ws.events.filter((e) => e.type === 'run.finished')).toHaveLength(1);
    expect((await c.get(`/api/runs/${r.json.id}`)).json.verdict).toBe('accepted');
    const events = (await c.get(`/api/pads/${pad.id}/playback`)).json.events;
    expect(events.filter((e: { event: { type: string } }) => e.event.type === 'run')).toHaveLength(
      1,
    );
    // Results stream is drained.
    expect(await h.api.ctx.redis.xlen(JUDGE_KEYS.resultsStream)).toBe(0);
    ws.close();
  });

  it('a result that arrives after its pad was deleted is dropped quietly', async () => {
    judge.behaviour = 'silent';
    const { c, pad } = await userWithPad('LateResult');
    const r = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source: 'print(1)',
    });
    expect(r.status).toBe(201);
    await until(() => judge.jobs.some((j) => j.runId === r.json.id));
    const inflight = `${h.api.ctx.config.redisPrefix}inflight:${(await c.get('/api/me')).json.user.id}`;
    expect(await h.api.ctx.redis.exists(inflight)).toBe(1);

    expect((await c.del(`/api/pads/${pad.id}`)).json).toEqual({ padId: pad.id, removed: 'pad' });
    // The user's in-flight slot is given back at once, not after the run's deadline.
    expect(await h.api.ctx.redis.exists(inflight)).toBe(0);
    expect((await c.get(`/api/runs/${r.json.id}`)).status).toBe(404);

    const finish = vi.spyOn(h.api.ctx.runs, 'finish');
    try {
      const late = {
        v: 1,
        runId: r.json.id,
        verdict: 'ok',
        compile: null,
        file: null,
        tests: [],
        message: null,
        timing: { queueMs: 0, totalMs: 5 },
        sandbox: { runtime: 'runc', image: 'x' },
      };
      await h.api.ctx.redis.xadd(JUDGE_KEYS.resultsStream, '*', 'payload', JSON.stringify(late));
      await until(async () => (await h.api.ctx.redis.xlen(JUDGE_KEYS.resultsStream)) === 0);
      await until(() => finish.mock.results.length > 0);
      await expect(finish.mock.results[0]?.value).resolves.toBe(false);
    } finally {
      finish.mockRestore();
    }
    const pending = (await h.api.ctx.redis.xpending(
      JUDGE_KEYS.jobsStream,
      JUDGE_KEYS.jobsGroup,
      '-',
      '+',
      100,
    )) as [string][];
    for (const [id] of pending)
      await h.api.ctx.redis.xack(JUDGE_KEYS.jobsStream, JUDGE_KEYS.jobsGroup, id);

    // The pipeline carries on for the user's next pad.
    judge.behaviour = 'normal';
    const next = (await c.post('/api/pads', { problemSlug: 'two-sum', language: 'python' })).json;
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${next.id}?ticket=${await c.ticket(next.id)}`,
    );
    const again = await c.post(`/api/pads/${next.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source: SOURCE,
    });
    expect(again.status).toBe(201);
    await ws.waitFor('run.finished', (e) => e.run.id === again.json.id);
    ws.close();
  });

  it('another user cannot read a run', async () => {
    const { c, pad } = await userWithPad('Private');
    const r = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source: 'print(1)',
    });
    const other = new Client(h.base, '192.0.2.250');
    await other.signUp('Snoop');
    expect((await other.get(`/api/runs/${r.json.id}`)).status).toBe(404);
  });
});
