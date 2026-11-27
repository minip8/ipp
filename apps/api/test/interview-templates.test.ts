import {
  DeleteInterviewTemplateResponse,
  INTERVIEW_STAGES_MAX,
  INTERVIEW_TEMPLATE_NAME_MAX,
  INTERVIEW_TEMPLATES_MAX,
  Interview,
  InterviewStart,
  InterviewTemplate,
} from '@ipp/contracts';
import { interviewTemplates, user } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveTemplate } from '../src/interviews/templates';
import { Client, flushRedis, type Harness, startApi } from './helpers/harness';

let h: Harness;
const db = () => h.api.ctx.db;
const limits = () => h.api.ctx.config.limits.templateWrites;

beforeAll(async () => {
  await flushRedis();
  h = await startApi();
  // The tests save many plans; the rate limit has its own test.
  limits().userBurst = { limit: 1000, windowSec: 60 };
});

afterAll(async () => {
  await h?.stop();
});

let ipSeq = 0;
async function account(name: string, withKey = false) {
  const c = new Client(h.base, `100.67.${Math.floor(ipSeq / 200)}.${(ipSeq++ % 200) + 1}`);
  const { id } = await c.signUp(name);
  if (withKey) await c.saveKey();
  return Object.assign(c, { userId: id });
}

const coding = (over: Record<string, unknown> = {}) => ({
  kind: 'coding',
  language: 'python',
  durationMin: 30,
  ...over,
});
const questions = (topics: string[], durationMin = 15) => ({
  kind: 'questions',
  topics,
  durationMin,
});
const game = (durationMin = 10) => ({ kind: 'game', durationMin });

async function save(
  c: Client,
  name: string,
  over: { track?: string; stages?: unknown[] } = {},
): Promise<InterviewTemplate> {
  const res = await c.post('/api/interview-templates', {
    name,
    track: over.track ?? 'software',
    stages: over.stages ?? [coding()],
  });
  if (res.status !== 200) throw new Error(`save failed: ${res.status} ${res.text}`);
  return InterviewTemplate.parse(res.json);
}

async function list(c: Client): Promise<InterviewTemplate[]> {
  const res = await c.get('/api/interview-templates');
  if (res.status !== 200) throw new Error(`list failed: ${res.status} ${res.text}`);
  return InterviewTemplate.array().parse(res.json);
}

const rowsOf = (userId: string) =>
  db().select().from(interviewTemplates).where(eq(interviewTemplates.ownerId, userId));

// ---------------------------------------------------------------- saving and listing

describe('saving and listing', () => {
  it('saves a plan as given, trimmed, and returns it', async () => {
    const c = await account('Saver');
    const stages = [coding({ difficulty: 'medium' }), questions(['probability']), game(15)];
    const res = await c.post('/api/interview-templates', {
      name: '  Onsite practice  ',
      track: 'quant',
      stages,
    });
    expect(res.status).toBe(200);
    const t = InterviewTemplate.parse(res.json);
    expect(t.name).toBe('Onsite practice');
    expect(t.track).toBe('quant');
    expect(t.stages).toEqual(stages);
    expect(t.createdAt).toBe(t.updatedAt);
    expect(await list(c)).toEqual([t]);
  });

  it('does not check the plan against the content', async () => {
    const c = await account('Unchecked');
    const t = await save(c, 'Nowhere', {
      stages: [coding({ problemSlug: 'no-such-problem' }), questions(['no-such-topic'])],
    });
    expect(t.stages).toHaveLength(2);
  });

  it('lists both tracks by name whatever its case, then id', async () => {
    const c = await account('Lister');
    const b = await save(c, 'beta', { track: 'quant' });
    const a = await save(c, 'Alpha');
    const z = await save(c, 'zeta', { track: 'quant' });
    const g = await save(c, 'Gamma');
    // The same name in the other track is allowed, and sorts beside its twin by id.
    const a2 = await save(c, 'alpha', { track: 'quant' });
    const [first, second] = [a, a2].sort((x, y) => (x.id < y.id ? -1 : 1));
    expect((await list(c)).map((t) => t.id)).toEqual([first?.id, second?.id, b.id, g.id, z.id]);
    expect(new Set((await list(c)).map((t) => t.track))).toEqual(new Set(['software', 'quant']));
  });

  it('refuses a name the user has in that track, whatever its case', async () => {
    const c = await account('Clash');
    await save(c, 'My Loop');
    for (const name of ['My Loop', 'my loop', ' MY LOOP ']) {
      const res = await c.post('/api/interview-templates', {
        name,
        track: 'software',
        stages: [coding()],
      });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('template_name_taken');
    }
    // Another user may use it.
    const other = await account('OtherClash');
    await save(other, 'My Loop');
    expect(await rowsOf(c.userId)).toHaveLength(1);
  });

  it('refuses the same name saved twice at once, once', async () => {
    const c = await account('Racer');
    const body = { name: 'Twice', track: 'software', stages: [coding()] };
    const results = await Promise.all(
      Array.from({ length: 4 }, () => c.post('/api/interview-templates', body)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).map((r) => r.json.error.code)).toEqual([
      'template_name_taken',
      'template_name_taken',
      'template_name_taken',
    ]);
    expect(await rowsOf(c.userId)).toHaveLength(1);
  });

  it('keeps at most the limit over both tracks, also when saves race', async () => {
    const c = await account('Collector');
    const n = INTERVIEW_TEMPLATES_MAX - 2;
    for (let i = 0; i < n; i++) await save(c, `Plan ${i}`, { track: i % 2 ? 'quant' : 'software' });
    // Five at once for the last two places.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        c.post('/api/interview-templates', {
          name: `Last ${i}`,
          track: 'quant',
          stages: [coding()],
        }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    for (const r of results.filter((r) => r.status !== 200)) {
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('template_limit');
    }
    expect(await rowsOf(c.userId)).toHaveLength(INTERVIEW_TEMPLATES_MAX);
    // Deleting one makes room.
    const [one] = await list(c);
    expect((await c.del(`/api/interview-templates/${one?.id}`)).status).toBe(200);
    await save(c, 'Room again');
  });

  it('holds the limit when many saves race below the routes', async () => {
    // Without HTTP in between, the saves overlap in the database; the owner's row lock is what
    // keeps the count true.
    const c = await account('TightRace');
    const stages = [{ kind: 'coding', language: 'python', durationMin: 30 } as const];
    for (let i = 0; i < INTERVIEW_TEMPLATES_MAX - 1; i++)
      await saveTemplate(h.api.ctx, c.userId, { name: `p${i}`, track: 'software', stages });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        saveTemplate(h.api.ctx, c.userId, { name: `l${i}`, track: 'software', stages }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await rowsOf(c.userId)).toHaveLength(INTERVIEW_TEMPLATES_MAX);
  });

  it('validates the shape: name and stages', async () => {
    const c = await account('Validator');
    const bad: unknown[] = [
      { name: '', track: 'software', stages: [coding()] },
      { name: '   ', track: 'software', stages: [coding()] },
      { name: 'x'.repeat(INTERVIEW_TEMPLATE_NAME_MAX + 1), track: 'software', stages: [coding()] },
      { track: 'software', stages: [coding()] },
      { name: 'No track', stages: [coding()] },
      { name: 'Bad track', track: 'fundamentals', stages: [coding()] },
      { name: 'No stages', track: 'software', stages: [] },
      {
        name: 'Too many',
        track: 'software',
        stages: Array.from({ length: INTERVIEW_STAGES_MAX + 1 }, () => coding()),
      },
      { name: 'Bad kind', track: 'software', stages: [{ kind: 'essay', durationMin: 10 }] },
      { name: 'Bad language', track: 'software', stages: [coding({ language: 'cobol' })] },
      { name: 'No topics', track: 'software', stages: [questions([])] },
      { name: 'Bad length', track: 'software', stages: [coding({ durationMin: -5 })] },
    ];
    for (const body of bad) {
      const res = await c.post('/api/interview-templates', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.error.code).toBe('validation_error');
    }
    // A name of exactly the maximum is fine.
    await save(c, 'y'.repeat(INTERVIEW_TEMPLATE_NAME_MAX));
    expect(await rowsOf(c.userId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- updating

describe('updating', () => {
  it('renames, replaces the plan, or both, and stamps updatedAt', async () => {
    const c = await account('Editor');
    const t = await save(c, 'First', { stages: [coding()] });

    const renamed = await c.put(`/api/interview-templates/${t.id}`, { name: 'Second' });
    expect(renamed.status).toBe(200);
    const r1 = InterviewTemplate.parse(renamed.json);
    expect(r1).toMatchObject({ id: t.id, name: 'Second', track: 'software', stages: t.stages });
    expect(r1.createdAt).toBe(t.createdAt);
    expect(Date.parse(r1.updatedAt)).toBeGreaterThan(Date.parse(t.updatedAt));

    const plan = [questions(['operating-systems'], 20), coding({ difficulty: 'hard' })];
    const replaced = await c.put(`/api/interview-templates/${t.id}`, { stages: plan });
    expect(replaced.status).toBe(200);
    const r2 = InterviewTemplate.parse(replaced.json);
    expect(r2).toMatchObject({ name: 'Second', stages: plan });
    expect(Date.parse(r2.updatedAt)).toBeGreaterThan(Date.parse(r1.updatedAt));

    const both = await c.put(`/api/interview-templates/${t.id}`, {
      name: ' Third ',
      stages: [game()],
    });
    expect(both.status).toBe(200);
    expect(InterviewTemplate.parse(both.json)).toMatchObject({
      name: 'Third',
      stages: [game()],
    });
    expect(await list(c)).toEqual([InterviewTemplate.parse(both.json)]);
  });

  it('refuses a name another of the user’s has in that track; its own in another case is fine', async () => {
    const c = await account('Renamer');
    const a = await save(c, 'Alpha');
    const b = await save(c, 'Beta');
    const q = await save(c, 'Quanty', { track: 'quant' });

    const clash = await c.put(`/api/interview-templates/${b.id}`, { name: 'ALPHA' });
    expect(clash.status).toBe(409);
    expect(clash.json.error.code).toBe('template_name_taken');
    // Nothing changed, the plan neither.
    const clashBoth = await c.put(`/api/interview-templates/${b.id}`, {
      name: 'alpha',
      stages: [game()],
    });
    expect(clashBoth.status).toBe(409);
    const [row] = await db()
      .select()
      .from(interviewTemplates)
      .where(eq(interviewTemplates.id, b.id));
    expect(row?.name).toBe('Beta');
    expect(row?.stages).toEqual(b.stages);

    // The same name in the other track is no clash.
    const across = await c.put(`/api/interview-templates/${q.id}`, { name: 'Alpha' });
    expect(across.status).toBe(200);

    const ownCase = await c.put(`/api/interview-templates/${a.id}`, { name: 'ALPHA' });
    expect(ownCase.status).toBe(200);
    expect(ownCase.json.name).toBe('ALPHA');
  });

  it('validates the change', async () => {
    const c = await account('BadEdit');
    const t = await save(c, 'Kept');
    const bad: unknown[] = [
      {},
      { name: '' },
      { name: 'x'.repeat(INTERVIEW_TEMPLATE_NAME_MAX + 1) },
      { stages: [] },
      { stages: Array.from({ length: INTERVIEW_STAGES_MAX + 1 }, () => coding()) },
      { stages: [{ kind: 'coding' }] },
    ];
    for (const body of bad) {
      const res = await c.put(`/api/interview-templates/${t.id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.error.code).toBe('validation_error');
    }
    expect(await list(c)).toEqual([t]);
  });
});

// ---------------------------------------------------------------- deleting

describe('deleting', () => {
  it('deletes it; a repeat is 404', async () => {
    const c = await account('Deleter');
    const keep = await save(c, 'Keep');
    const t = await save(c, 'Gone');
    const res = await c.del(`/api/interview-templates/${t.id}`);
    expect(res.status).toBe(200);
    expect(DeleteInterviewTemplateResponse.parse(res.json)).toEqual({ templateId: t.id });
    expect(await list(c)).toEqual([keep]);
    expect((await c.del(`/api/interview-templates/${t.id}`)).status).toBe(404);
    expect((await c.put(`/api/interview-templates/${t.id}`, { name: 'Back' })).status).toBe(404);
  });

  it('goes with its user', async () => {
    const c = await account('Leaver');
    await save(c, 'One');
    await save(c, 'Two', { track: 'quant' });
    await db().delete(user).where(eq(user.id, c.userId));
    expect(await rowsOf(c.userId)).toEqual([]);
  });
});

// ---------------------------------------------------------------- access

describe('access', () => {
  it('is the owner’s alone: anyone else gets 404 on every route', async () => {
    const owner = await account('TplOwner');
    const other = await account('TplOther');
    const t = await save(owner, 'Private');
    const path = `/api/interview-templates/${t.id}`;
    expect((await other.put(path, { name: 'Mine now' })).status).toBe(404);
    expect((await other.put(path, { stages: [game()] })).status).toBe(404);
    expect((await other.del(path)).status).toBe(404);
    expect(await list(other)).toEqual([]);
    const ids = ['not-an-id', '-'.repeat(36), '00000000-0000-0000-0000-000000000000'];
    for (const id of ids) {
      expect((await other.put(`/api/interview-templates/${id}`, { name: 'X' })).status).toBe(404);
      expect((await other.del(`/api/interview-templates/${id}`)).status).toBe(404);
    }
    expect(await list(owner)).toEqual([t]);
  });

  it('refuses a guest and no session', async () => {
    const host = await account('TplHost');
    const t = await save(host, 'Host plan');
    const room = await host.post('/api/pads', {
      kind: 'room',
      problemSlug: 'two-sum',
      language: 'python',
    });
    expect(room.status).toBe(200);
    const guest = new Client(h.base, `100.67.250.${(ipSeq++ % 200) + 1}`);
    const joined = await guest.post('/api/pads/join-guest', {
      shareToken: room.json.shareToken,
      name: 'Casey',
    });
    expect(joined.status).toBe(200);
    const body = { name: 'Guest plan', track: 'software', stages: [coding()] };
    const path = `/api/interview-templates/${t.id}`;
    const anon = new Client(h.base, '100.67.251.1');
    for (const [c, status, code] of [
      [guest, 403, 'account_required'],
      [anon, 401, 'unauthorized'],
    ] as const) {
      for (const r of [
        await c.get('/api/interview-templates'),
        await c.post('/api/interview-templates', body),
        await c.put(path, { name: 'X' }),
        await c.del(path),
      ]) {
        expect(r.status).toBe(status);
        expect(r.json.error.code).toBe(code);
      }
    }
    expect(await list(host)).toEqual([t]);
  });

  it('rate-limits the writes, not the list', async () => {
    const c = await account('Busy');
    const saved = limits().userBurst;
    limits().userBurst = { limit: 3, windowSec: 60 };
    try {
      const t = await save(c, 'One');
      expect((await c.put(`/api/interview-templates/${t.id}`, { name: 'Uno' })).status).toBe(200);
      expect((await c.del(`/api/interview-templates/${t.id}`)).status).toBe(200);
      for (const r of [
        await c.post('/api/interview-templates', {
          name: 'Two',
          track: 'software',
          stages: [coding()],
        }),
        await c.put(`/api/interview-templates/${t.id}`, { name: 'Dos' }),
        await c.del(`/api/interview-templates/${t.id}`),
      ]) {
        expect(r.status).toBe(429);
        expect(r.json.error.code).toBe('rate_limited');
        expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
      }
      expect((await c.get('/api/interview-templates')).status).toBe(200);
      expect(await rowsOf(c.userId)).toEqual([]);
    } finally {
      limits().userBurst = saved;
    }
  });
});

// ---------------------------------------------------------------- starting from one

describe('starting an interview from a saved plan', () => {
  it('starts through the interview route and is unaffected when the template goes', async () => {
    const c = await account('Starter', true);
    const t = await save(c, 'Two problems', {
      stages: [coding(), coding({ durationMin: 45 })],
    });
    const res = await c.post('/api/interviews', { track: t.track, stages: t.stages });
    expect(res.status).toBe(200);
    const { interview, padId } = InterviewStart.parse(res.json);
    expect(padId).not.toBeNull();
    expect(interview.stages.map((s) => s.stage)).toEqual(t.stages);

    // Changing the plan, then deleting it, leaves the interview as it was.
    expect(
      (await c.put(`/api/interview-templates/${t.id}`, { stages: [game()], name: 'Other' })).status,
    ).toBe(200);
    expect((await c.del(`/api/interview-templates/${t.id}`)).status).toBe(200);
    const after = await c.get(`/api/interviews/${interview.id}`);
    expect(after.status).toBe(200);
    const kept = Interview.parse(after.json);
    expect(kept.stages.map((s) => s.stage)).toEqual(t.stages);
    expect(kept.status).toBe('active');
    expect((await c.get(`/api/pads/${padId}`)).status).toBe(200);
  });
});
