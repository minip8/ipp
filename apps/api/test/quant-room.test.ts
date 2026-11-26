/**
 * Quant rooms (ARCHITECTURE §8.4): a room of format `quant`, whose host poses questions of the
 * bank (any topic, any type), records hints and follow-ups, judges each answer, searches the
 * bank with the solutions shown, and asks the AI for advice; the candidate, a guest or an
 * account, sees only what was posed. Against the real database, Redis and sockets, with the
 * model scripted (`FakeInterviewer`).
 */
import {
  HostBankPage,
  HostRoundView,
  HostView,
  PadDetail,
  Playback,
  QuantRoundView,
  QuantSecondOpinion,
  QuizQuestion,
  Report,
  type ServerEvent,
} from '@ipp/contracts';
import {
  padMembers,
  pads,
  quantRoundAnswers,
  quantRounds,
  quizQuestions,
  quizStandaloneAnswers,
  quizTopics,
} from '@ipp/db';
import { eq, inArray } from '@ipp/db/orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config';
import { recentlyPosed } from '../src/quant/assemble';
import { QUANT_INTERVIEW_GUARD_HOURS } from '../src/quant/guard';
import { sweepQuantRounds } from '../src/quant/sweeper';
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

// ---------------------------------------------------------------- the bank

const TOPICS = [
  { slug: 'roomprob', title: 'Room probability', description: 'quant room tests', track: 'quant' },
  {
    slug: 'roomfund',
    title: 'Room fundamentals',
    description: 'quant room tests',
    track: 'fundamentals',
  },
] as const;

/**
 * Every server-only text carries a marker, so a leak is a substring search. Question ids all
 * contain `qroom`, which nothing a candidate may see does; a prompt's own marker is `[R<k>X]`.
 */
const ANSWER_MARK = '0.000314159';
const FIXTURES = [
  {
    id: 'qroom-1',
    topic: 'roomprob',
    subtopic: 'dice',
    difficulty: 'easy',
    tags: [],
    type: 'short',
    prompt: 'Why is a fair die fair? [R1X]',
    explanation: 'EXPLAIN-1',
    reference: 'REFERENCE-1',
    keyPoints: ['KEYPOINT-1'],
    hints: ['HINT-1-A', 'HINT-1-B'],
    followUps: ['FOLLOWUP-1'],
  },
  {
    id: 'qroom-2',
    topic: 'roomprob',
    subtopic: 'expectation',
    difficulty: 'medium',
    tags: [],
    type: 'numeric',
    prompt: 'Expected value of the thing? [R2X]',
    explanation: 'EXPLAIN-2',
    answer: ANSWER_MARK,
    answerText: 'ANSWERTEXT-2',
    unit: 'dollars',
    hints: ['HINT-2-A'],
    followUps: ['FOLLOWUP-2'],
  },
  {
    id: 'qroom-3',
    topic: 'roomfund',
    subtopic: 'memory',
    difficulty: 'easy',
    tags: [],
    type: 'single',
    prompt: 'Which is on the stack? [R3X]',
    explanation: 'EXPLAIN-3',
    choices: [
      { id: 'a', text: 'Choice alpha' },
      { id: 'b', text: 'Choice beta' },
    ],
    answer: 'b',
  },
  {
    id: 'qroom-4',
    topic: 'roomfund',
    subtopic: 'memory',
    difficulty: 'hard',
    tags: [],
    type: 'multiple',
    prompt: 'Which are owning pointers? [R4X]',
    explanation: 'EXPLAIN-4',
    choices: [
      { id: 'a', text: 'unique' },
      { id: 'b', text: 'raw' },
      { id: 'c', text: 'shared' },
    ],
    answer: ['a', 'c'],
  },
  {
    id: 'qroom-5',
    topic: 'roomfund',
    subtopic: 'printing',
    difficulty: 'medium',
    tags: [],
    type: 'output',
    language: 'python',
    standard: 'Python 3.12',
    prompt: 'What does this print? [R5X]',
    explanation: 'EXPLAIN-5',
    code: 'print("CODE-5")',
    answer: { kind: 'output', output: 'OUTPUT-SECRET-5' },
  },
  {
    id: 'qroom-6',
    topic: 'roomprob',
    subtopic: 'dice',
    difficulty: 'hard',
    tags: [],
    type: 'short',
    prompt: 'Queued and never posed [R6X]',
    explanation: 'EXPLAIN-6',
    reference: 'REFERENCE-6',
    keyPoints: ['KEYPOINT-6'],
    hints: ['HINT-6-A'],
  },
  {
    id: 'qroom-7',
    topic: 'roomprob',
    subtopic: 'dice',
    difficulty: 'easy',
    tags: [],
    type: 'short',
    prompt: 'Inactive [R7X]',
    explanation: 'EXPLAIN-7',
    reference: 'REFERENCE-7',
    keyPoints: ['KEYPOINT-7'],
  },
];
const INACTIVE = 'qroom-7';
const IDS = FIXTURES.map((q) => q.id);

/** Server-only text no candidate payload may contain while the room is active. */
const SECRETS = [
  'qroom',
  'EXPLAIN-',
  'REFERENCE-',
  'KEYPOINT-',
  'HINT-',
  'FOLLOWUP-',
  'ANSWERTEXT-',
  ANSWER_MARK,
  'OUTPUT-SECRET',
  'HOSTVERDICT',
  'HOSTNOTE',
  'Queued and never posed',
  '[R6X]',
  '"questionId"',
  '"verdict"',
  '"hintRungs"',
  '"followUpAsked"',
  '"queue"',
  '"subtopic"',
  '"hintsAvailable"',
  '"correctAnswer"',
  '"solution"',
];
function expectNoSecrets(label: string, payload: unknown) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const s of SECRETS)
    if (json.includes(s))
      throw new Error(`${label} leaks ${JSON.stringify(s)}: ${json.slice(0, 400)}`);
}

// ---------------------------------------------------------------- harness

let h: Harness;
let fake: FakeInterviewer;
let ipCounter = 0;
const nextIp = () => `198.51.101.${++ipCounter}`;

beforeAll(async () => {
  await flushRedis();
  fake = new FakeInterviewer();
  h = await startApi({ fake });
  const db = h.api.ctx.db;
  await db
    .insert(quizTopics)
    .values(TOPICS.map((t, i) => ({ ...t, position: 90 + i })))
    .onConflictDoNothing();
  for (const raw of FIXTURES) {
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
        active: q.id !== INACTIVE,
      })
      .onConflictDoNothing();
  }
});
afterAll(async () => {
  const db = h?.api.ctx.db;
  if (db) {
    await db.delete(quantRoundAnswers).where(inArray(quantRoundAnswers.questionId, IDS));
    await db.delete(quizStandaloneAnswers).where(inArray(quizStandaloneAnswers.questionId, IDS));
    await db.delete(quizQuestions).where(inArray(quizQuestions.id, IDS));
    await db.delete(quizTopics).where(
      inArray(
        quizTopics.slug,
        TOPICS.map((t) => t.slug),
      ),
    );
  }
  await h?.stop();
});
beforeEach(() => {
  h.api.ctx.config.limits = structuredClone(DEFAULT_LIMITS);
});

/** A host with an account and a quant room; `key` saves an AI key for them. */
async function quantRoom(body: Record<string, unknown> = {}, key = false) {
  const host = new Client(h.base, nextIp());
  const me = await host.signUp('Hana');
  if (key) await host.saveKey();
  const res = await host.post('/api/pads', { kind: 'room', format: 'quant', ...body });
  expect(res.status, res.text).toBe(200);
  return { host, hostId: me.id, pad: res.json, id: res.json.id as string };
}

/** Someone with no account who opens the invite link and types a name. */
async function guest(shareToken: string, name = 'Casey') {
  const c = new Client(h.base, nextIp());
  const res = await c.post('/api/pads/join-guest', { shareToken, name });
  expect(res.status, res.text).toBe(200);
  return { c, res };
}

/** A candidate with an account, joined by the link. */
async function accountCandidate(shareToken: string, name = 'Cleo') {
  const c = new Client(h.base, nextIp());
  const me = await c.signUp(name);
  const res = await c.post('/api/pads/join', { shareToken });
  expect(res.status, res.text).toBe(200);
  return { c, id: me.id, res };
}

const events = async (c: Client, padId: string) =>
  EventSocket.open(`${h.wsBase}/ws/pads/${padId}?ticket=${await c.ticket(padId)}`);

const hostView = async (host: Client, id: string) => {
  const res = await host.get(`/api/pads/${id}/host`);
  expect(res.status, res.text).toBe(200);
  return HostView.parse(res.json);
};

async function pose(host: Client, id: string, questionId: string) {
  const res = await host.post(`/api/pads/${id}/host/round/pose`, { questionId });
  expect(res.status, res.text).toBe(200);
  return HostRoundView.parse(res.json);
}

const roundRow = async (id: string) => {
  const [row] = await h.api.ctx.db.select().from(quantRounds).where(eq(quantRounds.padId, id));
  if (!row) throw new Error('no round');
  return row;
};

// ---------------------------------------------------------------- creating one

describe('creating a quant room', () => {
  it('needs no AI key, no problem and no language; the AI stays out of the conversation', async () => {
    const { host, pad, id } = await quantRoom({
      interviewer: { enabled: true, style: 'tough', proactivity: 'high', voice: true },
      durationMin: 60,
    });
    expect(pad).toMatchObject({
      kind: 'room',
      format: 'quant',
      problemSlug: null,
      title: 'Quant interview',
      durationMin: 60,
    });
    expect(pad.interviewer).toMatchObject({ enabled: false, voice: false });
    const row = await roundRow(id);
    expect(row.state).toEqual({
      mode: 'hosted',
      path: null,
      durationMin: 0,
      current: -1,
      questions: [],
      queue: [],
    });
    const detail = PadDetail.parse((await host.get(`/api/pads/${id}`)).json);
    expect(detail.round).toEqual({
      mode: 'hosted',
      path: null,
      total: null,
      phase: 'pending',
      questions: [],
      version: 0,
    });
    expect(detail.problem).toBeNull();
    const list = (await host.get('/api/pads')).json;
    expect(list.find((p: { id: string }) => p.id === id)).toMatchObject({
      kind: 'room',
      format: 'quant',
      quantPath: null,
    });
    // The interviewer cannot be switched on later either.
    const patched = await host.patch(`/api/pads/${id}`, { interviewer: { enabled: true } });
    expect(patched.json.interviewer.enabled).toBe(false);
  });

  it('takes an initial queue of active bank questions, in order', async () => {
    const { host, id } = await quantRoom({ queue: ['qroom-3', 'qroom-1'], title: 'Desk round' });
    expect((await roundRow(id)).state.queue).toEqual(['qroom-3', 'qroom-1']);
    const view = await hostView(host, id);
    expect(view.round?.queue.map((q) => [q.questionId, q.material?.type])).toEqual([
      ['qroom-3', 'single'],
      ['qroom-1', 'short'],
    ]);
  });

  it('refuses what a quant room cannot be', async () => {
    const host = new Client(h.base, nextIp());
    await host.signUp('Hal');
    const bad = async (body: Record<string, unknown>, code: string) => {
      const res = await host.post('/api/pads', body);
      expect(res.status, res.text).toBe(400);
      expect(res.json.error.code).toBe(code);
    };
    await bad({ kind: 'room', format: 'quant', queue: ['qroom-404'] }, 'unknown_question');
    await bad({ kind: 'room', format: 'quant', queue: [INACTIVE] }, 'unknown_question');
    await bad({ kind: 'room', format: 'quant', queue: ['qroom-1', 'qroom-1'] }, 'validation_error');
    await bad({ kind: 'room', format: 'quant', problemSlug: 'two-sum' }, 'validation_error');
    await bad({ kind: 'room', format: 'quant', blank: true }, 'validation_error');
    await bad({ kind: 'practice', format: 'quant' }, 'validation_error');
    await bad({ kind: 'room', language: 'python', queue: ['qroom-1'] }, 'validation_error');
    // A coding pad still needs its language.
    await bad({ kind: 'room', problemSlug: 'two-sum' }, 'validation_error');
    const coding = await host.post('/api/pads', { kind: 'room', language: 'python', blank: true });
    expect(coding.status).toBe(200);
    expect(coding.json.format).toBe('coding');
  });
});

// ---------------------------------------------------------------- a whole interview

describe('a quant room, end to end with a guest', () => {
  it('poses every type, records hints and verdicts, and shows the candidate only what was posed', async () => {
    const { host, id, pad } = await quantRoom({ queue: ['qroom-6', 'qroom-2'] });
    const hostSock = await events(host, id);
    const { c: cand, res: joined } = await guest(pad.shareToken);
    expectNoSecrets('join response', joined.text);
    const candSock = await events(cand, id);
    await candSock.waitFor('round.updated');

    // Single choice, from the bank: the options are in the posted text.
    let round = await pose(host, id, 'qroom-3');
    expect(round.open).toBe(0);
    const posted = await candSock.waitFor(
      'message.created',
      (e) => e.message.intent === 'question',
    );
    expect(posted.message.text).toBe(
      'Which is on the stack? [R3X]\n\n- **(a)** Choice alpha\n- **(b)** Choice beta\n\n*Choose one.*',
    );
    expect(posted.message).toMatchObject({ role: 'interviewer', kind: 'proactive' });
    const update = await candSock.waitFor('round.updated', (e) => e.round.questions.length === 1);
    expect(update.round).toMatchObject({ mode: 'hosted', total: null, phase: 'asking' });
    expect(update.round.questions[0]).toMatchObject({
      index: 0,
      topic: 'roomfund',
      topicTitle: 'Room fundamentals',
      budgetSec: null,
      posedMessageId: posted.message.id,
    });

    // Chat is between people, and nobody else speaks.
    hostSock.send({ type: 'chat.send', text: 'Take your time.', via: 'text' });
    candSock.send({ type: 'chat.send', text: 'It is beta, I think.', via: 'text' });
    await hostSock.waitFor('message.created', (e) => e.message.text.startsWith('It is beta'));
    round = (await host.post(`/api/pads/${id}/host/round/hint`, { index: 0, rung: 0 })).json;
    expect(round.questions[0]?.hintRungs).toEqual([0]);
    await candSock.waitFor('round.updated', (e) => e.round.questions[0]?.hintsGiven === 1);
    round = (
      await host.post(`/api/pads/${id}/host/round/close`, {
        index: 0,
        verdict: { score: 1, summary: 'HOSTVERDICT right away' },
      })
    ).json;
    expect(round).toMatchObject({ open: null, phase: 'finished' });
    await candSock.waitFor('round.updated', (e) => e.round.phase === 'finished');

    // Output prediction: the program is in the posted text, the output is not.
    await pose(host, id, 'qroom-5');
    const out = await candSock.waitFor(
      'message.created',
      (e) => e.message.intent === 'question' && e.message.text.includes('[R5X]'),
    );
    expect(out.message.text).toContain('```python\nprint("CODE-5")\n```');

    // Numeric, from the queue; posing it closes the open one first.
    round = await pose(host, id, 'qroom-2');
    expect(round.questions[1]).toMatchObject({ closedBy: 'interviewer', verdict: null });
    expect(round.queue.map((q) => q.questionId)).toEqual(['qroom-6']);
    expect(round.questions[2]?.material).toMatchObject({
      type: 'numeric',
      solution: 'ANSWERTEXT-2 dollars',
      hints: ['HINT-2-A'],
      followUps: ['FOLLOWUP-2'],
      unit: 'dollars',
    });
    await host.post(`/api/pads/${id}/host/round/hint`, { index: 2, rung: 1 });
    const followUp = await host.post(`/api/pads/${id}/host/round/follow-up`, { index: 2 });
    expect(followUp.json.questions[2]).toMatchObject({ hintRungs: [1], followUpAsked: true });

    // Multiple choice and short: one closed with a verdict, the short one left open.
    await pose(host, id, 'qroom-4');
    await host.post(`/api/pads/${id}/host/round/close`, { index: 3 });
    await host.put(`/api/pads/${id}/host/round/verdict`, {
      index: 3,
      verdict: { score: 0.5, summary: 'HOSTVERDICT half' },
    });
    await pose(host, id, 'qroom-1');
    await host.put(`/api/pads/${id}/host/notes`, { notes: 'HOSTNOTE strong start' });
    candSock.send({ type: 'chat.send', text: 'Symmetry, every face alike.', via: 'text' });
    await hostSock.waitFor('message.created', (e) => e.message.text.startsWith('Symmetry'));

    // Everything the candidate can fetch while the room is active.
    const detail = await cand.get(`/api/pads/${id}`);
    expect(detail.status).toBe(200);
    expectNoSecrets('PadDetail', detail.text);
    const parsed = PadDetail.parse(detail.json);
    expect(parsed.round?.questions.map((q) => q.prompt.match(/\[R\dX\]/)?.[0])).toEqual([
      '[R3X]',
      '[R5X]',
      '[R2X]',
      '[R4X]',
      '[R1X]',
    ]);
    expect(parsed.interviewerKey).toBe('missing');
    const invite = await cand.get(`/api/pads/invite/${pad.shareToken}`);
    expectNoSecrets('invite', invite.text);
    // The invite says what the candidate will work in, so the join page does not promise an editor.
    expect(invite.json.format).toBe('quant');
    for (const path of ['/host', '/report', '/playback', '/host/round/bank'])
      expect((await cand.get(`/api/pads/${id}${path}`)).status).toBe(403);
    for (const [method, path, body] of [
      ['POST', '/host/round/pose', { questionId: 'qroom-6' }],
      ['POST', '/host/round/hint', { index: 4, rung: 0 }],
      ['POST', '/host/round/close', { index: 4 }],
      ['PUT', '/host/round/queue', { questionIds: [] }],
      ['PUT', '/host/round/verdict', { index: 0, verdict: { score: 0, summary: '' } }],
      ['POST', '/host/round/review', {}],
    ] as const)
      expect((await cand.req(method, `/api/pads/${id}${path}`, body)).status).toBe(403);

    // Ending mid-question closes it as ended; the candidate sees that, and still nothing else.
    const ended = await host.post(`/api/pads/${id}/end`);
    expect(ended.json.status).toBe('ended');
    await candSock.waitFor('round.updated', (e) => e.round.questions[4]?.closedBy === 'ended');
    for (const raw of candSock.raw) expectNoSecrets('candidate socket', raw);
    expectNoSecrets('PadDetail after the end', (await cand.get(`/api/pads/${id}`)).text);
    const types = new Set(candSock.events.map((e: ServerEvent) => e.type));
    expect(types.has('interviewer.status')).toBe(false);
    expect(types.has('message.delta')).toBe(false);
    candSock.close();
    hostSock.close();

    // Nothing reached the AI, and no model was called.
    expect(fake.triggers.filter((t) => t.padId === id)).toEqual([]);

    // The report is the host's: every question asked, in order, with its solution and verdict.
    const report = Report.parse((await host.get(`/api/pads/${id}/report`)).json);
    expect(report.status).toBe('ready');
    expect(report.assessmentUnavailable).toBe('not_requested');
    expect(report.hostNotes).toBe('HOSTNOTE strong start');
    expect(report.stats).toMatchObject({ runs: null, submissions: null, accepted: null });
    expect(report.stats.interviewerMessages).toBe(1);
    expect(report.stats.candidateMessages).toBe(2);
    expect(report.quant?.mode).toBe('hosted');
    expect(report.quant?.path).toBeNull();
    expect(
      report.quant?.questions.map((q) => [
        q.questionId,
        q.type,
        q.status,
        q.verdict?.score ?? null,
        q.hintRungs,
        q.followUpAsked,
        q.budgetSec,
      ]),
    ).toEqual([
      ['qroom-3', 'single', 'answered', 1, [0], false, null],
      ['qroom-5', 'output', 'answered', null, [], false, null],
      ['qroom-2', 'numeric', 'answered', null, [1], true, null],
      ['qroom-4', 'multiple', 'answered', 0.5, [], false, null],
      ['qroom-1', 'short', 'unfinished', null, [], false, null],
    ]);
    const q = report.quant?.questions ?? [];
    expect(q[0]?.solution).toBe('**(b)** Choice beta');
    expect(q[1]?.solution).toBe('It prints:\n\n```\nOUTPUT-SECRET-5\n```');
    expect(q[2]).toMatchObject({ solution: 'ANSWERTEXT-2 dollars', hintsAvailable: 1 });
    expect(q[3]?.solution).toBe('- **(a)** unique\n- **(c)** shared');
    expect(q[4]).toMatchObject({ solution: 'REFERENCE-1', keyPoints: ['KEYPOINT-1'] });
    expect(q.every((x) => x.timeSec !== null && x.explanation.startsWith('EXPLAIN-'))).toBe(true);
    // The queued question that was never posed is not in it, and no hint text is.
    expect(JSON.stringify(report)).not.toMatch(/R6X|HINT-|FOLLOWUP-/);
    const playback = Playback.parse((await host.get(`/api/pads/${id}/playback`)).json);
    expect(playback.events.filter((e) => e.event.type === 'question').map((e) => e.event)).toEqual(
      [0, 1, 2, 3, 4].map((index) => ({ type: 'question', index, total: null })),
    );

    // After the end: a missing verdict may be given, an existing one not changed, nothing posed.
    expect(
      (
        await host.put(`/api/pads/${id}/host/round/verdict`, {
          index: 4,
          verdict: { score: 0.3, summary: 'late' },
        })
      ).status,
    ).toBe(200);
    const again = await host.put(`/api/pads/${id}/host/round/verdict`, {
      index: 0,
      verdict: { score: 0, summary: '' },
    });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('has_verdict');
    const late = await host.post(`/api/pads/${id}/host/round/pose`, { questionId: 'qroom-6' });
    expect(late.json.error.code).toBe('pad_ended');
    expect((await hostView(host, id)).round).toMatchObject({ ended: true, open: null });

    // A hosted round records nothing as anyone's quiz answer.
    const recorded = await h.api.ctx.db
      .select()
      .from(quantRoundAnswers)
      .where(eq(quantRoundAnswers.padId, id));
    expect(recorded).toEqual([]);
  });
});

// ---------------------------------------------------------------- the host's material and queue

describe("the host's view and queue", () => {
  it('holds every solution, the hint ladder with what was recorded, and the queue in full', async () => {
    const { host, id } = await quantRoom({ queue: ['qroom-6', 'qroom-3'] });
    await pose(host, id, 'qroom-1');
    await host.post(`/api/pads/${id}/host/round/hint`, { index: 0, rung: 1 });
    const view = await hostView(host, id);
    expect(view.problem).toBeNull();
    const r = view.round;
    if (!r) throw new Error('no round');
    expect(r).toMatchObject({ phase: 'asking', ended: false, open: 0 });
    expect(r.questions[0]).toMatchObject({
      questionId: 'qroom-1',
      type: 'short',
      hintRungs: [1],
      closedAt: null,
      timeSec: null,
      verdict: null,
    });
    expect(r.questions[0]?.material).toMatchObject({
      solution: 'REFERENCE-1',
      correctAnswer: 'REFERENCE-1',
      keyPoints: ['KEYPOINT-1'],
      explanation: 'EXPLAIN-1',
      hints: ['HINT-1-A', 'HINT-1-B'],
      followUps: ['FOLLOWUP-1'],
      topicTitle: 'Room probability',
    });
    expect(r.queue.map((q) => q.material?.prompt)).toEqual([
      'Queued and never posed [R6X]',
      'Which is on the stack? [R3X]',
    ]);
    expect(r.queue[1]?.material).toMatchObject({ correctAnswer: 'b', choices: expect.any(Array) });
  });

  it('is edited whole: reorder, add and remove; never a posed or unknown question', async () => {
    const { host, id, pad } = await quantRoom({ queue: ['qroom-1', 'qroom-2'] });
    const { c } = await guest(pad.shareToken);
    const sock = await events(c, id);
    await sock.waitFor('round.updated');
    const put = (questionIds: string[]) =>
      host.put(`/api/pads/${id}/host/round/queue`, { questionIds });
    let res = await put(['qroom-2', 'qroom-5', 'qroom-1']);
    expect(res.status).toBe(200);
    expect(HostRoundView.parse(res.json).queue.map((q) => q.questionId)).toEqual([
      'qroom-2',
      'qroom-5',
      'qroom-1',
    ]);
    res = await put(['qroom-5']);
    expect(res.json.queue.map((q: { questionId: string }) => q.questionId)).toEqual(['qroom-5']);
    expect((await put(['qroom-404'])).json.error.code).toBe('unknown_question');
    expect((await put([INACTIVE])).json.error.code).toBe('unknown_question');
    expect((await put(['qroom-1', 'qroom-1'])).json.error.code).toBe('validation_error');
    expect((await put(Array.from({ length: 51 }, (_, i) => `x-${i}`))).status).toBe(400);
    // Posing from the queue takes the question out of it.
    const round = await pose(host, id, 'qroom-5');
    expect(round.queue).toEqual([]);
    const posed = await put(['qroom-5']);
    expect(posed.status).toBe(409);
    expect(posed.json.error.code).toBe('already_posed');
    // The candidate heard about the pose, and about none of the queue edits.
    await sleep(150);
    const updates = sock.events.filter((e) => e.type === 'round.updated');
    expect(updates).toHaveLength(2);
    for (const raw of sock.raw) expectNoSecrets('candidate socket', raw);
    sock.close();
  });

  it('refuses steps that do not fit the round', async () => {
    const { host, id } = await quantRoom();
    const code = async (method: string, path: string, body: unknown) => {
      const res = await host.req(method, `/api/pads/${id}/host/round/${path}`, body);
      return [res.status, res.json?.error?.code];
    };
    expect(await code('POST', 'hint', { index: 0, rung: 0 })).toEqual([409, 'not_open']);
    expect(await code('POST', 'close', { index: 0 })).toEqual([409, 'not_open']);
    expect(await code('POST', 'pose', { questionId: INACTIVE })).toEqual([404, 'not_found']);
    expect(await code('POST', 'pose', { questionId: 'qroom-404' })).toEqual([404, 'not_found']);
    await pose(host, id, 'qroom-1');
    expect(await code('POST', 'pose', { questionId: 'qroom-1' })).toEqual([409, 'already_posed']);
    expect(await code('POST', 'hint', { index: 0, rung: 2 })).toEqual([409, 'hint_rung']);
    expect(await code('POST', 'hint', { index: 3, rung: 0 })).toEqual([409, 'wrong_index']);
    expect(await code('POST', 'hint', { index: 0, rung: -1 })).toEqual([400, 'validation_error']);
    expect(await code('POST', 'follow-up', { index: 0 })).toEqual([200, undefined]);
    expect(await code('POST', 'follow-up', { index: 0 })).toEqual([409, 'follow_up_used']);
    expect(await code('PUT', 'verdict', { index: 0, verdict: { score: 1, summary: '' } })).toEqual([
      409,
      'not_closed',
    ]);
    expect(await code('POST', 'close', { index: 0, verdict: { score: 2, summary: '' } })).toEqual([
      400,
      'validation_error',
    ]);
    expect(
      await code('POST', 'close', { index: 0, verdict: { score: 0.2, summary: 'x' } }),
    ).toEqual([200, undefined]);
    // Until the end the host may change their mind.
    expect(
      await code('PUT', 'verdict', { index: 0, verdict: { score: 0.9, summary: 'y' } }),
    ).toEqual([200, undefined]);
    expect((await hostView(host, id)).round?.questions[0]?.verdict).toEqual({
      score: 0.9,
      summary: 'y',
    });
  });
});

// ---------------------------------------------------------------- the host's bank search

describe("the host's bank search", () => {
  it('filters the whole bank, shows the solutions, and marks what is queued or posed', async () => {
    const { host, id } = await quantRoom({ queue: ['qroom-2'] });
    await pose(host, id, 'qroom-1');
    const search = async (q: string) => {
      const res = await host.get(`/api/pads/${id}/host/round/bank${q}`);
      expect(res.status, res.text).toBe(200);
      return HostBankPage.parse(res.json);
    };
    let page = await search('?topic=roomprob');
    expect(page.items.map((i) => [i.id, i.status])).toEqual([
      ['qroom-1', 'posed'],
      ['qroom-6', 'available'],
      ['qroom-2', 'queued'],
    ]);
    expect(page.total).toBe(3);
    expect(page.subtopics).toEqual(['dice', 'expectation']);
    expect(page.topics.find((t) => t.slug === 'roomprob')).toMatchObject({
      title: 'Room probability',
      track: 'quant',
      questionCount: 3,
    });
    expect(page.items[0]).toMatchObject({
      solution: 'REFERENCE-1',
      hints: ['HINT-1-A', 'HINT-1-B'],
      explanation: 'EXPLAIN-1',
    });
    page = await search('?topic=roomfund&type=output');
    expect(page.items.map((i) => i.id)).toEqual(['qroom-5']);
    expect(page.items[0]?.code).toMatchObject({ language: 'python', source: 'print("CODE-5")' });
    // Other files' questions may share the database: only ours are asserted.
    const ours = (p: HostBankPage) => p.items.map((i) => i.id).filter((x) => x.startsWith('qroom'));
    page = await search('?track=fundamentals&difficulty=hard&limit=100');
    expect(ours(page)).toEqual(['qroom-4']);
    expect(page.items.every((i) => i.difficulty === 'hard')).toBe(true);
    page = await search('?subtopic=expectation&limit=100');
    expect(ours(page)).toEqual(['qroom-2']);
    page = await search('?q=ON%20THE%20STACK&limit=100');
    expect(ours(page)).toEqual(['qroom-3']);
    // An empty filter is no filter.
    expect((await search('?topic=roomprob&q=&subtopic=')).total).toBe(3);
    // A literal `%` matches only itself.
    expect(ours(await search('?q=%25&limit=100'))).toEqual([]);
    page = await search('?topic=roomprob&limit=1&offset=1');
    expect(page).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(page.items.map((i) => i.id)).toEqual(['qroom-6']);
    // Inactive questions are never offered.
    expect(ours(await search('?q=qroom&limit=100'))).not.toContain(INACTIVE);
    expect(ours(await search('?q=qroom&limit=100'))).toHaveLength(6);
    expect((await host.get(`/api/pads/${id}/host/round/bank?difficulty=extreme`)).status).toBe(400);
  });

  it('is for the host of that quant room only', async () => {
    const { host, id, pad } = await quantRoom();
    const { c: g } = await guest(pad.shareToken);
    const g403 = await g.get(`/api/pads/${id}/host/round/bank`);
    expect(g403.status).toBe(403);
    const { c: a } = await accountCandidate(pad.shareToken);
    expect((await a.get(`/api/pads/${id}/host/round/bank`)).status).toBe(403);
    const stranger = new Client(h.base, nextIp());
    await stranger.signUp('Sam');
    expect((await stranger.get(`/api/pads/${id}/host/round/bank`)).status).toBe(404);
    // A coding room's host: there are no questions to pose there.
    const coding = await host.post('/api/pads', { kind: 'room', language: 'python', blank: true });
    const wrong = await host.get(`/api/pads/${coding.json.id}/host/round/bank`);
    expect(wrong.status).toBe(409);
    expect(wrong.json.error.code).toBe('wrong_format');
  });
});

// ---------------------------------------------------------------- answers are not a tab away

describe('the quiz while a candidate is in a quant room', () => {
  it('refuses answers and explanations to the candidate until the room ends, never to the host', async () => {
    const { host, id, pad } = await quantRoom();
    // Answered before the interview, so there is feedback to look up.
    const { c: cand, id: candId } = await accountCandidate(pad.shareToken);
    await h.api.ctx.db.delete(padMembers).where(eq(padMembers.userId, candId));
    const before = await cand.post('/api/quiz/questions/qroom-3/answers', {
      response: { type: 'single', choice: 'a' },
    });
    expect(before.status).toBe(200);
    const attempt = await cand.post('/api/quiz/attempts', { topics: ['roomfund'], count: 2 });
    expect(attempt.status).toBe(200);
    expect((await cand.post('/api/pads/join', { shareToken: pad.shareToken })).status).toBe(200);

    const refused = async (method: string, path: string, body?: unknown) => {
      const res = await cand.req(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(409);
      expect(res.json.error.code).toBe('in_quant_interview');
      expect(res.json.error.message).toMatch(/quant interview that is still going/);
      expectNoSecrets(path, res.text);
    };
    await refused('GET', '/api/quiz/questions/qroom-3');
    await refused('POST', '/api/quiz/questions/qroom-3/answers', {
      response: { type: 'single', choice: 'b' },
    });
    const aid = attempt.json.id;
    await refused('GET', `/api/quiz/attempts/${aid}`);
    await refused('POST', `/api/quiz/attempts/${aid}/answers`, {
      questionId: attempt.json.questions[0].id,
      response: { type: 'single', choice: 'a' },
    });
    await refused('POST', `/api/quiz/attempts/${aid}/discussion`, {
      questionId: 'qroom-1',
      text: 'x',
    });
    await refused('POST', `/api/quiz/attempts/${aid}/finish`);
    // What reveals nothing stays open.
    expect((await cand.get('/api/quiz/topics')).status).toBe(200);
    expect((await cand.get('/api/quiz/topics/roomfund/questions')).status).toBe(200);
    // The host is never affected.
    expect((await host.get('/api/quiz/questions/qroom-3')).status).toBe(200);
    // Ending the room lifts it.
    await host.post(`/api/pads/${id}/end`);
    expect((await cand.get('/api/quiz/questions/qroom-3')).status).toBe(200);
    expect((await cand.get(`/api/quiz/attempts/${aid}`)).status).toBe(200);
  });

  it('lifts when the candidate leaves the room, and a coding room never sets it', async () => {
    const { pad, id } = await quantRoom();
    const { c } = await accountCandidate(pad.shareToken);
    expect((await c.get('/api/quiz/questions/qroom-1')).status).toBe(409);
    expect((await c.del(`/api/pads/${id}`)).json.removed).toBe('membership');
    expect((await c.get('/api/quiz/questions/qroom-1')).status).toBe(200);

    // A room its host never ended stops holding the candidate after a working day.
    const { pad: old, id: oldId } = await quantRoom();
    const { c: late } = await accountCandidate(old.shareToken);
    expect((await late.get('/api/quiz/questions/qroom-1')).status).toBe(409);
    await h.api.ctx.db
      .update(pads)
      .set({ startedAt: new Date(Date.now() - (QUANT_INTERVIEW_GUARD_HOURS + 1) * 3_600_000) })
      .where(eq(pads.id, oldId));
    expect((await late.get('/api/quiz/questions/qroom-1')).status).toBe(200);

    const coder = new Client(h.base, nextIp());
    await coder.signUp('Coder');
    const room = await coder.post('/api/pads', { kind: 'room', language: 'python', blank: true });
    const { c: other } = await accountCandidate(room.json.shareToken);
    expect((await other.get('/api/quiz/questions/qroom-1')).status).toBe(200);
  });
});

// ---------------------------------------------------------------- routes that assume code

describe('what a quant room refuses and accepts', () => {
  it('refuses code, runs, languages, problems, markets and the code review; keeps the host notes', async () => {
    const { host, id, pad } = await quantRoom({}, true);
    const { c } = await guest(pad.shareToken);
    const expectCode = (
      res: { status: number; json: { error?: { code: string } } },
      s: number,
      code: string,
    ) => {
      expect(res.status).toBe(s);
      expect(res.json.error?.code).toBe(code);
    };
    expectCode(
      await c.post(`/api/pads/${id}/runs`, {
        mode: 'file',
        language: 'python',
        source: 'print(1)',
      }),
      409,
      'wrong_format',
    );
    expectCode(await host.patch(`/api/pads/${id}`, { language: 'cpp' }), 409, 'wrong_format');
    expectCode(
      await host.post(`/api/pads/${id}/problem`, { problemSlug: 'two-sum' }),
      409,
      'wrong_format',
    );
    expectCode(await host.post(`/api/pads/${id}/review`, {}), 409, 'wrong_format');
    await pose(host, id, 'qroom-1');
    expectCode(
      await c.post(`/api/pads/${id}/round/quote`, { index: 0, bid: 1, ask: 2, size: 1 }),
      409,
      'wrong_mode',
    );
    const sock = await events(c, id);
    sock.send({ type: 'language', language: 'cpp' });
    const err = await sock.waitFor('error');
    expect(err.code).toBe('wrong_format');
    sock.close();
    const notes = await host.put(`/api/pads/${id}/host/notes`, { notes: 'fine' });
    expect(notes.status).toBe(200);
    expect((await hostView(host, id)).notes).toBe('fine');
    expect(fake.triggers.filter((t) => t.padId === id)).toEqual([]);
  });
});

// ---------------------------------------------------------------- no clock, no quiz answers

describe('a hosted round outside the interview', () => {
  it('is never swept, however long a question stays open', async () => {
    const { host, id } = await quantRoom();
    await pose(host, id, 'qroom-1');
    const row = await roundRow(id);
    const state = structuredClone(row.state);
    const q = state.questions[0];
    if (!q) throw new Error('not posed');
    q.posedAt = new Date(Date.now() - 6 * 3600_000).toISOString();
    await h.api.ctx.db.update(quantRounds).set({ state }).where(eq(quantRounds.padId, id));
    // Only this pad counts as unattended: other files' rounds may share the database.
    expect(await sweepQuantRounds(h.api.ctx, (padId) => padId !== id)).toBe(0);
    const after = await roundRow(id);
    expect(after.version).toBe(row.version);
    expect(after.state.questions[0]?.closedAt).toBeNull();
  });

  it("is not the host's own practice: its questions are not 'recently posed' to them", async () => {
    const { host, hostId, id } = await quantRoom();
    await pose(host, id, 'qroom-1');
    await host.post(`/api/pads/${id}/host/round/close`, {
      index: 0,
      verdict: { score: 0, summary: 'missed' },
    });
    await host.post(`/api/pads/${id}/end`);
    expect((await recentlyPosed(h.api.ctx, hostId)).has('qroom-1')).toBe(false);
    const bank = await host.get('/api/quiz/questions/qroom-1');
    expect(bank.json.status).toBe('unanswered');
    expect(
      await h.api.ctx.db.select().from(quantRoundAnswers).where(eq(quantRoundAnswers.padId, id)),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------- AI for the host

describe('AI for the host of a quant room', () => {
  it('gives a second opinion on a question, on the host’s key, to the host alone', async () => {
    const { host, id, pad } = await quantRoom({ queue: ['qroom-6'] });
    const { c } = await guest(pad.shareToken);
    const sock = await events(c, id);
    await sock.waitFor('round.updated');
    const none = await host.post(`/api/pads/${id}/host/round/review`, {});
    expect(none.json.error.code).toBe('no_question');
    await pose(host, id, 'qroom-2');
    const noKey = await host.post(`/api/pads/${id}/host/round/review`, {});
    expect(noKey.status).toBe(409);
    expect(noKey.json.error.code).toBe('ai_key_missing');
    await host.saveKey();
    await host.post(`/api/pads/${id}/host/round/hint`, { index: 0, rung: 1 });
    await host.put(`/api/pads/${id}/host/notes`, { notes: 'HOSTNOTE watch the units' });
    sock.send({ type: 'chat.send', text: 'About three dollars?', via: 'text' });
    await until(async () => (await c.get(`/api/pads/${id}`)).json.messages.length >= 2);
    const seen = sock.raw.length;
    const res = await host.post(`/api/pads/${id}/host/round/review`, { question: 'Units right?' });
    expect(res.status, res.text).toBe(200);
    const review = QuantSecondOpinion.parse(res.json);
    expect(review).toMatchObject({
      index: 0,
      verdict: 'partly_correct',
      answer: expect.any(String),
    });
    expect(fake.quantRoomReviews.at(-1)).toEqual({ padId: id, index: 0, question: 'Units right?' });
    const ctx = fake.quantRoomContexts.at(-1);
    expect(ctx?.open).toBe(0);
    expect(ctx?.hostNotes).toBe('HOSTNOTE watch the units');
    expect(ctx?.questions).toHaveLength(1);
    expect(ctx?.questions[0]).toMatchObject({ index: 0, type: 'numeric', hintRungs: [1] });
    expect(ctx?.questions[0]?.question).toMatchObject({
      id: 'qroom-2',
      answerText: 'ANSWERTEXT-2',
    });
    expect(ctx?.transcript.some((m) => m.text === 'About three dollars?')).toBe(true);
    // The queue is not the adviser's business.
    expect(JSON.stringify(ctx)).not.toContain('qroom-6');
    // Neither stored nor broadcast.
    await sleep(100);
    expect(sock.raw.length).toBe(seen);
    expect((await c.get(`/api/pads/${id}`)).text).not.toContain('partly_correct');
    // A question not asked here.
    const wrong = await host.post(`/api/pads/${id}/host/round/review`, { index: 4 });
    expect(wrong.json.error.code).toBe('wrong_index');
    sock.close();
  });

  it('assesses the interview only when the host asks, over the posed questions and their verdicts', async () => {
    const { host, id, pad } = await quantRoom({}, true);
    const { c } = await guest(pad.shareToken);
    await pose(host, id, 'qroom-3');
    await host.post(`/api/pads/${id}/host/round/close`, {
      index: 0,
      verdict: { score: 1, summary: 'HOSTVERDICT spot on' },
    });
    await pose(host, id, 'qroom-1');
    const sock = await events(c, id);
    sock.send({ type: 'chat.send', text: 'Symmetry.', via: 'text' });
    await until(async () => (await c.get(`/api/pads/${id}`)).json.messages.length >= 3);
    sock.close();
    await host.post(`/api/pads/${id}/end`);
    const versionAtEnd = (await roundRow(id)).version;
    let report = Report.parse((await host.get(`/api/pads/${id}/report`)).json);
    expect(report.assessmentUnavailable).toBe('not_requested');
    const asked = await host.post(`/api/pads/${id}/report/assessment`);
    expect(asked.status).toBe(200);
    await until(async () => {
      report = Report.parse((await host.get(`/api/pads/${id}/report`)).json);
      return report.status === 'ready' && report.assessment !== null;
    });
    expect(report.assessment?.scores.map((s) => s.dimension)).toEqual([
      'structuring',
      'correctness',
      'communication',
      'speed',
      'independence',
    ]);
    const ctx = fake.quantRoomContexts.at(-1);
    expect(ctx?.pad.status).toBe('ended');
    expect(ctx?.questions.map((q) => [q.index, q.verdict?.summary ?? null, q.closedBy])).toEqual([
      [0, 'HOSTVERDICT spot on', 'interviewer'],
      [1, null, 'ended'],
    ]);
    // The adviser judges nothing back into the round: verdicts are the host's.
    expect((await roundRow(id)).version).toBe(versionAtEnd);
    expect((await c.get(`/api/pads/${id}/report`)).status).toBe(403);
  });

  it('an empty room has nothing to assess; one where only the conversation happened is assessed', async () => {
    const empty = await quantRoom({}, true);
    await empty.host.post(`/api/pads/${empty.id}/end`);
    const report = Report.parse((await empty.host.get(`/api/pads/${empty.id}/report`)).json);
    expect(report.quant).toEqual({ mode: 'hosted', path: null, questions: [] });
    const refused = await empty.host.post(`/api/pads/${empty.id}/report/assessment`);
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe('nothing_to_assess');

    const talk = await quantRoom({}, true);
    const { c } = await guest(talk.pad.shareToken);
    const sock = await events(c, talk.id);
    sock.send({ type: 'chat.send', text: 'I would price it at fifty.', via: 'text' });
    await until(async () => (await c.get(`/api/pads/${talk.id}`)).json.messages.length >= 1);
    sock.close();
    await talk.host.post(`/api/pads/${talk.id}/end`);
    expect((await talk.host.post(`/api/pads/${talk.id}/report/assessment`)).status).toBe(200);
    await until(async () => {
      const r = Report.parse((await talk.host.get(`/api/pads/${talk.id}/report`)).json);
      return r.assessment !== null;
    });
    const ctx = fake.quantRoomContexts.at(-1);
    expect(ctx?.questions).toEqual([]);
    expect(ctx?.transcript.map((m) => m.text)).toEqual(['I would price it at fifty.']);
  });
});

// ---------------------------------------------------------------- the view's contract

describe("a candidate's view of a quant room", () => {
  it('parses as a QuantRoundView with no total and no budgets', async () => {
    const { host, id, pad } = await quantRoom();
    const { c } = await guest(pad.shareToken);
    await pose(host, id, 'qroom-2');
    const view = QuantRoundView.parse((await c.get(`/api/pads/${id}`)).json.round);
    expect(view).toMatchObject({ mode: 'hosted', total: null, phase: 'asking', path: null });
    expect(view.questions[0]).toMatchObject({ unit: 'dollars', budgetSec: null, game: null });
  });
});
