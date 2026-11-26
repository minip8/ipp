import { ProblemProgress } from '@ipp/contracts';
import { runs } from '@ipp/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config';
import { Client, flushRedis, type Harness, startApi } from './helpers/harness';

let h: Harness;
let ipCounter = 0;
beforeAll(async () => {
  await flushRedis();
  h = await startApi();
});
afterAll(async () => h?.stop());
beforeEach(() => {
  h.api.ctx.config.limits = structuredClone(DEFAULT_LIMITS);
});

async function user(name: string) {
  const c = new Client(h.base, `198.51.100.${++ipCounter}`);
  const me = await c.signUp(name);
  return { c, id: me.id };
}

async function progress(c: Client) {
  const res = await c.get('/api/progress/problems');
  expect(res.status, res.text).toBe(200);
  return ProblemProgress.parse(res.json);
}

/** A run stored as the judge would have left it (the run pipeline has its own tests). */
async function storeRun(
  padId: string,
  userId: string,
  problemSlug: string | null,
  mode: 'file' | 'samples' | 'custom' | 'submit',
  verdict: string,
  createdAt = new Date(),
) {
  await h.api.ctx.db.insert(runs).values({
    padId,
    userId,
    problemSlug,
    mode,
    language: 'python',
    source: 'pass',
    status: 'finished',
    verdict,
    deadlineAt: new Date(Date.now() + 60_000),
    createdAt,
    finishedAt: createdAt,
  });
}

async function practicePad(c: Client, problemSlug: string) {
  const res = await c.post('/api/pads', { problemSlug, language: 'python' });
  expect(res.status, res.text).toBe(200);
  return res.json as { id: string; startedAt: string };
}

describe('problem progress', () => {
  it('is empty for someone who has done nothing', async () => {
    const { c } = await user('Fresh');
    expect(await progress(c)).toEqual([]);
  });

  it('a practice interview makes a problem attempted; an accepted submission solves it', async () => {
    const { c, id } = await user('Solver');
    const pad = await practicePad(c, 'two-sum');
    expect(await progress(c)).toEqual([
      { slug: 'two-sum', status: 'attempted', lastActivityAt: expect.any(String) },
    ]);

    // Runs that are not an accepted submission leave it attempted.
    await storeRun(pad.id, id, 'two-sum', 'samples', 'accepted');
    await storeRun(pad.id, id, 'two-sum', 'submit', 'wrong_answer');
    expect((await progress(c)).map((p) => p.status)).toEqual(['attempted']);

    const at = new Date(Date.now() + 5_000);
    await storeRun(pad.id, id, 'two-sum', 'submit', 'accepted', at);
    expect(await progress(c)).toEqual([
      { slug: 'two-sum', status: 'solved', lastActivityAt: at.toISOString() },
    ]);
    // A later failed submission does not take it back.
    await storeRun(pad.id, id, 'two-sum', 'submit', 'wrong_answer', new Date(at.getTime() + 1));
    expect((await progress(c))[0]?.status).toBe('solved');
  });

  it('lists the most recent first, one entry per problem', async () => {
    const { c, id } = await user('Busy');
    const older = await practicePad(c, 'two-sum');
    await storeRun(older.id, id, 'two-sum', 'submit', 'accepted', new Date(Date.now() - 60_000));
    await practicePad(c, 'two-sum');
    await practicePad(c, 'lru-cache');
    const list = await progress(c);
    expect(list.map((p) => [p.slug, p.status])).toEqual([
      ['lru-cache', 'attempted'],
      ['two-sum', 'solved'],
    ]);
  });

  it('counts only the caller’s own runs: a room host is not credited with the candidate’s', async () => {
    const host = await user('Host');
    const candidate = await user('Candidate');
    const room = await host.c.post('/api/pads', {
      kind: 'room',
      language: 'python',
      problemSlug: 'two-sum',
    });
    expect(room.status, room.text).toBe(200);
    const joined = await candidate.c.post('/api/pads/join', { shareToken: room.json.shareToken });
    expect(joined.status, joined.text).toBe(200);
    // Hosting a room is not attempting its problem, and being in one is not either.
    expect(await progress(host.c)).toEqual([]);
    expect(await progress(candidate.c)).toEqual([]);

    await storeRun(room.json.id, candidate.id, 'two-sum', 'submit', 'accepted');
    // The room moved on to another problem: the run there counts for that one.
    await storeRun(room.json.id, candidate.id, 'lru-cache', 'samples', 'runtime_error');
    // The blank editor's runs belong to no problem.
    await storeRun(room.json.id, candidate.id, null, 'file', 'accepted');
    expect(
      (await progress(candidate.c))
        .map((p) => [p.slug, p.status])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ['lru-cache', 'attempted'],
      ['two-sum', 'solved'],
    ]);
    expect(await progress(host.c)).toEqual([]);
  });

  it('deleting the interview takes its runs, and so its progress, with it', async () => {
    const { c, id } = await user('Tidy');
    const pad = await practicePad(c, 'lru-cache');
    await storeRun(pad.id, id, 'lru-cache', 'submit', 'accepted');
    expect((await progress(c))[0]?.status).toBe('solved');
    expect((await c.del(`/api/pads/${pad.id}`)).status).toBe(200);
    expect(await progress(c)).toEqual([]);
  });

  it('refuses anonymous callers and guests', async () => {
    const anon = new Client(h.base, `198.51.100.${++ipCounter}`);
    expect((await anon.get('/api/progress/problems')).status).toBe(401);

    const host = await user('Hostess');
    const room = await host.c.post('/api/pads', {
      kind: 'room',
      language: 'python',
      problemSlug: 'two-sum',
    });
    const guest = new Client(h.base, `198.51.100.${++ipCounter}`);
    const joined = await guest.post('/api/pads/join-guest', {
      shareToken: room.json.shareToken,
      name: 'Casey',
    });
    expect(joined.status).toBe(200);
    const res = await guest.get('/api/progress/problems');
    expect([res.status, res.json?.error?.code]).toEqual([403, 'account_required']);
  });
});
