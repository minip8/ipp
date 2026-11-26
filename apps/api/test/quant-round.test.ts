import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  LANGUAGES,
  type Pad,
  type QuantRoundState,
  type QuantStep,
  QuizQuestion,
  type ServerEvent,
  YDOC,
} from '@ipp/contracts';
import {
  aiUsage,
  interviewerNotes,
  messages,
  pads,
  quantRoundAnswers,
  quantRounds,
  quizQuestions,
  quizStandaloneAnswers,
  quizTopics,
  timelineEvents,
} from '@ipp/db';
import { and, asc, eq, inArray, like } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { QUANT_SCRATCH_CHARS, quantTrigger } from '../src/interviewer/host';
import { finishRound } from '../src/quant/round';
import {
  Client,
  EventSocket,
  FakeInterviewer,
  flushRedis,
  type Harness,
  sleep,
  startApi,
  until,
} from './helpers/harness';

// ---------------------------------------------------------------- the question bank

const QUANT_TOPICS = [
  { slug: 'probability', title: 'Probability', description: 'quant round tests', track: 'quant' },
  { slug: 'brainteasers', title: 'Brainteasers', description: 'quant round tests', track: 'quant' },
] as const;

/**
 * Every server-only text carries a marker, so a leak is a substring search. A prompt's own
 * marker is `[P<k>X]`; question ids all contain `qround`, which nothing else does.
 */
const ANSWER_MARK = '0.000271828';
function quantQuestion(
  k: number,
  topic: string,
  difficulty: 'easy' | 'medium' | 'hard',
  type: 'short' | 'numeric',
  extras: { hints?: string[]; followUps?: string[]; active?: boolean } = {},
) {
  const base = {
    id: `qround-${k}`,
    topic,
    subtopic: `sub-${k}`,
    difficulty,
    tags: [],
    prompt: `What is the value of puzzle ${k}? [P${k}X]`,
    explanation: `EXPLAIN-${k}`,
    hints: extras.hints ?? [`HINT-${k}-A`, `HINT-${k}-B`],
    followUps: extras.followUps ?? [`FOLLOWUP-${k}`],
  };
  return type === 'short'
    ? { ...base, type, reference: `REFERENCE-${k}`, keyPoints: [`KEYPOINT-${k}`] }
    : {
        ...base,
        type,
        answer: `${ANSWER_MARK}${k}`,
        ...(k % 2 === 0 ? { answerText: `ANSWERTEXT-${k}` } : {}),
        ...(k % 3 === 0 ? { unit: 'dollars' } : {}),
      };
}

const LAYOUT = [
  ['easy', 'short'],
  ['easy', 'numeric'],
  ['medium', 'short'],
  ['medium', 'numeric'],
  ['medium', 'short'],
  ['hard', 'numeric'],
  ['hard', 'short'],
] as const;

const ELIGIBLE = QUANT_TOPICS.flatMap((t, ti) =>
  LAYOUT.map(([d, type], i) => quantQuestion(ti * 10 + i + 1, t.slug, d, type)),
);
/** Not in any round: a numeric question with neither hints nor follow-ups, a choice question, an inactive one. */
const INELIGIBLE = [
  quantQuestion(90, 'probability', 'easy', 'numeric', { hints: [], followUps: [] }),
  {
    id: 'qround-91',
    topic: 'probability',
    subtopic: 'sub-91',
    difficulty: 'easy',
    tags: [],
    type: 'single',
    prompt: 'Pick one [P91X]',
    explanation: 'EXPLAIN-91',
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answer: 'a',
  },
];
const INACTIVE = quantQuestion(92, 'brainteasers', 'easy', 'short');
const ALL_FIXTURES = [...ELIGIBLE, ...INELIGIBLE, INACTIVE];
const promptMark = (prompt: string) => /\[P\d+X\]/.exec(prompt)?.[0] ?? prompt;

/** Server-only text that must never reach a browser while the pad is active. */
const ALWAYS_SECRET = [
  'qround',
  'EXPLAIN-',
  'REFERENCE-',
  'KEYPOINT-',
  'HINT-',
  'FOLLOWUP-',
  'ANSWERTEXT-',
  ANSWER_MARK,
  'VERDICT-SUMMARY',
  'LATE-VERDICT',
  'PRIVATE-NOTE',
  '"questionId"',
  '"verdict"',
  '"hintRungs"',
  '"closedBy"',
  '"subtopic"',
  '"posedMessageId"',
  '"nudgedAt"',
  '"hintsAvailable"',
  '"followUpAsked"',
  '"score"',
];

// ---------------------------------------------------------------- harness

let h: Harness;
let fake: FakeInterviewer;
beforeAll(async () => {
  await flushRedis();
  fake = new FakeInterviewer();
  h = await startApi({ fake });
  const db = h.api.ctx.db;
  await db
    .insert(quizTopics)
    .values([...QUANT_TOPICS])
    .onConflictDoNothing();
  for (const raw of ALL_FIXTURES) {
    const q = QuizQuestion.parse(raw);
    await db
      .insert(quizQuestions)
      .values({
        id: q.id,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty,
        type: q.type,
        data: q,
        active: q.id !== INACTIVE.id,
      })
      .onConflictDoNothing();
  }
});
afterAll(async () => {
  // Other test files share the database: take the quant bank away again.
  const db = h?.api.ctx.db;
  if (db) {
    const ids = ALL_FIXTURES.map((q) => q.id);
    await db.delete(quantRoundAnswers).where(inArray(quantRoundAnswers.questionId, ids));
    await db.delete(quizStandaloneAnswers).where(inArray(quizStandaloneAnswers.questionId, ids));
    await db.delete(quizQuestions).where(inArray(quizQuestions.id, ids));
    await db.delete(quizTopics).where(
      inArray(
        quizTopics.slug,
        QUANT_TOPICS.map((t) => t.slug),
      ),
    );
  }
  await h?.stop();
});

const db = () => h.api.ctx.db;
let ipSeq = 0;

async function account(name: string, withKey = true) {
  const c = new Client(h.base, `100.65.${Math.floor(ipSeq / 200)}.${(ipSeq++ % 200) + 1}`);
  const { id } = await c.signUp(name);
  if (withKey) await c.saveKey();
  return Object.assign(c, { userId: id });
}

async function createRound(
  c: Client,
  body: Record<string, unknown> = { path: 'trader', durationMin: 20 },
): Promise<Pad> {
  const res = await c.post('/api/pads/quant', body);
  if (res.status !== 200) throw new Error(`creating the round failed: ${res.status} ${res.text}`);
  return res.json as Pad;
}

async function roundRow(padId: string) {
  const [row] = await db().select().from(quantRounds).where(eq(quantRounds.padId, padId));
  if (!row) throw new Error('no round');
  return row;
}

async function setState(padId: string, edit: (s: QuantRoundState) => void) {
  const row = await roundRow(padId);
  const state = structuredClone(row.state);
  edit(state);
  await db().update(quantRounds).set({ state }).where(eq(quantRounds.padId, padId));
}

async function openEvents(c: Client, padId: string) {
  return EventSocket.open(`${h.wsBase}/ws/pads/${padId}?ticket=${await c.ticket(padId)}`);
}

/** Runs `fn` with the fake's auto start off: the test drives the round itself. */
async function manual<T>(fn: () => Promise<T>): Promise<T> {
  fake.quantAutoStart = false;
  try {
    return await fn();
  } finally {
    fake.quantAutoStart = true;
  }
}

const label = (e: ServerEvent) =>
  e.type === 'message.created'
    ? `${e.message.role}:${e.message.intent ?? 'chat'}`
    : e.type === 'round.updated'
      ? `round:${e.round.version}`
      : e.type;

/** The message and round events a socket got from `mark` up to `round.updated` at `version`. */
async function stepEvents(s: EventSocket, mark: number, version: number) {
  await s.waitFor('round.updated', (e) => e.round.version === version);
  const events = s.events.slice(mark);
  const end = events.findIndex((e) => e.type === 'round.updated' && e.round.version === version);
  return events
    .slice(0, end + 1)
    .filter((e) => e.type === 'message.created' || e.type === 'round.updated');
}

/**
 * Nothing server-only in `texts`: no question id, no answer, explanation, hint or follow-up, no
 * verdict, no private note, and no prompt of a question not yet posed in `padId`'s round.
 */
async function expectNoLeak(padId: string, texts: string[]) {
  const row = await roundRow(padId);
  const posed = new Set(
    row.state.questions.filter((q) => q.posedAt !== null).map((q) => promptMark(q.prompt)),
  );
  const forbidden = [
    ...ALWAYS_SECRET,
    ...ALL_FIXTURES.map((q) => promptMark(q.prompt)).filter((m) => !posed.has(m)),
  ];
  for (const text of texts)
    for (const f of forbidden)
      expect(text.includes(f), `${f} leaked in ${text.slice(0, 300)}`).toBe(false);
}

/** Everything a member can read over HTTP about an active pad. */
async function httpTexts(c: Client, padId: string) {
  const [detail, list, playback, report] = await Promise.all([
    c.get(`/api/pads/${padId}`),
    c.get('/api/pads'),
    c.get(`/api/pads/${padId}/playback`),
    c.get(`/api/pads/${padId}/report`),
  ]);
  expect(detail.status).toBe(200);
  expect(report.status).toBe(409);
  expect(report.json.error.code).toBe('pad_active');
  return [detail.text, list.text, playback.text, report.text];
}

// ---------------------------------------------------------------- creation

describe('creating a quant round', () => {
  it('makes a practice pad of format quant with its round, in one go', async () => {
    const c = await account('Quant');
    const res = await c.post('/api/pads/quant', {
      path: 'trader',
      durationMin: 30,
      interviewer: { style: 'tough', proactivity: 'high', voice: true, enabled: false },
    });
    expect(res.status).toBe(200);
    const pad = res.json as Pad;
    expect(pad).toMatchObject({
      ownerId: c.userId,
      kind: 'practice',
      format: 'quant',
      problemSlug: null,
      language: 'python',
      status: 'active',
      durationMin: 30,
      title: 'Trader quant round',
      interviewer: { enabled: true, style: 'tough', proactivity: 'high', voice: true },
    });
    expect(pad.shareToken).toEqual(expect.any(String));

    const row = await roundRow(pad.id);
    expect(row.version).toBe(0);
    expect(row.state).toMatchObject({ path: 'trader', durationMin: 30, current: -1 });
    expect(row.state.questions.map((q) => q.difficulty)).toEqual([
      'easy',
      'medium',
      'medium',
      'hard',
    ]);
    const eligible = new Map(ELIGIBLE.map((q) => [q.id, q]));
    for (const q of row.state.questions) {
      const bank = eligible.get(q.questionId);
      expect(bank, q.questionId).toBeDefined();
      expect(q.prompt).toBe(bank?.prompt);
      expect(q.hintsAvailable).toBe(2);
      expect(q.unit).toBe(bank && 'unit' in bank ? bank.unit : null);
      expect(q).toMatchObject({ posedAt: null, closedAt: null, verdict: null, hintRungs: [] });
    }
    expect(row.state.questions.some((q) => eligible.get(q.questionId)?.type === 'short')).toBe(
      true,
    );
    expect(row.state.questions.some((q) => eligible.get(q.questionId)?.type === 'numeric')).toBe(
      true,
    );

    const detail = await c.get(`/api/pads/${pad.id}`);
    expect(detail.json.problem).toBeNull();
    expect(detail.json.runs).toEqual([]);
    expect(detail.json.round).toEqual({
      path: 'trader',
      total: 4,
      phase: 'pending',
      questions: [],
      version: 0,
    });
    const list = await c.get('/api/pads');
    expect(list.json.find((p: { id: string }) => p.id === pad.id)).toMatchObject({
      format: 'quant',
      kind: 'practice',
      problemSlug: null,
      problemTitle: null,
    });
    await expectNoLeak(pad.id, [res.text, detail.text, list.text]);

    // The other lengths: 3 and 6 questions; a title of one's own.
    const short = await createRound(c, { path: 'researcher', durationMin: 20, title: ' Mine ' });
    expect(short.title).toBe('Mine');
    expect((await roundRow(short.id)).state.questions).toHaveLength(3);
    const long = await createRound(c, { path: 'trader', durationMin: 45 });
    expect((await roundRow(long.id)).state.questions.map((q) => q.difficulty)).toEqual([
      'easy',
      'medium',
      'medium',
      'medium',
      'hard',
      'hard',
    ]);
  });

  it('never picks a question without interview material, of another type, or inactive', async () => {
    const c = await account('Pool');
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const pad = await createRound(c, { path: 'trader', durationMin: 45 });
      for (const q of (await roundRow(pad.id)).state.questions) seen.add(q.questionId);
    }
    for (const q of [...INELIGIBLE, INACTIVE]) expect(seen.has(q.id)).toBe(false);
  });

  it('refuses without a usable key, a guest, a bad body, and when the pool is too small', async () => {
    const before = (await db().select({ id: pads.id }).from(pads).where(eq(pads.format, 'quant')))
      .length;
    const noKey = await account('NoKey', false);
    const res = await noKey.post('/api/pads/quant', { path: 'trader' });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('ai_key_missing');

    const anon = new Client(h.base);
    expect((await anon.post('/api/pads/quant', { path: 'trader' })).status).toBe(401);

    // A guest (someone who joined a room by its link) may not.
    const host = await account('Host');
    const room = (await host.post('/api/pads', { kind: 'room', blank: true, language: 'python' }))
      .json;
    const guest = new Client(h.base, '100.66.0.1');
    expect(
      (await guest.post('/api/pads/join-guest', { shareToken: room.shareToken, name: 'Gus' }))
        .status,
    ).toBe(200);
    const g = await guest.post('/api/pads/quant', { path: 'trader' });
    expect(g.status).toBe(403);
    expect(g.json.error.code).toBe('account_required');

    const c = await account('Bad');
    for (const body of [
      { path: 'quant' },
      { path: 'trader', durationMin: 25 },
      { path: 'trader', title: 'x'.repeat(121) },
      {},
    ]) {
      const r = await c.post('/api/pads/quant', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }

    // Too few eligible questions for the round's length.
    const keep = ['qround-1', 'qround-2'];
    await db()
      .update(quizQuestions)
      .set({ active: false })
      .where(
        and(
          like(quizQuestions.id, 'qround-%'),
          inArray(
            quizQuestions.id,
            ELIGIBLE.map((q) => q.id).filter((id) => !keep.includes(id)),
          ),
        ),
      );
    try {
      const r = await c.post('/api/pads/quant', { path: 'trader', durationMin: 20 });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('quant_unavailable');
    } finally {
      await db()
        .update(quizQuestions)
        .set({ active: true })
        .where(
          inArray(
            quizQuestions.id,
            ELIGIBLE.map((q) => q.id),
          ),
        );
    }
    const after = (await db().select({ id: pads.id }).from(pads).where(eq(pads.format, 'quant')))
      .length;
    expect(after).toBe(before);
  });

  it('shares the pad-creation limit with coding pads', async () => {
    const limits = h.api.ctx.config.limits;
    const saved = limits.padCreate.userBurst;
    limits.padCreate.userBurst = { limit: 2, windowSec: 60 };
    try {
      const c = await account('Limited');
      expect(
        (await c.post('/api/pads', { problemSlug: 'two-sum', language: 'python' })).status,
      ).toBe(200);
      expect((await c.post('/api/pads/quant', { path: 'trader' })).status).toBe(200);
      const r = await c.post('/api/pads/quant', { path: 'trader' });
      expect(r.status).toBe(429);
    } finally {
      limits.padCreate.userBurst = saved;
    }
  });

  it('does not ask again what the last rounds asked, and asks missed questions first', async () => {
    const c = await account('Again');
    // Questions answered correctly in the question bank come after the rest.
    const strong = ELIGIBLE.filter((q) => q.difficulty === 'easy').map((q) => q.id);
    const missed = ELIGIBLE.filter((q) => q.difficulty !== 'easy').map((q) => q.id);
    await db()
      .insert(quizStandaloneAnswers)
      .values(
        [...strong, ...missed].map((questionId) => ({
          userId: c.userId,
          questionId,
          response: { type: 'short' as const, text: 'x' },
          score: strong.includes(questionId) ? 1 : 0,
          correct: strong.includes(questionId),
          feedback: null,
          gradedBy: 'self' as const,
          needsSelfGrade: false,
        })),
      );
    // There are four easy questions, all answered correctly: an easy slot must take one, but
    // the medium and hard slots never fall back on them.
    const first = await createRound(c, { path: 'trader', durationMin: 45 });
    const s1 = (await roundRow(first.id)).state;
    expect(s1.questions.filter((q) => strong.includes(q.questionId))).toHaveLength(1);

    // Pose its first two questions; the next round leaves them out.
    await manual(async () => {
      const ws = await openEvents(c, first.id);
      await fake.quantStep(first.id, (ctx) => ({
        type: 'start',
        version: ctx.round.version,
        say: null,
      }));
      await fake.quantStep(first.id, (ctx) => ({
        type: 'close',
        version: ctx.round.version,
        index: 0,
        kind: 'chat',
        say: null,
        by: 'interviewer',
        verdict: null,
      }));
      ws.close();
    });
    const posed = (await roundRow(first.id)).state.questions
      .filter((q) => q.posedAt !== null)
      .map((q) => q.questionId);
    expect(posed).toHaveLength(2);
    for (let i = 0; i < 4; i++) {
      const next = await createRound(c, { path: 'trader', durationMin: 45 });
      const ids = (await roundRow(next.id)).state.questions.map((q) => q.questionId);
      for (const id of posed) expect(ids).not.toContain(id);
    }
  });
});

// ---------------------------------------------------------------- the round

describe('a round, step by step', () => {
  it('posts each step’s messages, then the round, to everyone; nothing server-only leaks', async () => {
    const owner = await account('Owner');
    const pad = await createRound(owner, { path: 'trader', durationMin: 20 });
    const collab = await account('Collab', false);
    expect((await collab.post('/api/pads/join', { shareToken: pad.shareToken })).status).toBe(200);
    const id = pad.id;

    await manual(async () => {
      const os = await openEvents(owner, id);
      const cs = await openEvents(collab, id);
      const sockets = [os, cs];
      const leakCheck = async () =>
        expectNoLeak(id, [
          ...os.raw,
          ...cs.raw,
          ...(await httpTexts(owner, id)),
          ...(await httpTexts(collab, id)),
        ]);

      // On connection: the round as it is.
      for (const s of sockets) {
        const e = await s.waitFor('round.updated');
        expect(e.round).toEqual({
          path: 'trader',
          total: 3,
          phase: 'pending',
          questions: [],
          version: 0,
        });
      }
      await leakCheck();

      const marks = () => sockets.map((s) => s.events.length);
      const expectStep = async (m: number[], version: number, labels: string[]) => {
        for (const [i, s] of sockets.entries())
          expect((await stepEvents(s, m[i] ?? 0, version)).map(label)).toEqual(labels);
      };

      // start: the greeting, then question 0, then the round.
      let m = marks();
      const started = await fake.quantStep(id, (ctx) => ({
        type: 'start',
        version: ctx.round.version,
        say: 'Welcome to the round.',
      }));
      expect(started).toMatchObject({ ok: true, version: 1, phase: 'asking', clock: { index: 0 } });
      await expectStep(m, 1, ['interviewer:greeting', 'interviewer:question', 'round:1']);
      let state = (await roundRow(id)).state;
      const q0 = state.questions[0];
      const posedMsg = os.events
        .slice(m[0])
        .find(
          (e): e is Extract<ServerEvent, { type: 'message.created' }> =>
            e.type === 'message.created' && e.message.intent === 'question',
        );
      expect(posedMsg?.message).toMatchObject({
        id: q0?.posedMessageId,
        text: q0?.prompt,
        kind: 'proactive',
        role: 'interviewer',
      });
      const view1 = (await os.waitFor('round.updated', (e) => e.round.version === 1)).round;
      expect(view1.phase).toBe('asking');
      expect(view1.questions).toEqual([
        {
          index: 0,
          topic: q0?.topic,
          difficulty: 'easy',
          prompt: q0?.prompt,
          unit: q0?.unit,
          posedAt: q0?.posedAt,
          budgetSec: q0?.budgetSec,
          closedAt: null,
          hintsGiven: 0,
        },
      ]);
      await leakCheck();

      // A hint (asked by the owner), then the follow-up (asked by the collaborator).
      m = marks();
      os.send({ type: 'chat.send', text: 'hint please' });
      await expectStep(m, 2, ['candidate:chat', 'interviewer:hint', 'round:2']);
      expect(
        (await os.waitFor('round.updated', (e) => e.round.version === 2)).round.questions[0]
          ?.hintsGiven,
      ).toBe(1);
      await leakCheck();
      m = marks();
      cs.send({ type: 'chat.send', text: 'follow up?' });
      await expectStep(m, 3, ['candidate:chat', 'interviewer:probe', 'round:3']);
      await leakCheck();

      // Closing question 0 posts the feedback, then question 1.
      m = marks();
      os.send({ type: 'chat.send', text: 'answer: it is 1/2' });
      await expectStep(m, 4, [
        'candidate:chat',
        'interviewer:feedback',
        'interviewer:question',
        'round:4',
      ]);
      const view4 = (await os.waitFor('round.updated', (e) => e.round.version === 4)).round;
      expect(view4.questions).toHaveLength(2);
      expect(view4.questions[0]?.closedAt).toEqual(expect.any(String));
      expect(view4.questions[1]?.closedAt).toBeNull();
      await leakCheck();

      // The interviewer, asking question 1, sees question 1 in full and nothing of the others.
      const ctx1 = await fake.quantContext(id);
      state = (await roundRow(id)).state;
      expect(ctx1?.questions.map((q) => q.index)).toEqual([1]);
      expect(ctx1?.questions[0]?.question.id).toBe(state.questions[1]?.questionId);
      expect(ctx1?.questions[0]?.question.hints?.length).toBe(2);
      expect(ctx1?.transcript[0]).toMatchObject({
        id: state.questions[1]?.posedMessageId,
        intent: 'question',
      });
      expect(ctx1?.round).toMatchObject({ version: 4, total: 3, phase: 'asking' });
      expect(ctx1?.round.closed).toEqual([
        {
          index: 0,
          topic: q0?.topic,
          difficulty: 'easy',
          hints: 1,
          timeSec: expect.any(Number),
          verdict: { score: 0.8, summary: 'VERDICT-SUMMARY-0' },
          budgetSec: q0?.budgetSec,
          closedBy: 'interviewer',
        },
      ]);
      expect(ctx1?.round.path).toBe('trader');
      expect(ctx1?.privateNotes).toContain('PRIVATE-NOTE-0');
      const ctxText = JSON.stringify(ctx1);
      for (const [i, q] of state.questions.entries()) {
        if (i === 1) continue;
        const k = q.questionId.slice('qround-'.length);
        // Whole JSON strings (qround-1 is a prefix of qround-12).
        for (const secret of [
          `"${q.questionId}"`,
          promptMark(q.prompt),
          `"REFERENCE-${k}"`,
          `"HINT-${k}-A"`,
          `"EXPLAIN-${k}"`,
        ])
          expect(ctxText.includes(secret), `${secret} in the interviewer's context`).toBe(false);
      }

      // Closed without a verdict, then the last question closes the round.
      m = marks();
      cs.send({ type: 'chat.send', text: 'skip this one' });
      await expectStep(m, 5, [
        'candidate:chat',
        'interviewer:feedback',
        'interviewer:question',
        'round:5',
      ]);
      await leakCheck();
      m = marks();
      os.send({ type: 'chat.send', text: 'answer: 42' });
      await expectStep(m, 6, ['candidate:chat', 'interviewer:wrap_up', 'round:6']);
      const view6 = (await os.waitFor('round.updated', (e) => e.round.version === 6)).round;
      expect(view6.phase).toBe('finished');
      expect(view6.questions.every((q) => q.closedAt !== null)).toBe(true);
      await leakCheck();

      // The round finishing does not end the pad.
      expect((await owner.get(`/api/pads/${id}`)).json.pad.status).toBe('active');
      for (const s of sockets) s.close();
    });

    // What was stored: the messages in order, each question after the message before it.
    const rows = await db()
      .select()
      .from(messages)
      .where(eq(messages.padId, id))
      .orderBy(asc(messages.createdAt));
    expect(rows.map((r) => `${r.role}:${r.intent ?? 'chat'}`)).toEqual([
      'interviewer:greeting',
      'interviewer:question',
      'candidate:chat',
      'interviewer:hint',
      'candidate:chat',
      'interviewer:probe',
      'candidate:chat',
      'interviewer:feedback',
      'interviewer:question',
      'candidate:chat',
      'interviewer:feedback',
      'interviewer:question',
      'candidate:chat',
      'interviewer:wrap_up',
    ]);
    const detail = await owner.get(`/api/pads/${id}`);
    expect(detail.json.messages.map((m: { id: string }) => m.id)).toEqual(rows.map((r) => r.id));
    const events = await db()
      .select({ event: timelineEvents.event })
      .from(timelineEvents)
      .where(eq(timelineEvents.padId, id))
      .orderBy(asc(timelineEvents.at));
    expect(events.map((e) => e.event).filter((e) => e.type === 'question')).toEqual([
      { type: 'question', index: 0, total: 3 },
      { type: 'question', index: 1, total: 3 },
      { type: 'question', index: 2, total: 3 },
    ]);
    const notes = await db()
      .select({ note: interviewerNotes.note })
      .from(interviewerNotes)
      .where(eq(interviewerNotes.padId, id));
    expect(notes.map((n) => n.note).sort()).toEqual([
      'PRIVATE-NOTE-0',
      'PRIVATE-NOTE-1',
      'PRIVATE-NOTE-2',
    ]);
    // The interviewer's messages count against the owner's day; the questions do not.
    const [usage] = await db().select().from(aiUsage).where(eq(aiUsage.userId, owner.userId));
    expect(usage?.messages).toBe(6);
    // Nor against the pad's cap on interviewer messages.
    const cap = h.api.ctx.config.limits;
    const saved = cap.interviewerMessagesPerPad;
    cap.interviewerMessagesPerPad = 7;
    try {
      expect(await fake.deps.checkBudget(id)).toEqual({ ok: true });
      cap.interviewerMessagesPerPad = 6;
      expect((await fake.deps.checkBudget(id)).ok).toBe(false);
    } finally {
      cap.interviewerMessagesPerPad = saved;
    }
  });

  it('starts by itself when the first socket opens, once, and a reconnect gets the round', async () => {
    const owner = await account('Reconnect');
    const pad = await createRound(owner);
    const a = await openEvents(owner, pad.id);
    await a.waitFor('round.updated', (e) => e.round.version === 1);
    a.send({ type: 'chat.send', text: 'hint?' });
    await a.waitFor('round.updated', (e) => e.round.version === 2);
    // A new usable key raises session_started again in the open pad: no second start.
    const starts = fake.of('session_started', pad.id).length;
    await owner.saveKey();
    await until(() => fake.of('session_started', pad.id).length > starts);
    await sleep(200);
    a.close();
    const b = await openEvents(owner, pad.id);
    const first = await b.waitFor('round.updated');
    const detail = await owner.get(`/api/pads/${pad.id}`);
    expect(first.round).toEqual(detail.json.round);
    expect(first.round).toMatchObject({ version: 2, phase: 'asking' });
    expect(first.round.questions[0]?.hintsGiven).toBe(1);
    await sleep(300);
    const greetings = detail.json.messages.filter(
      (m: { intent: string }) => m.intent === 'greeting',
    );
    expect(greetings).toHaveLength(1);
    expect((await roundRow(pad.id)).version).toBe(2);
    await expectNoLeak(pad.id, [...a.raw, ...b.raw, detail.text]);
    b.close();
  });

  it('refuses stale, duplicate and illegal steps, posting nothing', async () => {
    const owner = await account('Stale');
    const pad = await createRound(owner);
    const id = pad.id;
    await manual(async () => {
      const s = await openEvents(owner, id);
      await s.waitFor('round.updated');
      const apply = (step: QuantStep) => fake.deps.applyQuantStep?.(id, step);
      const count = async () =>
        (await db().select({ id: messages.id }).from(messages).where(eq(messages.padId, id)))
          .length;

      // Two starts decided on the same version at once: one wins, the other posts nothing.
      const both = await Promise.all([
        apply({ type: 'start', version: 0, say: 'Hello A' }),
        apply({ type: 'start', version: 0, say: 'Hello B' }),
      ]);
      expect(both.filter((r) => r?.ok)).toHaveLength(1);
      expect(both.find((r) => !r?.ok)).toEqual({
        ok: false,
        reason: expect.stringMatching(/^(stale|wrong_phase)$/),
      });
      expect(await count()).toBe(2);
      // A start again, on the new version or the old one.
      expect(await apply({ type: 'start', version: 1, say: 'Hi' })).toEqual({
        ok: false,
        reason: 'wrong_phase',
      });
      expect(await apply({ type: 'start', version: 0, say: 'Hi' })).toEqual({
        ok: false,
        reason: 'stale',
      });

      const mark = s.events.length;
      const turn = (over: Partial<Extract<QuantStep, { type: 'turn' }>>): QuantStep => ({
        type: 'turn',
        version: 1,
        index: 0,
        kind: 'chat',
        say: 'Hmm.',
        action: 'stay',
        ...over,
      });
      expect(await apply(turn({ version: 0 }))).toEqual({ ok: false, reason: 'stale' });
      expect(await apply(turn({ index: 1 }))).toEqual({ ok: false, reason: 'wrong_index' });
      expect(await apply(turn({ action: 'hint', hintRung: 2 }))).toEqual({
        ok: false,
        reason: 'hint_rung',
      });
      expect(await apply(turn({ action: 'hint' }))).toEqual({ ok: false, reason: 'hint_rung' });
      expect(
        await apply({ type: 'verdict', version: 1, index: 0, verdict: { score: 1, summary: 'x' } }),
      ).toEqual({ ok: false, reason: 'not_closed' });
      expect(
        await apply({
          type: 'close',
          version: 1,
          index: 0,
          kind: 'proactive',
          say: 'Time.',
          by: 'timeout',
          verdict: null,
        }),
      ).toEqual({ ok: false, reason: 'too_early' });
      expect(await count()).toBe(2);
      await sleep(200);
      expect(s.events.length).toBe(mark);
      expect((await roundRow(id)).version).toBe(1);

      // Two turns on one version at once: only the winner's message is posted.
      const turns = await Promise.all([
        apply(turn({ say: 'Turn A' })),
        apply(turn({ say: 'Turn B' })),
      ]);
      expect(turns.filter((r) => r?.ok)).toHaveLength(1);
      expect(turns.find((r) => !r?.ok)).toEqual({ ok: false, reason: 'stale' });
      expect(await count()).toBe(3);

      // Once-only books: the nudge and the follow-up; authored hints in order, own words any time.
      expect(
        await apply(turn({ version: 2, nudge: true, kind: 'proactive', say: 'Budget is up.' })),
      ).toMatchObject({ ok: true, version: 3 });
      expect(await apply(turn({ version: 3, nudge: true, kind: 'proactive' }))).toEqual({
        ok: false,
        reason: 'nudged',
      });
      expect(await apply(turn({ version: 3, action: 'follow_up', say: null }))).toMatchObject({
        ok: true,
        version: 4,
      });
      expect(await apply(turn({ version: 4, action: 'follow_up' }))).toEqual({
        ok: false,
        reason: 'follow_up_used',
      });
      expect(await apply(turn({ version: 4, action: 'hint', hintRung: 1 }))).toMatchObject({
        ok: true,
      });
      expect(await apply(turn({ version: 5, action: 'hint', hintRung: 1 }))).toEqual({
        ok: false,
        reason: 'hint_rung',
      });
      expect(await apply(turn({ version: 5, action: 'hint', hintRung: 0 }))).toMatchObject({
        ok: true,
      });
      expect(await apply(turn({ version: 6, action: 'hint', hintRung: 2 }))).toMatchObject({
        ok: true,
      });
      expect(await apply(turn({ version: 7, action: 'hint', hintRung: 3 }))).toEqual({
        ok: false,
        reason: 'hint_rung',
      });
      const state = (await roundRow(id)).state;
      expect(state.questions[0]).toMatchObject({ hintRungs: [1, 0, 2], followUpAsked: true });
      expect(state.questions[0]?.nudgedAt).toEqual(expect.any(String));
      const intents = (
        await db()
          .select()
          .from(messages)
          .where(eq(messages.padId, id))
          .orderBy(asc(messages.createdAt))
      ).map((r) => r.intent);
      // The follow-up said nothing (`say: null`), so it posted nothing.
      expect(intents).toEqual([
        'greeting',
        'question',
        'answer',
        'time_check',
        'hint',
        'hint',
        'hint',
      ]);
      // Every accepted step told the room, even one that said nothing.
      const view = (await s.waitFor('round.updated', (e) => e.round.version === 7)).round;
      expect(view.questions[0]?.hintsGiven).toBe(3);
      await expectNoLeak(id, s.raw);
      s.close();
    });
  });

  it('closes a question for time only after its budget, and finishes on the round’s clock without ending the pad', async () => {
    const owner = await account('Clock');
    const pad = await createRound(owner, { path: 'trader', durationMin: 20 });
    const id = pad.id;
    await manual(async () => {
      const s = await openEvents(owner, id);
      await s.waitFor('round.updated');
      const apply = (step: QuantStep) => fake.deps.applyQuantStep?.(id, step);
      const r1 = await apply({ type: 'start', version: 0, say: 'Hi.' });
      expect(r1).toMatchObject({ ok: true, version: 1 });
      if (!r1?.ok || !r1.clock) throw new Error('no clock');
      // 20 minutes, 3 questions: (20·60 − 60) / 3 = 380 s less the seconds since the pad
      // began, a quarter of it (at most 90 s) as grace.
      expect(r1.clock.budgetMs).toBeGreaterThan(370_000);
      expect(r1.clock.budgetMs).toBeLessThanOrEqual(380_000);
      expect(r1.clock.graceMs).toBe(90_000);
      expect(r1.clock.roundEndsAt).toBe(Date.parse(pad.startedAt) + 20 * 60_000);
      const timeout: QuantStep = {
        type: 'close',
        version: 1,
        index: 0,
        kind: 'proactive',
        say: 'Let us move on.',
        by: 'timeout',
        verdict: null,
      };
      expect(await apply(timeout)).toEqual({ ok: false, reason: 'too_early' });
      // Seven minutes later (the question was posed earlier than it was).
      await setState(id, (st) => {
        const q = st.questions[0];
        if (q?.posedAt) q.posedAt = new Date(Date.parse(q.posedAt) - 7 * 60_000).toISOString();
      });
      const mark = s.events.length;
      expect(await apply(timeout)).toMatchObject({
        ok: true,
        version: 2,
        phase: 'asking',
        clock: { index: 1 },
      });
      expect((await stepEvents(s, mark, 2)).map(label)).toEqual([
        'interviewer:feedback',
        'interviewer:question',
        'round:2',
      ]);
      expect((await roundRow(id)).state.questions[0]).toMatchObject({
        closedBy: 'timeout',
        verdict: null,
      });

      const roundTime: QuantStep = {
        ...timeout,
        version: 2,
        index: 1,
        by: 'round_time',
        say: 'Time is up.',
      };
      expect(await apply(roundTime)).toEqual({ ok: false, reason: 'too_early' });
      // The pad began 21 minutes ago: the round's clock has run out.
      await db()
        .update(pads)
        .set({ startedAt: new Date(Date.now() - 21 * 60_000) })
        .where(eq(pads.id, id));
      const mark2 = s.events.length;
      expect(await apply(roundTime)).toEqual({
        ok: true,
        version: 3,
        phase: 'finished',
        clock: null,
      });
      expect((await stepEvents(s, mark2, 3)).map(label)).toEqual([
        'interviewer:wrap_up',
        'round:3',
      ]);
      const state = (await roundRow(id)).state;
      expect(state.questions.map((q) => q.closedBy)).toEqual(['timeout', 'round_time', null]);
      expect(state.questions[2]?.posedAt).toBeNull();
      // Finished, so nothing else moves it, but the pad stays open until its owner ends it.
      expect(await apply({ ...timeout, version: 3, index: 2 })).toEqual({
        ok: false,
        reason: 'ended',
      });
      const detail = await owner.get(`/api/pads/${id}`);
      expect(detail.json.pad.status).toBe('active');
      expect(detail.json.round.phase).toBe('finished');
      expect((await owner.get(`/api/pads/${id}/report`)).status).toBe(409);
      await expectNoLeak(id, [...s.raw, detail.text]);
      s.close();
    });
  });
});

// ---------------------------------------------------------------- ending and the report

describe('ending a quant pad', () => {
  it('finishes the round mid-question; the report has every question, its answer and verdict', async () => {
    const owner = await account('Ender');
    const pad = await createRound(owner, { path: 'trader', durationMin: 20 });
    const collab = await account('Watcher', false);
    expect((await collab.post('/api/pads/join', { shareToken: pad.shareToken })).status).toBe(200);
    const id = pad.id;
    const s = await openEvents(owner, id);
    await s.waitFor('round.updated', (e) => e.round.version === 1);
    s.send({ type: 'chat.send', text: 'hint' });
    await s.waitFor('round.updated', (e) => e.round.version === 2);
    s.send({ type: 'chat.send', text: 'skip' });
    await s.waitFor('round.updated', (e) => e.round.version === 3);
    await expectNoLeak(id, [...s.raw, ...(await httpTexts(collab, id))]);

    // Without a key the assessment cannot run: the verdicts stay as they are.
    expect((await owner.del('/api/ai-key')).status).toBe(200);
    const mark = s.events.length;
    const ended = await owner.post(`/api/pads/${id}/end`);
    expect(ended.status).toBe(200);
    expect(ended.json.status).toBe('ended');
    const finished = await s.waitFor('round.updated', (e) => e.round.version === 4);
    expect(finished.round.phase).toBe('finished');
    const order = s.events.slice(mark).map(label);
    expect(order.indexOf('pad.updated')).toBeLessThan(order.indexOf('round:4'));
    let state = (await roundRow(id)).state;
    expect(state.questions.map((q) => q.closedBy)).toEqual(['interviewer', 'ended', null]);
    expect(state.questions[2]?.posedAt).toBeNull();
    await until(async () => fake.of('session_ended', id).length === 1);

    // Ending again changes nothing; nor do the interviewer's steps.
    expect((await owner.post(`/api/pads/${id}/end`)).status).toBe(200);
    await finishRound(h.api.ctx, id);
    expect(
      await fake.deps.applyQuantStep?.(id, {
        type: 'turn',
        version: 4,
        index: 1,
        kind: 'chat',
        say: 'Late.',
        action: 'stay',
      }),
    ).toEqual({ ok: false, reason: 'ended' });
    expect((await roundRow(id)).version).toBe(4);

    await until(async () => (await owner.get(`/api/pads/${id}/report`)).json?.status !== 'pending');
    let report = await owner.get(`/api/pads/${id}/report`);
    expect(report.status).toBe(200);
    expect(report.json.assessment).toBeNull();
    expect(report.json.assessmentUnavailable).toBe('no_key');
    const bank = new Map(ALL_FIXTURES.map((q) => [q.id, QuizQuestion.parse(q)]));
    const review = (index: number) => {
      const q = state.questions[index];
      const b = q ? bank.get(q.questionId) : undefined;
      if (!q || !b || (b.type !== 'short' && b.type !== 'numeric')) throw new Error('fixture');
      return {
        index,
        questionId: q.questionId,
        topic: q.topic,
        subtopic: b.subtopic,
        difficulty: q.difficulty,
        type: b.type,
        prompt: b.prompt,
        unit: q.unit,
        solution: b.type === 'short' ? b.reference : (b.answerText ?? b.answer),
        keyPoints: b.type === 'short' ? b.keyPoints : [],
        explanation: b.explanation,
        hintsAvailable: 2,
      };
    };
    expect(report.json.quant.path).toBe('trader');
    expect(report.json.quant.questions).toEqual([
      {
        ...review(0),
        status: 'answered',
        verdict: null,
        hintsGiven: 1,
        timeSec: expect.any(Number),
        budgetSec: expect.any(Number),
      },
      {
        ...review(1),
        status: 'unfinished',
        verdict: null,
        hintsGiven: 0,
        timeSec: expect.any(Number),
        budgetSec: expect.any(Number),
      },
      {
        ...review(2),
        status: 'not_reached',
        verdict: null,
        hintsGiven: 0,
        timeSec: null,
        budgetSec: null,
      },
    ]);
    // Hints and follow-ups never leave the server, not even in the report.
    expect(report.text).not.toContain('HINT-');
    expect(report.text).not.toContain('FOLLOWUP-');
    // A collaborator of a practice pad reads it too.
    const theirs = await collab.get(`/api/pads/${id}/report`);
    expect(theirs.status).toBe(200);
    expect(theirs.json.quant).toEqual(report.json.quant);

    // With a key again the owner asks for the assessment: it judges the two closed questions.
    await owner.saveKey();
    const again = await owner.post(`/api/pads/${id}/report/assessment`);
    expect(again.status).toBe(200);
    await until(async () => (await owner.get(`/api/pads/${id}/report`)).json?.status === 'ready');
    report = await owner.get(`/api/pads/${id}/report`);
    expect(report.json.assessment).toEqual(fake.quantAssessment);
    expect(report.json.quant.questions.map((q: { verdict: unknown }) => q.verdict)).toEqual([
      { score: 0.25, summary: 'LATE-VERDICT-0' },
      { score: 0.25, summary: 'LATE-VERDICT-1' },
      null,
    ]);
    state = (await roundRow(id)).state;
    expect(state.questions[1]?.verdict?.summary).toBe('LATE-VERDICT-1');
    // The assessment saw every posed question, and none that was not.
    const all = fake.quantContexts.filter((c) => c.pad.id === id).at(-1);
    expect(all?.questions.map((q) => q.index)).toEqual([0, 1]);
    s.close();
  });

  it('assesses with the verdicts the interviewer gave while the pad was live', async () => {
    const owner = await account('Assessed');
    const pad = await createRound(owner, { path: 'researcher', durationMin: 20 });
    const s = await openEvents(owner, pad.id);
    await s.waitFor('round.updated', (e) => e.round.version === 1);
    s.send({ type: 'chat.send', text: 'answer' });
    await s.waitFor('round.updated', (e) => e.round.version === 2);
    expect((await owner.post(`/api/pads/${pad.id}/end`)).status).toBe(200);
    await until(
      async () => (await owner.get(`/api/pads/${pad.id}/report`)).json?.status === 'ready',
    );
    const report = await owner.get(`/api/pads/${pad.id}/report`);
    expect(report.json.assessment).toEqual(fake.quantAssessment);
    expect(report.json.quant.path).toBe('researcher');
    expect(report.json.quant.questions.map((q: { status: string }) => q.status)).toEqual([
      'answered',
      'unfinished',
      'not_reached',
    ]);
    expect(report.json.quant.questions.map((q: { verdict: unknown }) => q.verdict)).toEqual([
      { score: 0.8, summary: 'VERDICT-SUMMARY-0' },
      { score: 0.25, summary: 'LATE-VERDICT-1' },
      null,
    ]);
    s.close();
  });
});

// ---------------------------------------------------------------- the round in the quiz

describe('a round’s answers in the quiz', () => {
  it('counts each judged question as the owner’s AI-graded answer once the pad has ended, once', async () => {
    const owner = await account('Counted');
    const pad = await createRound(owner, { path: 'trader', durationMin: 30 });
    const collab = await account('Onlooker', false);
    expect((await collab.post('/api/pads/join', { shareToken: pad.shareToken })).status).toBe(200);
    const id = pad.id;
    const ids = (await roundRow(id)).state.questions.map((q) => q.questionId);
    expect(ids).toHaveLength(4);
    const [q0, q1, q2, q3] = ids as [string, string, string, string];
    const topicOf = (qid: string) => ELIGIBLE.find((q) => q.id === qid)?.topic ?? '';
    const bankItem = async (c: Client, qid: string) =>
      (await c.get(`/api/quiz/topics/${topicOf(qid)}/questions`)).json.items.find(
        (i: { question: { id: string } }) => i.question.id === qid,
      );
    const answered = async (c: Client) =>
      Object.fromEntries(
        ((await c.get('/api/quiz/topics')).json as { slug: string; answered: number }[]).map(
          (t) => [t.slug, t.answered],
        ),
      );
    const before = await answered(owner);
    // An old bank answer to the second question: the round's, given later, wins over it.
    await db()
      .insert(quizStandaloneAnswers)
      .values({
        userId: owner.userId,
        questionId: q1,
        response: { type: 'short', text: 'long ago' },
        score: 0,
        correct: false,
        feedback: null,
        gradedBy: 'self',
        needsSelfGrade: false,
        answeredAt: new Date(Date.now() - 3600_000),
      });

    const s = await openEvents(owner, id);
    const theirs = await openEvents(collab, id);
    await s.waitFor('round.updated', (e) => e.round.version === 1);
    s.send({ type: 'chat.send', text: 'I think it is 42' });
    await s.waitFor('round.updated', (e) => e.round.version === 2);
    theirs.send({ type: 'chat.send', text: 'COLLABORATOR-WORDS' });
    await s.waitFor('round.updated', (e) => e.round.version === 3);
    s.send({ type: 'chat.send', text: 'answer: 42' });
    await s.waitFor('round.updated', (e) => e.round.version === 4);
    s.send({ type: 'chat.send', text: 'skip this one' });
    await s.waitFor('round.updated', (e) => e.round.version === 5);
    expect((await roundRow(id)).state.questions.map((q) => q.closedBy)).toEqual([
      'interviewer',
      'interviewer',
      null,
      null,
    ]);

    // Mid-round the verdict is nowhere in the quiz: not in the bank, the stats or the table.
    expect(
      await db().select().from(quantRoundAnswers).where(eq(quantRoundAnswers.padId, id)),
    ).toEqual([]);
    for (const c of [owner, collab]) {
      const one = await c.get(`/api/quiz/questions/${q0}`);
      expect(one.json).toMatchObject({ status: 'unanswered', response: null, feedback: null });
      expect((await bankItem(c, q0)).status).toBe('unanswered');
    }
    expect(await answered(owner)).toEqual({
      ...before,
      [topicOf(q1)]: (before[topicOf(q1)] ?? 0) + 1,
    });

    // Ended without a key: no assessment, so only the verdict given live is recorded, at once.
    expect((await owner.del('/api/ai-key')).status).toBe(200);
    expect((await owner.post(`/api/pads/${id}/end`)).status).toBe(200);
    await s.waitFor('round.updated', (e) => e.round.phase === 'finished');
    const rows = () =>
      db()
        .select()
        .from(quantRoundAnswers)
        .where(eq(quantRoundAnswers.userId, owner.userId))
        .orderBy(asc(quantRoundAnswers.answeredAt));
    const state = (await roundRow(id)).state;
    expect(await rows()).toEqual([
      {
        id: expect.any(String),
        userId: owner.userId,
        padId: id,
        questionId: q0,
        // What the owner said while it was open; a collaborator's words are not their answer.
        response: { type: 'short', text: 'I think it is 42\n\nanswer: 42' },
        score: 0.8,
        correct: true,
        feedback: 'VERDICT-SUMMARY-0',
        gradedBy: 'ai',
        needsSelfGrade: false,
        answeredAt: new Date(state.questions[0]?.closedAt ?? ''),
      },
    ]);
    const one = await owner.get(`/api/quiz/questions/${q0}`);
    expect(one.json).toMatchObject({
      status: 'correct',
      score: 0.8,
      response: { type: 'short', text: 'I think it is 42\n\nanswer: 42' },
      feedback: { gradedBy: 'ai', feedback: 'VERDICT-SUMMARY-0', score: 0.8 },
    });
    // Only the owner's: the collaborator's bank knows nothing of it.
    expect((await collab.get(`/api/quiz/questions/${q0}`)).json.status).toBe('unanswered');
    // Ending again finds nothing new to write.
    await finishRound(h.api.ctx, id);
    expect(await rows()).toHaveLength(1);

    // The assessment judges the two closed without a verdict (the one skipped, the one open at
    // the end); each is recorded as it is judged, and the question never posed is not.
    await owner.saveKey();
    expect((await owner.post(`/api/pads/${id}/report/assessment`)).status).toBe(200);
    await until(async () => (await owner.get(`/api/pads/${id}/report`)).json?.status === 'ready');
    const recorded = await rows();
    expect(recorded.map((r) => [r.questionId, r.score, r.feedback])).toEqual([
      [q0, 0.8, 'VERDICT-SUMMARY-0'],
      [q1, 0.25, 'LATE-VERDICT-1'],
      [q2, 0.25, 'LATE-VERDICT-2'],
    ]);
    expect(recorded.map((r) => r.response)).toEqual([
      { type: 'short', text: 'I think it is 42\n\nanswer: 42' },
      { type: 'short', text: 'skip this one' },
      { type: 'short', text: '' },
    ]);
    expect(recorded.some((r) => r.questionId === q3)).toBe(false);
    // Later than the old bank answer, so it is the latest.
    expect(await bankItem(owner, q1)).toMatchObject({ status: 'partial', score: 0.25 });

    // A second assessment changes nothing.
    expect((await owner.post(`/api/pads/${id}/report/assessment`)).status).toBe(200);
    await until(async () => (await owner.get(`/api/pads/${id}/report`)).json?.status === 'ready');
    expect(await rows()).toEqual(recorded);

    // A later bank answer wins in turn.
    const later = await owner.post(`/api/quiz/questions/${q0}/answers`, {
      response:
        ELIGIBLE.find((q) => q.id === q0)?.type === 'numeric'
          ? { type: 'numeric', value: '1' }
          : { type: 'short', text: 'not sure', selfGrade: 0 },
    });
    expect(later.status).toBe(200);
    const after = await owner.get(`/api/quiz/questions/${q0}`);
    expect(after.json.feedback.feedback).not.toBe('VERDICT-SUMMARY-0');

    // Deleting the pad keeps the answers, as for any quiz answer.
    expect((await owner.del(`/api/pads/${id}`)).status).toBe(200);
    const kept = await rows();
    expect(kept.map((r) => [r.questionId, r.padId])).toEqual([
      [q0, null],
      [q1, null],
      [q2, null],
    ]);
    expect(await bankItem(owner, q2)).toMatchObject({ status: 'partial', score: 0.25 });
    s.close();
    theirs.close();
  });

  it('records the answers of a round that finished before its pad ended', async () => {
    const owner = await account('Finisher');
    const pad = await createRound(owner, { path: 'researcher', durationMin: 20 });
    const s = await openEvents(owner, pad.id);
    await s.waitFor('round.updated', (e) => e.round.version === 1);
    for (const [i, text] of ['answer one', 'answer two', 'answer three'].entries()) {
      s.send({ type: 'chat.send', text });
      await s.waitFor('round.updated', (e) => e.round.version === i + 2);
    }
    expect((await roundRow(pad.id)).state.current).toBe(3);
    expect(
      await db().select().from(quantRoundAnswers).where(eq(quantRoundAnswers.padId, pad.id)),
    ).toEqual([]);
    expect((await owner.del('/api/ai-key')).status).toBe(200);
    expect((await owner.post(`/api/pads/${pad.id}/end`)).status).toBe(200);
    // Ending changed nothing in the finished round, but its three answers now count.
    expect((await roundRow(pad.id)).version).toBe(4);
    const rows = await db()
      .select()
      .from(quantRoundAnswers)
      .where(eq(quantRoundAnswers.padId, pad.id))
      .orderBy(asc(quantRoundAnswers.answeredAt));
    expect(rows.map((r) => [r.feedback, (r.response as { text: string }).text])).toEqual([
      ['VERDICT-SUMMARY-0', 'answer one'],
      ['VERDICT-SUMMARY-1', 'answer two'],
      ['VERDICT-SUMMARY-2', 'answer three'],
    ]);
    s.close();
  });
});

// ---------------------------------------------------------------- what a quant pad refuses

describe('what a quant pad does not have', () => {
  it('refuses runs, a language, a problem and the room endpoints; keeps the interviewer on', async () => {
    const owner = await account('Refuse');
    const pad = await createRound(owner);
    const collab = await account('Refuse2', false);
    expect((await collab.post('/api/pads/join', { shareToken: pad.shareToken })).status).toBe(200);
    const id = pad.id;
    const run = { mode: 'file', language: 'python', source: 'print(1)' };
    for (const c of [owner, collab]) {
      const r = await c.post(`/api/pads/${id}/runs`, run);
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('wrong_format');
    }
    for (const language of ['python', 'cpp']) {
      const r = await owner.patch(`/api/pads/${id}`, { language, title: 'Not changed' });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('wrong_format');
    }
    let detail = await owner.get(`/api/pads/${id}`);
    expect(detail.json.pad.title).toBe('Trader quant round');
    const off = await owner.patch(`/api/pads/${id}`, {
      title: 'Renamed',
      interviewer: { enabled: false, style: 'supportive' },
    });
    expect(off.status).toBe(200);
    expect(off.json.title).toBe('Renamed');
    expect(off.json.interviewer).toMatchObject({ enabled: true, style: 'supportive' });

    for (const [method, path, body] of [
      ['POST', `/api/pads/${id}/problem`, { problemSlug: 'two-sum' }],
      ['GET', `/api/pads/${id}/host`, undefined],
      ['PUT', `/api/pads/${id}/host/notes`, { notes: 'x' }],
      ['POST', `/api/pads/${id}/review`, {}],
    ] as const) {
      const r = await owner.req(method, path, body);
      expect(r.status, path).toBe(403);
    }
    const assess = await owner.post(`/api/pads/${id}/report/assessment`);
    expect(assess.status).toBe(409);
    expect(assess.json.error.code).toBe('pad_active');

    // Over the event channel: no language; a paste is not even recorded, leaving the tab is.
    const s = await openEvents(collab, id);
    await s.waitFor('round.updated');
    s.send({ type: 'language', language: 'cpp' });
    const err = await s.waitFor('error');
    expect(err.code).toBe('wrong_format');
    s.send({ type: 'telemetry', kind: 'paste', chars: 500 });
    s.send({ type: 'telemetry', kind: 'blur', ms: 4000 });
    s.send({ type: 'ping' });
    await s.waitFor('pong');
    await until(async () => {
      const rows = await db()
        .select({ event: timelineEvents.event })
        .from(timelineEvents)
        .where(eq(timelineEvents.padId, id));
      return rows.some((r) => r.event.type === 'blur');
    });
    await sleep(200);
    const rows = await db()
      .select({ event: timelineEvents.event })
      .from(timelineEvents)
      .where(eq(timelineEvents.padId, id));
    expect(rows.map((r) => r.event.type)).not.toContain('paste');
    expect(rows.map((r) => r.event.type)).not.toContain('language');
    expect(fake.of('telemetry', id)).toEqual([]);
    expect(fake.of('language_changed', id)).toEqual([]);
    detail = await owner.get(`/api/pads/${id}`);
    expect(detail.json.pad.language).toBe('python');
    s.close();
  });

  it('seeds an empty scratchpad and no code; its changes reach the interviewer as scratch_changed', async () => {
    const owner = await account('Scratch');
    const pad = await createRound(owner);
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({
      url: `${h.wsBase}/collab`,
      WebSocketPolyfill: WebSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: YDOC.name(pad.id),
      document: doc,
      token: () => owner.ticket(pad.id),
    });
    provider.attach();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('collab sync timed out')), 10_000);
      provider.on('synced', () => {
        clearTimeout(t);
        resolve();
      });
    });
    try {
      for (const lang of LANGUAGES) expect(doc.getText(YDOC.code(lang)).toString()).toBe('');
      expect(doc.getText(YDOC.notes).toString()).toBe('');
      doc.getText(YDOC.notes).insert(0, `P(A) = 1/2${'.'.repeat(QUANT_SCRATCH_CHARS)}END`);
      await until(() => fake.of('scratch_changed', pad.id).length > 0);
      expect(fake.of('code_changed', pad.id)).toEqual([]);
      const ctx = await fake.quantContext(pad.id);
      expect(ctx?.scratch.startsWith('P(A) = 1/2')).toBe(true);
      expect(ctx?.scratch.endsWith('END')).toBe(true);
      expect(ctx?.scratch.length).toBeLessThan(QUANT_SCRATCH_CHARS + 100);
    } finally {
      provider.destroy();
      socket.destroy();
    }
  });

  it('maps the interviewer’s triggers for a quant pad', () => {
    expect(quantTrigger({ type: 'code_changed' })).toEqual({ type: 'scratch_changed' });
    expect(quantTrigger({ type: 'telemetry', kind: 'paste', chars: 3 })).toBeNull();
    expect(quantTrigger({ type: 'telemetry', kind: 'blur', ms: 3 })).toBeNull();
    expect(quantTrigger({ type: 'language_changed', language: 'cpp' })).toBeNull();
    for (const t of [
      { type: 'session_started' },
      { type: 'tick' },
      { type: 'session_ended' },
      { type: 'candidate_message', text: 'hi', via: 'text', userId: 'u' },
    ] as const)
      expect(quantTrigger(t)).toEqual(t);
  });

  it('leaves coding pads as they were', async () => {
    const c = await account('Coder');
    const pad = (await c.post('/api/pads', { problemSlug: 'two-sum', language: 'python' })).json;
    expect(pad.format).toBe('coding');
    const detail = await c.get(`/api/pads/${pad.id}`);
    expect(detail.json.round).toBeNull();
    expect(await fake.deps.loadQuantContext?.(pad.id)).toBeNull();
    const s = await openEvents(c, pad.id);
    s.send({ type: 'ping' });
    await s.waitFor('pong');
    await sleep(100);
    expect(s.events.some((e) => e.type === 'round.updated')).toBe(false);
    s.close();
    expect((await c.post(`/api/pads/${pad.id}/end`)).status).toBe(200);
    await until(async () => (await c.get(`/api/pads/${pad.id}/report`)).json?.status === 'ready');
    expect((await c.get(`/api/pads/${pad.id}/report`)).json.quant).toBeNull();
  });
});
