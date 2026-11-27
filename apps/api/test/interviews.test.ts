import {
  DeleteInterviewResponse,
  Interview,
  InterviewStart,
  PadDetail,
  QuantGame,
  type QuantRoundState,
  QuizQuestion,
  type ReportAssessment,
} from '@ipp/contracts';
import {
  interviews,
  pads,
  quantGames,
  quantRoundAnswers,
  quantRounds,
  quizQuestions,
  quizTopics,
  reports,
} from '@ipp/db';
import { eq, inArray } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config';
import { interviewerMessageCap } from '../src/interviewer/host';
import { interviewTitle, stagePosition, topicsTitle } from '../src/interviews/logic';
import { sweepQuantRounds } from '../src/quant/sweeper';
import {
  Client,
  FakeInterviewer,
  flushRedis,
  type Harness,
  startApi,
  until,
} from './helpers/harness';

// ---------------------------------------------------------------- content

const TOPICS = [
  { slug: 'stg-prob', title: 'Stage Probability', track: 'quant' },
  { slug: 'stg-teasers', title: 'Stage Brainteasers', track: 'quant' },
  { slug: 'stg-cpp', title: 'Stage C++', track: 'fundamentals' },
  { slug: 'stg-os', title: 'Stage OS', track: 'fundamentals' },
  // Three questions: enough for a 15-minute round only.
  { slug: 'stg-thin', title: 'Stage Thin', track: 'fundamentals' },
  { slug: 'stg-mm', title: 'Stage Market making', track: 'quant' },
] as const;
const DIFFICULTIES = ['easy', 'easy', 'medium', 'medium', 'hard', 'hard'] as const;

/** Every question id contains `stgq-`, which nothing else does, so a leak is a substring search. */
function question(topic: string, k: number, type: 'short' | 'numeric' | 'single') {
  const base = {
    id: `stgq-${topic}-${k}`,
    topic,
    subtopic: `sub-${k}`,
    difficulty: DIFFICULTIES[k % DIFFICULTIES.length],
    tags: [],
    prompt: `Question ${k} of ${topic}?`,
    explanation: `EXPLAIN-${topic}-${k}`,
  };
  if (type === 'single')
    return {
      ...base,
      type,
      choices: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      answer: 'a',
    };
  if (type === 'numeric')
    return { ...base, type, answer: '42', hints: [`HINT-${k}`], followUps: [`FOLLOW-${k}`] };
  return { ...base, type, reference: `REFERENCE-${k}`, keyPoints: [`KEY-${k}`] };
}

const QUESTIONS = [
  // Quant topics: short and numeric (with hints), six each.
  ...['stg-prob', 'stg-teasers'].flatMap((t) =>
    DIFFICULTIES.map((_, k) => question(t, k, k % 2 ? 'numeric' : 'short')),
  ),
  // Fundamentals topics: short questions (eligible) and a choice question (never in a round).
  ...['stg-cpp', 'stg-os'].flatMap((t) => [
    ...DIFFICULTIES.map((_, k) => question(t, k, 'short')),
    question(t, 9, 'single'),
  ]),
  ...[0, 1, 2].map((k) => question('stg-thin', k, 'short')),
];

const GAME = QuantGame.parse({
  id: 'mm-stg-game',
  topic: 'stg-mm',
  title: 'Two hidden numbers',
  difficulty: 'medium',
  prompt: 'Make me a market on the sum of two hidden numbers.',
  components: [
    { label: 'First', faces: [12345.678, 23456.789] },
    { label: 'Second', faces: [34567.891, 45678.912] },
  ],
  payoff: 'sum',
  reveal: [0],
  tick: 0.5,
  maxSize: 5,
  counterparty: 'COUNTERPARTY-SECRET: trade on the books.',
  hints: ['GAMEHINT-1'],
  explanation: 'GAMEEXPLAIN',
  expect: { fair: '58024.635', sd: 7856.71, min: '46913.569', max: '69135.701' },
});

// ---------------------------------------------------------------- harness

let h: Harness;
let fake: FakeInterviewer;
const db = () => h.api.ctx.db;

beforeAll(async () => {
  await flushRedis();
  fake = new FakeInterviewer();
  // The tests move rounds themselves.
  fake.quantAutoStart = false;
  h = await startApi({ fake });
  await db()
    .insert(quizTopics)
    .values(TOPICS.map((t) => ({ ...t, description: 'staged interview tests' })))
    .onConflictDoNothing();
  for (const raw of QUESTIONS) {
    const q = QuizQuestion.parse(raw);
    await db()
      .insert(quizQuestions)
      .values({
        id: q.id,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty,
        type: q.type,
        data: q,
      })
      .onConflictDoNothing();
  }
  await db()
    .insert(quantGames)
    .values({ id: GAME.id, topic: GAME.topic, difficulty: GAME.difficulty, data: GAME })
    .onConflictDoNothing();
});

afterAll(async () => {
  const d = h?.api.ctx.db;
  if (d) {
    const ids = QUESTIONS.map((q) => q.id);
    await d.delete(quantRoundAnswers).where(inArray(quantRoundAnswers.questionId, ids));
    await d.delete(quizQuestions).where(inArray(quizQuestions.id, ids));
    await d.delete(quantGames).where(eq(quantGames.id, GAME.id));
    await d.delete(quizTopics).where(
      inArray(
        quizTopics.slug,
        TOPICS.map((t) => t.slug),
      ),
    );
  }
  await h?.stop();
});

let ipSeq = 0;
async function account(name: string, withKey = true) {
  const c = new Client(h.base, `100.66.${Math.floor(ipSeq / 200)}.${(ipSeq++ % 200) + 1}`);
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

async function create(c: Client, stages: unknown[], extra: Record<string, unknown> = {}) {
  const res = await c.post('/api/interviews', { track: 'software', stages, ...extra });
  if (res.status !== 200) throw new Error(`create failed: ${res.status} ${res.text}`);
  return InterviewStart.parse(res.json);
}

async function next(c: Client, id: string, from: number) {
  const res = await c.post(`/api/interviews/${id}/next`, { from });
  if (res.status !== 200) throw new Error(`next failed: ${res.status} ${res.text}`);
  return InterviewStart.parse(res.json);
}

async function getInterview(c: Client, id: string) {
  const res = await c.get(`/api/interviews/${id}`);
  if (res.status !== 200) throw new Error(`get failed: ${res.status} ${res.text}`);
  return Interview.parse(res.json);
}

async function padDetail(c: Client, padId: string) {
  const res = await c.get(`/api/pads/${padId}`);
  if (res.status !== 200) throw new Error(`pad failed: ${res.status} ${res.text}`);
  return PadDetail.parse(res.json);
}

const stagePads = (interviewId: string) =>
  db().select().from(pads).where(eq(pads.interviewId, interviewId)).orderBy(pads.stageIndex);

async function roundState(padId: string): Promise<QuantRoundState> {
  const [row] = await db().select().from(quantRounds).where(eq(quantRounds.padId, padId));
  if (!row) throw new Error('no round');
  return row.state;
}

async function countOwned(userId: string) {
  const [i, p] = await Promise.all([
    db().select().from(interviews).where(eq(interviews.ownerId, userId)),
    db().select().from(pads).where(eq(pads.ownerId, userId)),
  ]);
  return { interviews: i.length, pads: p.length };
}

const mustPad = (padId: string | null): string => {
  if (!padId) throw new Error('no pad to open');
  return padId;
};

/** Starts a round (as the interviewer does on `session_started`) without a socket. */
async function startRound(padId: string) {
  const out = await fake.deps.applyQuantStep?.(padId, { type: 'start', version: 0, say: 'Hi.' });
  if (!out?.ok) throw new Error(`start refused: ${JSON.stringify(out)}`);
  return out;
}

// ---------------------------------------------------------------- pure rules

describe('the pure rules', () => {
  it('names a questions stage by its topics, shortened past three', () => {
    expect(topicsTitle(['Probability'])).toBe('Probability');
    expect(topicsTitle(['Probability', 'Brainteasers'])).toBe('Probability, Brainteasers');
    expect(topicsTitle(['A', 'B', 'C'])).toBe('A, B, C');
    expect(topicsTitle(['C++', 'Concurrency', 'Networking', 'OS'])).toBe(
      'C++, Concurrency + 2 more',
    );
    expect(topicsTitle(['A', 'B', 'C', 'D', 'E'])).toBe('A, B + 3 more');
  });

  it('titles an interview by what was given, else its preset, else plainly', () => {
    expect(interviewTitle('  Mine  ', 'trader')).toBe('Mine');
    expect(interviewTitle(undefined, 'trader')).toBe('Trader');
    expect(interviewTitle('', 'onsite-loop')).toBe('Onsite loop');
    expect(interviewTitle(undefined, null)).toBe('Custom interview');
    expect(interviewTitle(undefined, 'no-such-preset')).toBe('Custom interview');
  });

  it('places a stage for its interviewer only in an interview of several stages', () => {
    const plan = [{ kind: 'coding' }, { kind: 'questions' }, { kind: 'game' }] as const;
    expect(stagePosition([{ kind: 'coding' }], 0)).toBeNull();
    expect(stagePosition(plan, 0)).toEqual({ index: 0, total: 3, next: 'questions' });
    expect(stagePosition(plan, 1)).toEqual({ index: 1, total: 3, next: 'game' });
    expect(stagePosition(plan, 2)).toEqual({ index: 2, total: 3, next: null });
    expect(stagePosition(plan, 3)).toBeNull();
  });

  it('gives a short round the per-pad message cap', () => {
    const limits = DEFAULT_LIMITS;
    expect(interviewerMessageCap({ format: 'quant', durationMin: 10 }, limits)).toBe(
      limits.interviewerMessagesPerPad,
    );
    expect(interviewerMessageCap({ format: 'quant', durationMin: 15 }, limits)).toBe(
      limits.interviewerMessagesPerPad,
    );
  });
});

// ---------------------------------------------------------------- creating one

describe('creating an interview', () => {
  it('starts stage 0 as a coding pad and nothing of the later stages', async () => {
    const c = await account('Creator');
    const { interview, padId } = await create(
      c,
      [coding({ problemSlug: 'two-sum' }), questions(['stg-prob', 'stg-teasers']), game()],
      {
        title: 'My loop',
        interviewer: { style: 'tough', proactivity: 'high', voice: true },
      },
    );
    expect(interview).toMatchObject({
      title: 'My loop',
      track: 'software',
      preset: null,
      status: 'active',
      current: 0,
      endedAt: null,
      interviewer: { style: 'tough', proactivity: 'high', voice: true },
    });
    expect(interview.stages.map((s) => s.status)).toEqual(['active', 'upcoming', 'upcoming']);
    expect(interview.stages[0]?.pad).toMatchObject({
      id: padId,
      title: 'Two Sum',
      problemTitle: 'Two Sum',
      endedAt: null,
    });
    expect(interview.stages[0]?.result).toBeNull();
    expect(interview.stages[1]?.pad).toBeNull();
    // Lazy: the later stages have no pad, so no round, no draw.
    const rows = await stagePads(interview.id);
    expect(rows.map((p) => p.stageIndex)).toEqual([0]);
    expect(rows[0]).toMatchObject({
      kind: 'practice',
      format: 'coding',
      problemSlug: 'two-sum',
      language: 'python',
      durationMin: 30,
      interviewer: { style: 'tough', proactivity: 'high', voice: true, enabled: true },
      ownerId: c.userId,
    });
    const detail = await padDetail(c, mustPad(padId));
    expect(detail.pad.interviewId).toBe(interview.id);
    expect(detail.problem?.slug).toBe('two-sum');
    // The interviewer's context knows where the pad sits.
    const ctx = await fake.deps.loadContext(mustPad(padId));
    expect(ctx.stage).toEqual({ index: 0, total: 3, next: 'questions' });
  });

  it('records a known preset and titles by it; an unknown one is not recorded', async () => {
    const c = await account('Preset');
    const known = await create(c, [coding()], { preset: 'coding-round', track: 'software' });
    expect(known.interview).toMatchObject({ preset: 'coding-round', title: 'Coding round' });
    const unknown = await create(c, [coding()], { preset: 'made-up' });
    expect(unknown.interview).toMatchObject({ preset: null, title: 'Custom interview' });
  });

  it('starts a questions stage of fundamentals topics as a technical round of those topics', async () => {
    const c = await account('Technical');
    const { interview, padId } = await create(c, [questions(['stg-cpp', 'stg-os'], 20)]);
    const detail = await padDetail(c, mustPad(padId));
    expect(detail.pad).toMatchObject({
      format: 'quant',
      kind: 'practice',
      title: 'Stage C++, Stage OS',
      durationMin: 20,
      interviewer: { enabled: true },
    });
    expect(detail.round).toMatchObject({ mode: 'ai', path: null, subject: 'technical', total: 3 });
    const state = await roundState(mustPad(padId));
    expect(state.path).toBeNull();
    expect(state.subject).toBe('technical');
    expect(state.questions).toHaveLength(3);
    for (const q of state.questions) {
      expect(['stg-cpp', 'stg-os']).toContain(q.topic);
      // Only the eligible (short) questions, never the choice question.
      expect(q.questionId).not.toMatch(/-9$/);
      expect(q.game ?? null).toBeNull();
    }
    // Nothing of the round's draw in the interview's view.
    const raw = (await c.get(`/api/interviews/${interview.id}`)).text;
    expect(raw).not.toContain('stgq-');
    expect(raw).not.toContain('REFERENCE-');
    // One stage: the interviewer runs it as any round; its subject is the round's.
    const qc = await fake.quantContext(mustPad(padId));
    expect(qc?.round.subject).toBe('technical');
    expect(qc?.stage ?? null).toBeNull();
  });

  it('starts a mixed questions stage, its title shortened past three topics', async () => {
    const c = await account('Mixed');
    const { padId } = await create(c, [
      questions(['stg-prob', 'stg-teasers', 'stg-cpp', 'stg-os'], 30),
    ]);
    const detail = await padDetail(c, mustPad(padId));
    expect(detail.pad.title).toBe('Stage Probability, Stage Brainteasers + 2 more');
    expect(detail.round).toMatchObject({ path: null, subject: 'mixed', total: 4 });
    const state = await roundState(mustPad(padId));
    // Round-robin over the topics: four questions, four topics.
    expect(new Set(state.questions.map((q) => q.topic)).size).toBe(4);
  });

  it('starts a game stage as a round of one game and no bank question', async () => {
    const c = await account('Gamer');
    const { interview, padId } = await create(c, [game(15)], { track: 'quant' });
    const detail = await padDetail(c, mustPad(padId));
    expect(detail.pad).toMatchObject({ title: 'Market-making game', durationMin: 15 });
    expect(detail.round).toMatchObject({ path: null, subject: 'quant', total: 1 });
    const state = await roundState(mustPad(padId));
    expect(state.questions).toHaveLength(1);
    expect(state.questions[0]?.game).toBeTruthy();
    expect(state.questions[0]?.questionId).not.toMatch(/^stgq-/);
    const raw = (await c.get(`/api/interviews/${interview.id}`)).text;
    expect(raw).not.toContain('COUNTERPARTY');
    expect(raw).not.toContain('12345.678');
  });

  it('picks a random problem the owner has not had, and any match when all have been', async () => {
    for (let i = 0; i < 3; i++) {
      const c = await account(`Fresh${i}`);
      const had = await c.post('/api/pads', { problemSlug: 'two-sum', language: 'python' });
      expect(had.status).toBe(200);
      // python: two-sum and lru-cache match; two-sum has been had.
      const { padId } = await create(c, [coding()]);
      expect((await padDetail(c, mustPad(padId))).problem?.slug).toBe('lru-cache');
      const again = await create(c, [coding()]);
      expect(['two-sum', 'lru-cache']).toContain(
        (await padDetail(c, mustPad(again.padId))).problem?.slug,
      );
    }
    const c = await account('Category');
    const { padId } = await create(c, [coding({ category: 'data-structure' })]);
    expect((await padDetail(c, mustPad(padId))).pad.title).toBe('LRU Cache');
  });

  it('refuses a plan that cannot run, before creating anything', async () => {
    const c = await account('Refused');
    const refused = async (stages: unknown[], status: number, code: string, message?: RegExp) => {
      const res = await c.post('/api/interviews', { track: 'software', stages });
      expect(res.status, res.text).toBe(status);
      expect(res.json.error.code).toBe(code);
      if (message) expect(res.json.error.message).toMatch(message);
    };
    await refused([coding({ problemSlug: 'no-such-problem' })], 404, 'not_found', /^Stage 1/);
    await refused(
      [coding(), coding({ problemSlug: 'box-cpp', language: 'python' })],
      400,
      'language_unavailable',
    );
    // Box is the only hard problem, and C++ only.
    await refused([coding({ difficulty: 'hard' })], 404, 'not_found', /^Stage 1/);
    await refused(
      [coding(), questions(['stg-prob', 'no-such-topic'])],
      404,
      'not_found',
      /Stage 2.*no-such-topic/,
    );
    await refused(
      [coding(), questions(['stg-thin'], 45)],
      409,
      'quant_unavailable',
      /^Stage 2 \(Stage Thin\)/,
    );
    // Enough for a short round, not for a longer one: three eligible, four asked for.
    await refused(
      [questions(['stg-thin'], 15), questions(['stg-thin'], 30)],
      409,
      'quant_unavailable',
      /^Stage 2/,
    );
    // Shapes the contract refuses.
    await refused([], 400, 'validation_error');
    await refused([coding({ durationMin: 20 })], 400, 'validation_error');
    await refused([questions(['stg-prob', 'stg-prob'])], 400, 'validation_error');
    // No active game.
    const active = await db()
      .update(quantGames)
      .set({ active: false })
      .where(eq(quantGames.active, true))
      .returning({ id: quantGames.id });
    try {
      await refused([coding(), game()], 409, 'quant_unavailable', /^Stage 2/);
    } finally {
      if (active.length)
        await db()
          .update(quantGames)
          .set({ active: true })
          .where(
            inArray(
              quantGames.id,
              active.map((g) => g.id),
            ),
          );
    }
    expect(await countOwned(c.userId)).toEqual({ interviews: 0, pads: 0 });
  });

  it('refuses without an AI key, a guest and no session', async () => {
    const noKey = await account('NoKey', false);
    const res = await noKey.post('/api/interviews', { track: 'software', stages: [coding()] });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('ai_key_missing');
    expect(await countOwned(noKey.userId)).toEqual({ interviews: 0, pads: 0 });

    const host = await account('Host');
    const room = await host.post('/api/pads', {
      kind: 'room',
      problemSlug: 'two-sum',
      language: 'python',
    });
    expect(room.status).toBe(200);
    const guest = new Client(h.base, `100.66.250.${(ipSeq++ % 200) + 1}`);
    const joined = await guest.post('/api/pads/join-guest', {
      shareToken: room.json.shareToken,
      name: 'Casey',
    });
    expect(joined.status).toBe(200);
    for (const r of [
      await guest.post('/api/interviews', { track: 'software', stages: [coding()] }),
      await guest.get('/api/interviews'),
    ]) {
      expect(r.status).toBe(403);
      expect(r.json.error.code).toBe('account_required');
    }
    const anon = new Client(h.base, '100.66.251.1');
    expect((await anon.get('/api/interviews')).status).toBe(401);
  });

  it('is the owner’s alone: anyone else gets 404', async () => {
    const owner = await account('Owner');
    const other = await account('Other');
    const { interview } = await create(owner, [coding(), coding()]);
    const id = interview.id;
    expect((await other.get(`/api/interviews/${id}`)).status).toBe(404);
    expect((await other.post(`/api/interviews/${id}/next`, { from: 0 })).status).toBe(404);
    expect((await other.post(`/api/interviews/${id}/end`)).status).toBe(404);
    expect((await other.del(`/api/interviews/${id}`)).status).toBe(404);
    expect((await other.get('/api/interviews/not-an-id')).status).toBe(404);
    expect((await other.get('/api/interviews')).json).toEqual([]);
    // Nothing changed.
    expect((await getInterview(owner, id)).status).toBe('active');
    expect(await stagePads(id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- moving on

describe('moving on', () => {
  it('ends the stage under way and starts the next, once, and the last ends the interview', async () => {
    const c = await account('Mover');
    const start = await create(c, [coding(), questions(['stg-prob', 'stg-teasers'])]);
    const id = start.interview.id;
    const first = mustPad(start.padId);

    const moved = await next(c, id, 0);
    expect(moved.interview.current).toBe(1);
    expect(moved.interview.stages.map((s) => s.status)).toEqual(['done', 'active']);
    const second = mustPad(moved.padId);
    expect(second).not.toBe(first);
    const rows = await stagePads(id);
    expect(rows.map((p) => [p.stageIndex, p.status])).toEqual([
      [0, 'ended'],
      [1, 'active'],
    ]);
    // The first stage ended as any pad does: it has a report.
    const [report] = await db().select().from(reports).where(eq(reports.padId, first));
    expect(report).toBeTruthy();
    expect(rows[1]).toMatchObject({
      format: 'quant',
      durationMin: 15,
      title: 'Stage Probability, Stage Brainteasers',
    });
    expect((await roundState(second)).questions).toHaveLength(2);
    const qc = await fake.quantContext(second);
    expect(qc?.stage).toEqual({ index: 1, total: 2, next: null });
    expect(qc?.round.subject).toBe('quant');

    // Again from 0 (a second click): nothing changes.
    const repeat = await next(c, id, 0);
    expect(repeat.padId).toBe(second);
    expect(repeat.interview.current).toBe(1);
    expect(await stagePads(id)).toHaveLength(2);

    // From the last stage: the interview ends.
    const done = await next(c, id, 1);
    expect(done.padId).toBeNull();
    expect(done.interview.status).toBe('ended');
    expect(done.interview.endedAt).not.toBeNull();
    expect(done.interview.stages.map((s) => s.status)).toEqual(['done', 'done']);
    expect((await stagePads(id)).map((p) => p.status)).toEqual(['ended', 'ended']);
    // And after the end, nothing.
    const after = await next(c, id, 1);
    expect(after.padId).toBeNull();
    expect(after.interview.status).toBe('ended');
    expect(await stagePads(id)).toHaveLength(2);
  });

  it('starts one pad for a stage when two calls race', async () => {
    const c = await account('Racer');
    const { interview } = await create(c, [coding(), coding(), coding()]);
    const [a, b, d] = await Promise.all([
      next(c, interview.id, 0),
      next(c, interview.id, 0),
      next(c, interview.id, 0),
    ]);
    expect(a.padId).not.toBeNull();
    expect(b.padId).toBe(a.padId);
    expect(d.padId).toBe(a.padId);
    const rows = await stagePads(interview.id);
    expect(rows.map((p) => [p.stageIndex, p.status])).toEqual([
      [0, 'ended'],
      [1, 'active'],
    ]);
    expect((await getInterview(c, interview.id)).current).toBe(1);
  });

  it('leaves the interview where it was when the next stage cannot start, to retry', async () => {
    const c = await account('Retry');
    const { interview } = await create(c, [coding(), questions(['stg-os', 'stg-cpp'])]);
    const os = QUESTIONS.filter((q) => q.topic === 'stg-os' || q.topic === 'stg-cpp').map(
      (q) => q.id,
    );
    await db().update(quizQuestions).set({ active: false }).where(inArray(quizQuestions.id, os));
    try {
      const res = await c.post(`/api/interviews/${interview.id}/next`, { from: 0 });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('quant_unavailable');
      expect(res.json.error.message).toMatch(/^Stage 2/);
      const now = await getInterview(c, interview.id);
      expect(now).toMatchObject({ status: 'active', current: 0 });
      expect(now.stages.map((s) => s.status)).toEqual(['done', 'upcoming']);
      expect((await stagePads(interview.id)).map((p) => p.status)).toEqual(['ended']);
    } finally {
      await db().update(quizQuestions).set({ active: true }).where(inArray(quizQuestions.id, os));
    }
    const retried = await next(c, interview.id, 0);
    expect(retried.interview.current).toBe(1);
    expect(retried.padId).not.toBeNull();
    expect(await stagePads(interview.id)).toHaveLength(2);
  });

  it('does not ask a later stage what an earlier one asked', async () => {
    const c = await account('NoRepeat');
    const topics = ['stg-prob', 'stg-teasers'];
    const { interview, padId } = await create(c, [questions(topics), questions(topics)], {
      track: 'quant',
    });
    const first = mustPad(padId);
    const started = await startRound(first);
    const close = await fake.deps.applyQuantStep?.(first, {
      type: 'close',
      version: started.version,
      index: 0,
      kind: 'chat',
      say: 'Next.',
      by: 'interviewer',
      verdict: { score: 1, summary: 'Right.' },
    });
    expect(close?.ok).toBe(true);
    const asked = (await roundState(first)).questions
      .filter((q) => q.posedAt !== null)
      .map((q) => q.questionId);
    expect(asked).toHaveLength(2);
    const moved = await next(c, interview.id, 0);
    const later = (await roundState(mustPad(moved.padId))).questions.map((q) => q.questionId);
    expect(later).toHaveLength(2);
    for (const id of later) expect(asked).not.toContain(id);
  });

  it('ends the interview when its last pad ends by the pad’s own End, not an earlier one', async () => {
    const c = await account('PadEnd');
    const { interview, padId } = await create(c, [coding(), coding()]);
    // The first pad's own End: the interview waits for `next`.
    expect((await c.post(`/api/pads/${mustPad(padId)}/end`)).status).toBe(200);
    let now = await getInterview(c, interview.id);
    expect(now).toMatchObject({ status: 'active', current: 0 });
    expect(now.stages.map((s) => s.status)).toEqual(['done', 'upcoming']);
    const moved = await next(c, interview.id, 0);
    expect((await c.post(`/api/pads/${mustPad(moved.padId)}/end`)).status).toBe(200);
    now = await getInterview(c, interview.id);
    expect(now.status).toBe('ended');
    expect(now.endedAt).not.toBeNull();
    expect(now.stages.map((s) => s.status)).toEqual(['done', 'done']);
  });
});

// ---------------------------------------------------------------- ending and deleting

describe('ending and deleting', () => {
  it('ends now: the stage under way ends and the rest are skipped; again changes nothing', async () => {
    const c = await account('Ender');
    const { interview, padId } = await create(c, [coding(), coding(), game()]);
    const res = await c.post(`/api/interviews/${interview.id}/end`);
    expect(res.status).toBe(200);
    const ended = Interview.parse(res.json);
    expect(ended.status).toBe('ended');
    expect(ended.stages.map((s) => s.status)).toEqual(['done', 'skipped', 'skipped']);
    expect((await stagePads(interview.id)).map((p) => p.status)).toEqual(['ended']);
    const again = await c.post(`/api/interviews/${interview.id}/end`);
    expect(again.status).toBe(200);
    const repeated = Interview.parse(again.json);
    // The report may have been written in the meantime; nothing else moves.
    expect(repeated).toMatchObject({ status: 'ended', endedAt: ended.endedAt, current: 0 });
    expect(repeated.stages.map((s) => s.status)).toEqual(['done', 'skipped', 'skipped']);
    expect(repeated.stages[0]?.pad).toEqual(ended.stages[0]?.pad);
    // Nothing follows an ended interview.
    const after = await next(c, interview.id, 0);
    expect(after.padId).toBeNull();
    expect(await stagePads(interview.id)).toHaveLength(1);
    expect((await padDetail(c, mustPad(padId))).interview?.active).toBe(false);
  });

  it('deletes every stage’s pad with the interview', async () => {
    const c = await account('Deleter');
    const { interview, padId } = await create(c, [
      coding(),
      questions(['stg-prob', 'stg-teasers']),
    ]);
    const moved = await next(c, interview.id, 0);
    const padIds = [mustPad(padId), mustPad(moved.padId)];
    const res = await c.del(`/api/interviews/${interview.id}`);
    expect(res.status).toBe(200);
    expect(DeleteInterviewResponse.parse(res.json)).toEqual({ interviewId: interview.id });
    expect(await db().select().from(pads).where(inArray(pads.id, padIds))).toEqual([]);
    expect(await db().select().from(interviews).where(eq(interviews.id, interview.id))).toEqual([]);
    expect((await c.get(`/api/interviews/${interview.id}`)).status).toBe(404);
    for (const id of padIds) expect((await c.get(`/api/pads/${id}`)).status).toBe(404);
    expect((await c.del(`/api/interviews/${interview.id}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------- a stage's pad

describe('a stage’s pad', () => {
  it('says where it sits to its owner only, and is deleted only with its interview', async () => {
    const owner = await account('PadOwner');
    const friend = await account('Friend');
    const plan = [coding(), questions(['stg-prob', 'stg-teasers'])];
    const { interview, padId } = await create(owner, plan, { title: 'Two stages' });
    const pad = mustPad(padId);
    const mine = await padDetail(owner, pad);
    expect(mine.interview).toEqual({
      id: interview.id,
      title: 'Two stages',
      index: 0,
      total: 2,
      next: plan[1],
      active: true,
    });
    const token = mine.pad.shareToken;
    expect((await friend.post('/api/pads/join', { shareToken: token })).status).toBe(200);
    const theirs = await padDetail(friend, pad);
    expect(theirs.role).toBe('collaborator');
    expect(theirs.interview).toBeNull();

    const refused = await owner.del(`/api/pads/${pad}`);
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe('in_interview');
    expect(await db().select().from(pads).where(eq(pads.id, pad))).toHaveLength(1);
    // A collaborator leaving is as ever.
    const left = await friend.del(`/api/pads/${pad}`);
    expect(left.status).toBe(200);
    expect(left.json).toEqual({ padId: pad, removed: 'membership' });

    // The last stage: nothing after it.
    const moved = await next(owner, interview.id, 0);
    expect((await padDetail(owner, mustPad(moved.padId))).interview).toMatchObject({
      index: 1,
      total: 2,
      next: null,
      active: true,
    });

    // A pad of no interview has none.
    const alone = await owner.post('/api/pads', { problemSlug: 'two-sum', language: 'python' });
    expect((await padDetail(owner, alone.json.id)).interview).toBeNull();
  });
});

// ---------------------------------------------------------------- the list

describe('the list', () => {
  it('lists newest first with each stage’s status and report headline', async () => {
    const c = await account('Lister');
    const older = await create(c, [coding({ problemSlug: 'two-sum' }), coding()]);
    const newer = await create(c, [coding({ problemSlug: 'lru-cache' }), game()]);
    // Hold the coding assessment until the test lets it go.
    let release: (a: ReportAssessment | null) => void = () => {};
    const gate = new Promise<ReportAssessment | null>((r) => {
      release = r;
    });
    const original = fake.generateAssessment;
    fake.generateAssessment = async () => gate;
    try {
      await next(c, older.interview.id, 0);
      const list = (await c.get('/api/interviews')).json;
      const parsed = Interview.array().parse(list);
      expect(parsed.map((i) => i.id)).toEqual([newer.interview.id, older.interview.id]);
      const [n, o] = parsed;
      expect(n?.stages.map((s) => s.status)).toEqual(['active', 'upcoming']);
      expect(n?.stages[0]?.pad?.problemTitle).toBe('LRU Cache');
      expect(n?.stages[0]?.result).toBeNull();
      expect(o?.stages.map((s) => s.status)).toEqual(['done', 'active']);
      expect(o?.stages[0]?.result).toEqual({ report: 'pending', recommendation: null });
      expect(o?.stages[1]?.result).toBeNull();
      release({ ...fake.assessment, recommendation: 'strong_hire' } as ReportAssessment);
      await until(async () => {
        const i = await getInterview(c, older.interview.id);
        return i.stages[0]?.result?.report === 'ready';
      });
      expect((await getInterview(c, older.interview.id)).stages[0]?.result).toEqual({
        report: 'ready',
        recommendation: 'strong_hire',
      });
    } finally {
      fake.generateAssessment = original;
      release(null);
    }
  });
});

// ---------------------------------------------------------------- short rounds

describe('short rounds', () => {
  /** Every pad but `id` counts as attended, so the sweep is this test's alone. */
  const onlyThis = (id: string) => (padId: string) => padId !== id;
  const overdue = async (padId: string, index: number) => {
    const state = await roundState(padId);
    const q = state.questions[index];
    if (!q?.posedAt || !q.budgetSec) throw new Error('not posed');
    const grace = Math.min(90, Math.floor(q.budgetSec / 4));
    q.posedAt = new Date(Date.now() - (q.budgetSec + grace + 1) * 1000).toISOString();
    await db().update(quantRounds).set({ state }).where(eq(quantRounds.padId, padId));
  };
  const backdate = (padId: string, minutes: number) =>
    db()
      .update(pads)
      .set({ startedAt: new Date(Date.now() - minutes * 60_000) })
      .where(eq(pads.id, padId));

  it('gives a 10-minute game its whole round, and the round’s clock closes it', async () => {
    const c = await account('TenMinutes');
    const { padId } = await create(c, [game(10)], { track: 'quant' });
    const id = mustPad(padId);
    await startRound(id);
    const q = (await roundState(id)).questions[0];
    // The round less the wrap-up, the one question's share; never above 1.5 × 10 minutes.
    expect(q?.budgetSec).toBeGreaterThanOrEqual(530);
    expect(q?.budgetSec).toBeLessThanOrEqual(540);
    expect(await sweepQuantRounds(h.api.ctx, onlyThis(id))).toBe(0);
    await backdate(id, 11);
    expect(await sweepQuantRounds(h.api.ctx, onlyThis(id))).toBe(1);
    const state = await roundState(id);
    expect(state.questions[0]?.closedBy).toBe('round_time');
    expect(state.current).toBe(1);
  });

  it('shares a 15-minute round between its two questions', async () => {
    const c = await account('FifteenMinutes');
    const { padId } = await create(c, [questions(['stg-prob', 'stg-teasers'], 15)], {
      track: 'quant',
    });
    const id = mustPad(padId);
    await startRound(id);
    let state = await roundState(id);
    expect(state.questions).toHaveLength(2);
    // (15 min − 1 min wrap-up) / 2.
    expect(state.questions[0]?.budgetSec).toBeGreaterThanOrEqual(410);
    expect(state.questions[0]?.budgetSec).toBeLessThanOrEqual(420);
    await overdue(id, 0);
    expect(await sweepQuantRounds(h.api.ctx, onlyThis(id))).toBe(1);
    state = await roundState(id);
    expect(state.questions[0]?.closedBy).toBe('timeout');
    expect(state.current).toBe(1);
    // What is left, capped at 1.5 × the even share (450 s).
    expect(state.questions[1]?.budgetSec).toBe(675);
    await backdate(id, 16);
    expect(await sweepQuantRounds(h.api.ctx, onlyThis(id))).toBe(1);
    state = await roundState(id);
    expect(state.questions[1]?.closedBy).toBe('round_time');
    expect(state.current).toBe(2);
  });
});
