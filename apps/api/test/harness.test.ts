/**
 * Language-restricted problems with their own starter code and test harness, through the API:
 * the `box-cpp` fixture (C++ only; `BoxTests` harness drives the candidate's `Box<T>`).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { composeJudgedSource, ProblemContent, ProblemDetail } from '@ipp/contracts';
import { pads, runs } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeJudge } from './helpers/fake-judge';
import { Client, EventSocket, flushRedis, type Harness, startApi } from './helpers/harness';

const require = createRequire(import.meta.url);
const BOX = ProblemContent.parse(
  JSON.parse(readFileSync(require.resolve('@ipp/contracts/fixtures/problem-box-cpp.json'), 'utf8')),
);
const HARNESS = BOX.harness.cpp as string;
const CANDIDATE = BOX.referenceSolutions.cpp as string;

let h: Harness;
let judge: FakeJudge;
let ip = 0;

beforeAll(async () => {
  await flushRedis();
  h = await startApi();
  judge = new FakeJudge();
  judge.delayMs = 10;
  await judge.start();
});
afterAll(async () => {
  await judge?.stop();
  await h?.stop();
});

async function user(name: string) {
  const c = new Client(h.base, `198.51.100.${++ip}`);
  await c.signUp(name);
  return c;
}

async function boxPad(c: Client) {
  const res = await c.post('/api/pads', { problemSlug: 'box-cpp', language: 'cpp' });
  expect(res.status).toBe(200);
  return res.json as { id: string; language: string };
}

describe('language-restricted problems', () => {
  it('problem responses carry languages and starter code, never the harness', async () => {
    const c = new Client(h.base);
    const list = await c.get('/api/problems');
    const langs = Object.fromEntries(
      list.json.map((p: { slug: string; languages: string[] }) => [p.slug, p.languages]),
    );
    expect(langs).toMatchObject({ 'box-cpp': ['cpp'], 'two-sum': ['cpp', 'python', 'java'] });
    const d = await c.get('/api/problems/box-cpp');
    const detail = ProblemDetail.parse(d.json);
    expect(detail.languages).toEqual(['cpp']);
    expect(detail.scaffolds.cpp).toBe(BOX.starterCode.cpp);
    expect(d.text).not.toContain('class BoxTests');
    expect(d.text).not.toContain('harness');
    expect(d.text).not.toContain('value_(std::move(value))');
  });

  it('pad creation refuses a language the problem does not offer; the random pick skips it', async () => {
    const c = await user('Restricted');
    const bad = await c.post('/api/pads', { problemSlug: 'box-cpp', language: 'python' });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toEqual({
      code: 'language_unavailable',
      message: 'Box can only be solved in C++, not Python',
    });
    // box-cpp is the only hard problem in the fixtures.
    const none = await c.post('/api/pads', { random: { difficulty: 'hard' }, language: 'java' });
    expect(none.status).toBe(404);
    const picked = await c.post('/api/pads', { random: { difficulty: 'hard' }, language: 'cpp' });
    expect(picked.json.problemSlug).toBe('box-cpp');
  });

  it('refuses switching to an unoffered language over PATCH and the event channel', async () => {
    const c = await user('Switcher');
    const pad = await boxPad(c);
    const patched = await c.patch(`/api/pads/${pad.id}`, { language: 'java', title: 'renamed' });
    expect(patched.status).toBe(400);
    expect(patched.json.error.code).toBe('language_unavailable');
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    ws.send({ type: 'language', language: 'python' });
    const err = await ws.waitFor('error', (e) => e.code === 'language_unavailable');
    expect(err.message).toContain('only be solved in C++');
    ws.close();
    const [row] = await h.api.ctx.db.select().from(pads).where(eq(pads.id, pad.id));
    // Nothing changed, not even the title sent alongside the refused language.
    expect(row).toMatchObject({ language: 'cpp', title: 'Box' });
  });

  it('seeds the editor document with the starter code', async () => {
    const c = await user('Seeded');
    const pad = await boxPad(c);
    const texts = await h.api.ctx.collab.readTexts(pad.id);
    expect(texts.code.cpp).toBe(BOX.starterCode.cpp);
  });

  it('judged runs queue the candidate source plus the harness; the run row keeps only theirs', async () => {
    const c = await user('Harnessed');
    const pad = await boxPad(c);
    const composed = composeJudgedSource('cpp', CANDIDATE, HARNESS);
    expect(composed).toBe(`${CANDIDATE}#line 1 "tests.cpp"\n${HARNESS}`);
    const bodies = [
      { mode: 'samples' },
      { mode: 'submit' },
      { mode: 'custom', customTests: [{ calls: [{ method: 'roundTrip', args: [4] }] }] },
    ];
    for (const b of bodies) {
      const res = await c.post(`/api/pads/${pad.id}/runs`, {
        ...b,
        language: 'cpp',
        source: CANDIDATE,
      });
      expect(res.status, b.mode).toBe(201);
      await waitDone(res.json.id);
      const job = judge.jobs.find((j) => j.runId === res.json.id);
      expect(job?.mode).toBe('tests');
      expect(job?.source).toBe(composed);
      expect(job?.signature?.className).toBe('BoxTests');
      const [row] = await h.api.ctx.db.select().from(runs).where(eq(runs.id, res.json.id));
      expect(row?.source).toBe(CANDIDATE);
    }
    // File mode runs the candidate's program untouched.
    const file = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'cpp',
      source: CANDIDATE,
    });
    expect(file.status).toBe(201);
    await waitDone(file.json.id);
    expect(judge.jobs.find((j) => j.runId === file.json.id)?.source).toBe(CANDIDATE);
    // A judged run in an unoffered language is refused.
    const py = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source: 'x = 1',
    });
    expect(py.status).toBe(400);
    expect(py.json.error.code).toBe('language_unavailable');
  });

  it('a problem without a harness is queued exactly as sent', async () => {
    const c = await user('Plain');
    const pad = (await c.post('/api/pads', { problemSlug: 'two-sum', language: 'python' })).json;
    const source = 'class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]';
    const res = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source,
    });
    await waitDone(res.json.id);
    expect(judge.jobs.find((j) => j.runId === res.json.id)?.source).toBe(source);
  });
});

/** Waits for the run to finish so the per-user in-flight slot is free for the next one. */
async function waitDone(runId: string) {
  for (let i = 0; i < 200; i++) {
    const [row] = await h.api.ctx.db.select().from(runs).where(eq(runs.id, runId));
    if (row?.status === 'finished') return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not finish`);
}
