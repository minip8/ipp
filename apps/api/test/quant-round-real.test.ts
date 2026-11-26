/**
 * The live quant round end to end with the real interviewer: HTTP, WebSocket, Postgres, Redis,
 * the collab document, the host, the policy and the round service are all real; only the model
 * call is scripted (helpers/real-interviewer.ts). Time moves with `TestClock`, which shifts the
 * one clock the round service, the host and the interviewer all read; ticks still arrive every
 * 200 ms of real time, as the API's tick loop sends them.
 */
import { randomUUID } from 'node:crypto';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  type Pad,
  QUANT_REPORT_DIMENSIONS,
  QuizQuestion,
  quantGraceSec,
  quantRoundEndsAt,
  type ServerEvent,
  YDOC,
} from '@ipp/contracts';
import {
  messages,
  quantRoundAnswers,
  quantRounds,
  quizQuestions,
  quizStandaloneAnswers,
  quizTopics,
} from '@ipp/db';
import { asc, eq, inArray } from '@ipp/db/orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import {
  Client,
  EventSocket,
  flushRedis,
  type Harness,
  startApi,
  testConfig,
} from './helpers/harness';
import {
  eventually,
  RealInterviewerRig,
  type RecordedCall,
  requestText,
  type ScriptedModel,
  TestClock,
  turn,
} from './helpers/real-interviewer';

// ---------------------------------------------------------------- the question bank

const TOPICS = [
  { slug: 'probability', title: 'Probability', description: 'real round tests', track: 'quant' },
  { slug: 'brainteasers', title: 'Brainteasers', description: 'real round tests', track: 'quant' },
] as const;

const pad2 = (k: number) => String(k).padStart(2, '0');
/** Every server-only text carries a bracketed marker, so a leak is a substring search. */
function question(
  k: number,
  topic: string,
  difficulty: 'easy' | 'medium' | 'hard',
  type: 'short' | 'numeric',
) {
  const base = {
    id: `qreal-${k}`,
    topic,
    subtopic: `realsub-${k}`,
    difficulty,
    tags: [],
    prompt: `Puzzle ${k}: what is the value of this? [PROMPT-${k}]`,
    explanation: `[EXPLAIN-${k}] the method`,
    hints: [`[HINT-${k}-1] look at it`, `[HINT-${k}-2] look harder`],
    followUps: [`[FOLLOW-${k}] and if it were bigger?`],
  };
  return type === 'short'
    ? { ...base, type, reference: `[REF-${k}] the reference`, keyPoints: [`[KEY-${k}] the point`] }
    : { ...base, type, answer: `0.7${pad2(k)}7${pad2(k)}`, answerText: `[ANSTEXT-${k}] the value` };
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
const FIXTURES = TOPICS.flatMap((t, ti) =>
  LAYOUT.map(([d, type], i) => question(ti * 10 + i + 1, t.slug, d, type)),
);
const BANK = new Map(FIXTURES.map((q) => [q.id, q]));

const promptMarker = (id: string) => `[PROMPT-${id.slice('qreal-'.length)}]`;
/** A question's server-only material: everything but its prompt. */
function materialOf(id: string): string[] {
  const k = id.slice('qreal-'.length);
  const q = BANK.get(id);
  return [
    `[EXPLAIN-${k}]`,
    `[HINT-${k}-1]`,
    `[HINT-${k}-2]`,
    `[HINT-${k}-3]`,
    `[FOLLOW-${k}]`,
    `[REF-${k}]`,
    `[KEY-${k}]`,
    `[ANSTEXT-${k}]`,
    ...(q && 'answer' in q ? [q.answer] : []),
  ];
}

// ---------------------------------------------------------------- harness

let h: Harness;
let rig: RealInterviewerRig;
let clock: TestClock;

beforeAll(async () => {
  await flushRedis();
  rig = new RealInterviewerRig(testConfig());
  h = await startApi({ interviewerFactory: rig.factory, captureLogs: true });
  clock = new TestClock(h.api.ctx);
  await clock.install();
  const db = h.api.ctx.db;
  await db
    .insert(quizTopics)
    .values([...TOPICS])
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
      })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  const db = h?.api.ctx.db;
  if (db) {
    const ids = FIXTURES.map((q) => q.id);
    await db.delete(quantRoundAnswers).where(inArray(quantRoundAnswers.questionId, ids));
    await db.delete(quizStandaloneAnswers).where(inArray(quizStandaloneAnswers.questionId, ids));
    await db.delete(quizQuestions).where(inArray(quizQuestions.id, ids));
    await db.delete(quizTopics).where(
      inArray(
        quizTopics.slug,
        TOPICS.map((t) => t.slug),
      ),
    );
  }
  await clock?.uninstall();
  await h?.stop();
});

const db = () => h.api.ctx.db;
let ipSeq = 0;

// Every test: no step the interviewer asked for was refused by the round, and nothing logged an
// error or a warning other than the model failures a test scripts.
let traceMark = 0;
let logMark = 0;
beforeEach(() => {
  traceMark = rig.traces.length;
  logMark = h.logs.length;
});
afterEach(() => {
  const refused = rig.traces
    .slice(traceMark)
    .flatMap((t) => (t.event.type === 'quant' && t.event.outcome === 'refused' ? [t.event] : []));
  expect(refused, 'refused steps').toEqual([]);
  const problems = h.logs
    .slice(logMark)
    .map((l) => JSON.parse(l) as { level: number; msg?: string })
    .filter((l) => l.level >= 40 && !/model call failed/.test(l.msg ?? ''));
  expect(problems, 'warnings and errors').toEqual([]);
});

/** The round's books when a model call was made. */
interface Snap {
  current: number;
  phase: 'pending' | 'asking' | 'finished';
  posed: number[];
  ids: string[];
}

async function roundRow(padId: string) {
  const [row] = await db().select().from(quantRounds).where(eq(quantRounds.padId, padId));
  if (!row) throw new Error('no round');
  return row;
}

/** A signed-in account with its own key, so its pads' model calls go to its own script. */
async function account(name: string) {
  const c = new Client(h.base, `100.70.${Math.floor(ipSeq / 200)}.${(ipSeq++ % 200) + 1}`);
  const { id } = await c.signUp(name);
  const apiKey = `sk-ant-api03-good-${randomUUID()}`;
  await c.saveKey(apiKey);
  return Object.assign(c, { userId: id, apiKey, model: rig.model<Snap>(apiKey) });
}
type Account = Awaited<ReturnType<typeof account>>;

async function createRound(c: Account): Promise<Pad> {
  const res = await c.post('/api/pads/quant', {
    path: 'trader',
    durationMin: 20,
    interviewer: { style: 'neutral', proactivity: 'low', voice: false },
  });
  if (res.status !== 200) throw new Error(`creating the round failed: ${res.status} ${res.text}`);
  const pad = res.json as Pad;
  // Every model call records the round as it was when the call was made.
  c.model.snapshot = async () => {
    const { state } = await roundRow(pad.id);
    const phase =
      state.current < 0
        ? 'pending'
        : state.current >= state.questions.length
          ? 'finished'
          : 'asking';
    return {
      current: state.current,
      phase,
      posed: state.questions.flatMap((q, i) => (q.posedAt ? [i] : [])),
      ids: state.questions.map((q) => q.questionId),
    };
  };
  return pad;
}

async function openEvents(c: Client, padId: string) {
  return EventSocket.open(`${h.wsBase}/ws/pads/${padId}?ticket=${await c.ticket(padId)}`);
}

const label = (e: ServerEvent) =>
  e.type === 'message.created'
    ? `${e.message.role}:${e.message.intent ?? 'chat'}`
    : e.type === 'round.updated'
      ? `round:${e.round.version}`
      : e.type;

const shown = (e: ServerEvent) => e.type === 'message.created' || e.type === 'round.updated';

/** The message and round events from `mark` up to `round.updated` at `version`. */
async function stepEvents(s: EventSocket, mark: number, version: number) {
  await s.waitFor('round.updated', (e) => e.round.version === version, 15_000);
  const events = s.events.slice(mark);
  const end = events.findIndex((e) => e.type === 'round.updated' && e.round.version === version);
  return events.slice(0, end + 1).filter(shown);
}

/** The interviewer messages a socket got after `mark`. */
const saidAfter = (s: EventSocket, mark: number) =>
  s.events
    .slice(mark)
    .flatMap((e) =>
      e.type === 'message.created' && e.message.role === 'interviewer' ? [e.message] : [],
    );

/** Lets the tick loop reach the pad `n` more times, then waits for the interviewer to settle. */
async function ticks(padId: string, n = 3, settle = true) {
  const seen = rig.of('tick', padId).length;
  await eventually(() => rig.of('tick', padId).length >= seen + n, 10_000, `${n} ticks`);
  if (settle) await rig.idle(padId);
}

async function storedMessages(padId: string): Promise<(typeof messages.$inferSelect)[]> {
  return db()
    .select()
    .from(messages)
    .where(eq(messages.padId, padId))
    .orderBy(asc(messages.createdAt));
}

// ---------------------------------------------------------------- the leak checks

/**
 * Over every request the model got: nothing of a question that was not posed when the call was
 * made, and in a live turn nothing of an earlier question but its numbers (no prompt, no
 * material, no verdict wording); no question id anywhere. The verdict and the assessment (after
 * the pad ended) may see every posed question.
 */
function expectRequestsClean(calls: RecordedCall<Snap>[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    const text = requestText(c.req);
    const snap = c.snapshot;
    const after = c.task === 'verdict' || c.task === 'assessment';
    const allowed = new Set(
      after
        ? snap.posed.map((i) => snap.ids[i])
        : snap.phase === 'asking'
          ? [snap.ids[snap.current]]
          : [],
    );
    const forbidden = ['qreal-'];
    for (const q of FIXTURES)
      if (!allowed.has(q.id)) forbidden.push(promptMarker(q.id), ...materialOf(q.id));
    if (!after) forbidden.push('[VERDICT-', '[LATE-');
    for (const f of forbidden)
      expect(
        text.includes(f),
        `${f} in a ${c.task} request (round at ${snap.current}, posed ${snap.posed})`,
      ).toBe(false);
  }
}

/** JSON keys of the server-only state. */
const STATE_KEYS = [
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

/**
 * What the candidate got (socket frames, HTTP bodies): no answer, reference, key point,
 * explanation, hint or follow-up text, verdict, private note or question id, and no prompt of a
 * question not posed yet.
 */
async function expectBrowserClean(padId: string, texts: string[]) {
  const { state } = await roundRow(padId);
  const posed = new Set(state.questions.filter((q) => q.posedAt).map((q) => q.questionId));
  const forbidden = ['qreal-', 'realsub-', '[VERDICT-', '[LATE-', '[NOTE-', ...STATE_KEYS];
  for (const q of FIXTURES) {
    forbidden.push(...materialOf(q.id));
    if (!posed.has(q.id)) forbidden.push(promptMarker(q.id));
  }
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts)
    for (const f of forbidden)
      expect(text.includes(f), `${f} reached the browser: ${text.slice(0, 300)}`).toBe(false);
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
  expect(playback.status).toBe(200);
  expect(report.status).toBe(409);
  return [detail.text, list.text, playback.text, report.text];
}

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('missing');
  return x;
}

/** The last user turn and the last system message of a live request. */
function finalTurn(c: RecordedCall<Snap>) {
  const msgs = c.req.messages;
  const user = [...msgs].reverse().find((m) => m.role === 'user');
  const system = msgs.at(-1);
  const text = (m: (typeof msgs)[number] | undefined) =>
    typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '');
  return { user: text(user), system: text(system), question: c.req.system[1]?.text ?? '' };
}

/** Starts a round: the socket opens, the interviewer greets and question 1 is posed. */
async function started(name: string) {
  const a = await account(name);
  const pad = await createRound(a);
  const s = await openEvents(a, pad.id);
  await s.waitFor('round.updated', (e) => e.round.version === 1, 15_000);
  return { a, pad, s, id: pad.id, model: a.model };
}

/** Sends a chat message as the candidate and returns the mark before it. */
function say(s: EventSocket, text: string) {
  const mark = s.events.length;
  s.send({ type: 'chat.send', text });
  return mark;
}

const CANNED_FAILED =
  'Sorry, I lost my train of thought there for a second (connection hiccup). Could you say that again?';
const CANNED_REFUSED = "Let's keep our focus on the question. Where are you with it right now?";
const CANNED_TIMEOUT = "That's time on this one. Let's move on.";

// ---------------------------------------------------------------- a whole round

describe('a quant round with the real interviewer', () => {
  it('runs from creation to the report: greeting, question, stay, hint, follow-up, closes, wrap-up, assessment', {
    timeout: 90_000,
  }, async () => {
    const a = await account('Full');
    const pad = await createRound(a);
    const id = pad.id;
    const m = a.model;
    m.script('opening', turn({ action: 'stay', message: 'Hello, and welcome to the round.' }));
    const s = await openEvents(a, id);

    // The greeting, then question 1 (the bank's exact prompt), then the round.
    await s.waitFor('round.updated', (e) => e.round.version === 1, 15_000);
    const opened = s.events.filter(shown).map(label);
    expect(opened.filter((l) => l !== 'round:0')).toEqual([
      'interviewer:greeting',
      'interviewer:question',
      'round:1',
    ]);
    let state = (await roundRow(id)).state;
    const posted = () =>
      s.events.flatMap((e) =>
        e.type === 'message.created' && e.message.intent === 'question' ? [e.message] : [],
      );
    const greeting = s.events.find(
      (e): e is Extract<ServerEvent, { type: 'message.created' }> =>
        e.type === 'message.created' && e.message.intent === 'greeting',
    );
    expect(greeting?.message.text).toBe('Hello, and welcome to the round.');
    const q = (i: number) => {
      const qid = state.questions[i]?.questionId;
      const b = qid ? BANK.get(qid) : undefined;
      if (!b) throw new Error(`question ${i}`);
      return b;
    };
    expect(posted()[0]).toMatchObject({
      text: q(0).prompt,
      id: state.questions[0]?.posedMessageId,
    });
    const opening = m.of('opening');
    expect(opening).toHaveLength(1);
    expect(opening[0]?.snapshot.phase).toBe('pending');
    await expectBrowserClean(id, [...s.raw, ...(await httpTexts(a, id))]);

    // A stay: the conversation goes on, nothing in the books changes but the version.
    m.script('reply', turn({ action: 'stay', message: 'What are you conditioning on?' }));
    let mark = say(s, 'I think I should condition on the first roll.');
    expect((await stepEvents(s, mark, 2)).map(label)).toEqual([
      'candidate:chat',
      'interviewer:answer',
      'round:2',
    ]);
    let last = m.of('reply').at(-1);
    if (!last) throw new Error('no reply call');
    expect(finalTurn(last).user).toContain('I think I should condition on the first roll.');
    expect(finalTurn(last).question).toContain(q(0).prompt);
    expect(finalTurn(last).question).toContain(`[HINT-${q(0).id.slice(6)}-1]`);

    // A hint: the model names rung 2, the books record the next unused rung, 1.
    m.script('reply', turn({ action: 'hint', hint_rung: 2, message: 'Is there a symmetry here?' }));
    mark = say(s, 'I am stuck, could I have a hint?');
    expect((await stepEvents(s, mark, 3)).map(label)).toEqual([
      'candidate:chat',
      'interviewer:hint',
      'round:3',
    ]);
    state = (await roundRow(id)).state;
    expect(state.questions[0]?.hintRungs).toEqual([1]);
    expect(
      (await s.waitFor('round.updated', (e) => e.round.version === 3)).round.questions[0]
        ?.hintsGiven,
    ).toBe(1);

    // The follow-up, once; the next request knows it was asked and that rung 2 is next.
    m.script('reply', turn({ action: 'follow_up', message: 'Good. And with an eight-sided die?' }));
    mark = say(s, 'My final answer is one half.');
    expect((await stepEvents(s, mark, 4)).map(label)).toEqual([
      'candidate:chat',
      'interviewer:probe',
      'round:4',
    ]);
    last = m.of('reply').at(-1);
    if (!last) throw new Error('no reply call');
    expect(finalTurn(last).system).toContain('Hints: 1 of 2 authored rungs given');
    expect(finalTurn(last).system).toContain('the next is rung 2');
    expect((await roundRow(id)).state.questions[0]?.followUpAsked).toBe(true);

    // A close with a verdict: the closing line, then question 2 posted by the server.
    m.script(
      'reply',
      turn({
        action: 'close',
        message: "That's right. Let's move on.",
        score: 0.9,
        summary: '[VERDICT-0] Used symmetry well.',
        note: '[NOTE-0] drew a tree first',
      }),
    );
    mark = say(s, 'Still one half, by the same symmetry.');
    expect((await stepEvents(s, mark, 5)).map(label)).toEqual([
      'candidate:chat',
      'interviewer:feedback',
      'interviewer:question',
      'round:5',
    ]);
    last = m.of('reply').at(-1);
    if (!last) throw new Error('no reply call');
    expect(finalTurn(last).system).toContain('Follow-up: already asked');
    state = (await roundRow(id)).state;
    expect(state.questions[0]).toMatchObject({
      closedBy: 'interviewer',
      verdict: { score: 0.9, summary: '[VERDICT-0] Used symmetry well.' },
    });
    expect(posted()[1]).toMatchObject({
      text: q(1).prompt,
      id: state.questions[1]?.posedMessageId,
      kind: 'proactive',
    });
    await expectBrowserClean(id, [...s.raw, ...(await httpTexts(a, id))]);

    // Question 2: the interviewer sees it, and of question 1 only its numbers.
    m.script(
      'reply',
      turn({
        action: 'close',
        message: "Not quite, but let's move on.",
        score: 0.4,
        summary: '[VERDICT-1] Set it up, slipped on the arithmetic.',
      }),
    );
    mark = say(s, 'I get three.');
    expect((await stepEvents(s, mark, 6)).map(label)).toEqual([
      'candidate:chat',
      'interviewer:feedback',
      'interviewer:question',
      'round:6',
    ]);
    last = m.of('reply').at(-1);
    if (!last) throw new Error('no reply call');
    expect(finalTurn(last).question).toContain(q(1).prompt);
    expect(finalTurn(last).system).toMatch(/Q1 \(.*\): closed after .*, 1 hint, score 0\.90/);
    expect(finalTurn(last).user).toContain('I get three.');
    expect(requestText(last.req)).not.toContain('I think I should condition on the first roll.');

    // The last question: closing it wraps up and finishes the round; the pad stays active.
    m.script(
      'reply',
      turn({
        action: 'close',
        message: "That's right, and that was the last one. Thanks for your time.",
        score: 1,
        summary: '[VERDICT-2] Quick and right.',
      }),
    );
    mark = say(s, 'Final answer: seven.');
    expect((await stepEvents(s, mark, 7)).map(label)).toEqual([
      'candidate:chat',
      'interviewer:wrap_up',
      'round:7',
    ]);
    last = m.of('reply').at(-1);
    if (!last) throw new Error('no reply call');
    expect(finalTurn(last).system).toContain('Closing this question ends the round');
    const finished = await s.waitFor('round.updated', (e) => e.round.version === 7);
    expect(finished.round.phase).toBe('finished');
    expect(finished.round.questions.every((x) => x.closedAt !== null)).toBe(true);
    expect((await a.get(`/api/pads/${id}`)).json.pad.status).toBe('active');

    // After the round: a plain reply, no step.
    m.script('after the round', turn({ action: 'stay', message: 'You are welcome.' }));
    mark = say(s, 'Thanks!');
    await eventually(() => saidAfter(s, mark).length === 1, 10_000, 'the after-round reply');
    expect(saidAfter(s, mark)[0]).toMatchObject({ text: 'You are welcome.', intent: 'answer' });
    await rig.idle(id);
    expect((await roundRow(id)).version).toBe(7);
    await expectBrowserClean(id, [...s.raw, ...(await httpTexts(a, id))]);

    // The owner ends the pad; the assessment runs over the quant dimensions.
    expect((await a.post(`/api/pads/${id}/end`)).status).toBe(200);
    await eventually(
      async () => (await a.get(`/api/pads/${id}/report`)).json?.status === 'ready',
      15_000,
      'the report',
    );
    const report = (await a.get(`/api/pads/${id}/report`)).json;
    expect(report.assessment.scores.map((x: { dimension: string }) => x.dimension)).toEqual([
      ...QUANT_REPORT_DIMENSIONS,
    ]);
    expect(report.assessment.recommendation).toBe('lean_hire');
    expect(report.quant.path).toBe('trader');
    expect(report.quant.questions.map((x: { status: string }) => x.status)).toEqual([
      'answered',
      'answered',
      'answered',
    ]);
    expect(report.quant.questions.map((x: { verdict: unknown }) => x.verdict)).toEqual([
      { score: 0.9, summary: '[VERDICT-0] Used symmetry well.' },
      { score: 0.4, summary: '[VERDICT-1] Set it up, slipped on the arithmetic.' },
      { score: 1, summary: '[VERDICT-2] Quick and right.' },
    ]);
    expect(report.quant.questions.map((x: { hintsGiven: number }) => x.hintsGiven)).toEqual([
      1, 0, 0,
    ]);
    // Every question had a verdict: no verdict call, one assessment call that saw them all.
    expect(m.of('verdict')).toHaveLength(0);
    const assessment = m.of('assessment');
    expect(assessment).toHaveLength(1);
    for (const i of [0, 1, 2]) expect(requestText(must(assessment[0]).req)).toContain(q(i).prompt);
    expect(requestText(must(assessment[0]).req)).toContain('[NOTE-0] drew a tree first');

    expectRequestsClean(m.calls);
    expect(m.calls.every((c) => c.req.purpose === 'turn' || c.req.purpose === 'assessment')).toBe(
      true,
    );
    const rows = await storedMessages(id);
    expect(rows.map((r) => `${r.role}:${r.intent ?? 'chat'}`)).toEqual([
      'interviewer:greeting',
      'interviewer:question',
      'candidate:chat',
      'interviewer:answer',
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
      'candidate:chat',
      'interviewer:answer',
    ]);
    s.close();
  });

  // ---------------------------------------------------------------- the scratchpad

  it('reads the scratchpad into the next request, and does not speak on a scratchpad change alone', {
    timeout: 60_000,
  }, async () => {
    const { a, id, s, model: m } = await started('Scratch');
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({
      url: `${h.wsBase}/collab`,
      WebSocketPolyfill: WebSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: YDOC.name(id),
      document: doc,
      token: () => a.ticket(id),
    });
    provider.attach();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('collab sync timed out')), 10_000);
        provider.on('synced', () => {
          clearTimeout(t);
          resolve();
        });
      });
      await rig.idle(id);
      const calls = m.calls.length;
      const mark = s.events.length;
      const version = (await roundRow(id)).version;

      doc.getText(YDOC.notes).insert(0, 'SCRATCH-7f3: P(two heads) = 1/4, so the rest is 3/4');
      await eventually(() => rig.of('scratch_changed', id).length > 0, 10_000, 'scratch_changed');
      await ticks(id, 5);
      expect(rig.of('code_changed', id)).toEqual([]);
      expect(m.calls.length).toBe(calls);
      expect(saidAfter(s, mark)).toEqual([]);
      expect((await roundRow(id)).version).toBe(version);

      m.script('reply', turn({ action: 'stay', message: 'Where does the 3/4 come from?' }));
      const at = say(s, 'Have a look at my working.');
      await stepEvents(s, at, version + 1);
      const reply = m.of('reply').at(-1);
      if (!reply) throw new Error('no reply call');
      expect(finalTurn(reply).user).toContain(
        '<candidate_scratchpad>\nSCRATCH-7f3: P(two heads) = 1/4, so the rest is 3/4',
      );
      expectRequestsClean(m.calls);
    } finally {
      provider.destroy();
      socket.destroy();
      s.close();
    }
  });

  it('starts the round when the candidate comes back after the opening was cut off', {
    timeout: 60_000,
  }, async () => {
    const a = await account('Reload');
    const pad = await createRound(a);
    const id = pad.id;
    const m = a.model;
    m.script('opening', { hang: true });
    const first = await openEvents(a, id);
    const opening = await m.next('opening', 0, 15_000);
    // The page reloads mid-opening: the last socket closes and the interviewer lets the pad go.
    first.close();
    await eventually(() => opening.aborted, 10_000, 'the opening aborted');
    expect((await roundRow(id)).version).toBe(0);

    const s = await openEvents(a, id);
    await s.waitFor('round.updated', (e) => e.round.version === 1, 15_000);
    expect(s.events.filter(shown).map(label)).toEqual([
      'round:0',
      'interviewer:greeting',
      'interviewer:question',
      'round:1',
    ]);
    expect(m.of('opening')).toHaveLength(2);
    expect(rig.of('session_started', id)).toHaveLength(1);
    await ticks(id, 5);
    expect((await storedMessages(id)).filter((r) => r.intent === 'greeting')).toHaveLength(1);
    expectRequestsClean(m.calls);
    s.close();
  });

  // ---------------------------------------------------------------- the clock

  it('nudges once at the budget, closes for time without a model, and finishes on the round clock', {
    timeout: 90_000,
  }, async () => {
    const { a, id, s, model: m, pad } = await started('Clock');
    let state = (await roundRow(id)).state;
    const q0 = state.questions[0];
    if (!q0?.posedAt || !q0.budgetSec) throw new Error('not posed');
    const posedAt = Date.parse(q0.posedAt);
    const budgetMs = q0.budgetSec * 1000;
    const graceMs = quantGraceSec(q0.budgetSec) * 1000;
    expect(graceMs).toBe(90_000);

    // Just short of the budget: nothing.
    await clock.advanceTo(posedAt + budgetMs - 20_000);
    await ticks(id);
    expect(m.of('nudge', 'timeout')).toHaveLength(0);

    // The budget is up: one nudge, from a tick.
    m.script(
      'nudge',
      turn({ action: 'stay', message: 'We are at time on this one. Best answer?' }),
    );
    let mark = s.events.length;
    await clock.advanceTo(posedAt + budgetMs + 1_000);
    expect((await stepEvents(s, mark, 2)).map(label)).toEqual([
      'interviewer:time_check',
      'round:2',
    ]);
    expect(saidAfter(s, mark)[0]).toMatchObject({
      text: 'We are at time on this one. Best answer?',
      kind: 'proactive',
    });
    expect((await roundRow(id)).state.questions[0]?.nudgedAt).toEqual(expect.any(String));

    // Never a second one: more ticks, and more time inside the grace.
    await ticks(id, 5);
    await clock.advance(30_000);
    await ticks(id, 5);
    await clock.advance(30_000);
    await ticks(id, 5);
    expect(m.of('nudge')).toHaveLength(1);
    expect(saidAfter(s, mark).filter((x) => x.intent === 'time_check')).toHaveLength(1);
    expect((await roundRow(id)).version).toBe(2);

    // Budget and grace are up and the model fails: a canned close, no verdict, question 2 posted.
    m.script('timeout', { error: 'transient' });
    mark = s.events.length;
    await clock.advanceTo(posedAt + budgetMs + graceMs + 1_000);
    expect((await stepEvents(s, mark, 3)).map(label)).toEqual([
      'interviewer:feedback',
      'interviewer:question',
      'round:3',
    ]);
    expect(m.of('timeout')).toHaveLength(1);
    expect(saidAfter(s, mark)[0]).toMatchObject({ text: CANNED_TIMEOUT, kind: 'proactive' });
    state = (await roundRow(id)).state;
    expect(state.questions[0]).toMatchObject({ closedBy: 'timeout', verdict: null });
    const q1 = state.questions[1];
    expect(saidAfter(s, mark)[1]).toMatchObject({
      intent: 'question',
      text: q1 ? BANK.get(q1.questionId)?.prompt : 'missing',
    });

    // The round's clock runs out with question 2 open: it is closed and the round finishes.
    m.script(
      'round time',
      turn({
        action: 'close',
        message: "We're out of time for the round. Thanks for working through these.",
        score: 0.2,
        summary: '[VERDICT-1] Little progress before time.',
      }),
    );
    mark = s.events.length;
    const endsAt = quantRoundEndsAt(pad.startedAt, 20).getTime();
    await clock.advanceTo(endsAt + 1_000);
    expect((await stepEvents(s, mark, 4)).map(label)).toEqual(['interviewer:wrap_up', 'round:4']);
    state = (await roundRow(id)).state;
    expect(state.questions.map((x) => x.closedBy)).toEqual(['timeout', 'round_time', null]);
    expect(state.questions[1]?.verdict).toEqual({
      score: 0.2,
      summary: '[VERDICT-1] Little progress before time.',
    });
    expect(state.questions[2]?.posedAt).toBeNull();
    const detail = await a.get(`/api/pads/${id}`);
    expect(detail.json.pad.status).toBe('active');
    expect(detail.json.round.phase).toBe('finished');

    // And nothing more from the clock.
    const after = m.calls.length;
    await clock.advance(60_000);
    await ticks(id, 5);
    expect(m.calls.slice(after).filter((c) => c.task !== 'stall')).toEqual([]);
    expect((await roundRow(id)).version).toBe(4);

    await expectBrowserClean(id, [...s.raw, ...(await httpTexts(a, id))]);

    // Ended: the assessment judges the question closed for time (the only one without a verdict).
    m.script('verdict', JSON.stringify({ score: 0.1, summary: '[LATE-0] Ran out of time.' }));
    expect((await a.post(`/api/pads/${id}/end`)).status).toBe(200);
    await eventually(
      async () => (await a.get(`/api/pads/${id}/report`)).json?.status === 'ready',
      15_000,
      'the report',
    );
    const report = (await a.get(`/api/pads/${id}/report`)).json;
    expect(report.quant.questions.map((x: { status: string }) => x.status)).toEqual([
      'timed_out',
      'unfinished',
      'not_reached',
    ]);
    expect(report.quant.questions.map((x: { verdict: unknown }) => x.verdict)).toEqual([
      { score: 0.1, summary: '[LATE-0] Ran out of time.' },
      { score: 0.2, summary: '[VERDICT-1] Little progress before time.' },
      null,
    ]);
    expect(m.of('verdict')).toHaveLength(1);
    expect(requestText(must(m.of('verdict')[0]).req)).toContain('closed for time');
    expect(m.of('assessment')).toHaveLength(1);
    expectRequestsClean(m.calls);
    s.close();
  });

  it('runs the clock without a key: canned opening, nudge and close, never a model call', {
    timeout: 60_000,
  }, async () => {
    const a = await account('Keyless');
    const pad = await createRound(a);
    const id = pad.id;
    expect((await a.del('/api/ai-key')).status).toBe(200);
    const s = await openEvents(a, id);
    await s.waitFor('round.updated', (e) => e.round.version === 1, 15_000);
    expect(saidAfter(s, 0).map((x) => x.intent)).toEqual(['greeting', 'question']);
    expect(saidAfter(s, 0)[0]?.text).toMatch(/^Welcome\. I'll ask you a few quant questions/);

    // A message gets no answer without a key; the clock still runs the round.
    let mark = say(s, 'Hello? Is anyone there?');
    await ticks(id, 3);
    expect(saidAfter(s, mark)).toEqual([]);
    const q0 = (await roundRow(id)).state.questions[0];
    if (!q0?.posedAt || !q0.budgetSec) throw new Error('not posed');
    const posedAt = Date.parse(q0.posedAt);
    mark = s.events.length;
    await clock.advanceTo(posedAt + q0.budgetSec * 1000 + 1_000);
    expect((await stepEvents(s, mark, 2)).map(label)).toEqual([
      'interviewer:time_check',
      'round:2',
    ]);
    expect(saidAfter(s, mark)[0]?.text).toBe(
      "We're at the time I'd planned for this one. What's your best answer?",
    );
    mark = s.events.length;
    await clock.advanceTo(posedAt + (q0.budgetSec + quantGraceSec(q0.budgetSec)) * 1000 + 1_000);
    expect((await stepEvents(s, mark, 3)).map(label)).toEqual([
      'interviewer:feedback',
      'interviewer:question',
      'round:3',
    ]);
    expect(saidAfter(s, mark)[0]?.text).toBe(CANNED_TIMEOUT);
    expect((await roundRow(id)).state.questions[0]).toMatchObject({
      closedBy: 'timeout',
      verdict: null,
    });
    expect(a.model.calls).toEqual([]);
    await expectBrowserClean(id, [...s.raw, ...(await httpTexts(a, id))]);
    s.close();
  });

  it('answers a candidate message that arrives while a timeout turn is in flight, and closes once', {
    timeout: 60_000,
  }, async () => {
    const { a, id, s, model: m } = await started('Race');
    const q0 = (await roundRow(id)).state.questions[0];
    if (!q0?.posedAt || !q0.budgetSec) throw new Error('not posed');
    const due = Date.parse(q0.posedAt) + (q0.budgetSec + quantGraceSec(q0.budgetSec)) * 1000;

    m.script('timeout', { hang: true });
    const from = m.calls.length;
    await clock.advanceTo(due + 1_000);
    const timeout = await m.next('timeout', from);
    expect(timeout.done).toBe(false);

    // The model ignores the instruction to close: the turn is a close for time all the same.
    m.script(
      'reply',
      turn({
        action: 'stay',
        message: "Thanks, that's time on this one.",
        score: 0.7,
        summary: '[VERDICT-0] Got there, late.',
      }),
    );
    const mark = say(s, 'My final answer is one third.');
    expect((await stepEvents(s, mark, 2)).map(label)).toEqual([
      'candidate:chat',
      'interviewer:feedback',
      'interviewer:question',
      'round:2',
    ]);
    expect(timeout.aborted).toBe(true);
    const reply = m.of('reply').at(-1);
    if (!reply) throw new Error('no reply call');
    expect(finalTurn(reply).system).toContain('this turn must close it');
    expect(finalTurn(reply).user).toContain('My final answer is one third.');
    expect(saidAfter(s, mark)[0]).toMatchObject({
      text: "Thanks, that's time on this one.",
      kind: 'chat',
    });
    const state = (await roundRow(id)).state;
    expect(state.questions[0]).toMatchObject({
      closedBy: 'timeout',
      verdict: { score: 0.7, summary: '[VERDICT-0] Got there, late.' },
    });
    expect(
      rig
        .quantTraces(id)
        .filter((t) => t.trigger === 'timeout')
        .map((t) => t.outcome),
    ).toEqual(['discarded']);

    // Closed once: nothing else for question 1, and question 2's clock is fresh.
    await ticks(id, 5);
    expect(m.of('timeout')).toHaveLength(1);
    expect(saidAfter(s, mark).filter((x) => x.intent === 'feedback')).toHaveLength(1);
    expect((await roundRow(id)).version).toBe(2);
    expectRequestsClean(m.calls);
    await expectBrowserClean(id, [...s.raw, ...(await httpTexts(a, id))]);
    s.close();
  });

  it('lets a reply sent once the budget is up carry the nudge, with no separate one', {
    timeout: 60_000,
  }, async () => {
    const { a, id, s, model: m } = await started('Carry');
    const q0 = (await roundRow(id)).state.questions[0];
    if (!q0?.posedAt || !q0.budgetSec) throw new Error('not posed');

    // A reply is in flight when the budget runs out, and the candidate writes again meanwhile.
    m.script('reply', { hang: true });
    const from = m.calls.length;
    const markA = say(s, 'CARRY-A: let me think about the expectation.');
    const first = await m.next('reply', from);
    await clock.advanceTo(Date.parse(q0.posedAt) + q0.budgetSec * 1000 + 1_000);
    const markB = say(s, 'CARRY-B: I think it is 3.5.');
    await eventually(
      () => s.events.slice(markB).some((e) => e.type === 'message.created'),
      10_000,
      'the second message',
    );
    // The reply in flight holds the pump: the ticks find nothing to do.
    await ticks(id, 3, false);
    expect(m.of('nudge')).toHaveLength(0);
    first.release(turn({ action: 'stay', message: 'Go on.' }));
    await stepEvents(s, markA, 2);

    // The next reply says the budget is up itself; the tick has nothing left to nudge.
    m.script(
      'reply',
      turn({ action: 'stay', message: "We're at time; is 3.5 your final answer?" }),
    );
    await stepEvents(s, markB, 3);
    const carried = m.of('reply').at(-1);
    if (!carried) throw new Error('no reply call');
    expect(finalTurn(carried).system).toContain("time budget is up and you haven't said so yet");
    expect(finalTurn(carried).user).toContain('CARRY-B: I think it is 3.5.');
    expect(saidAfter(s, markB).at(-1)).toMatchObject({
      text: "We're at time; is 3.5 your final answer?",
      intent: 'time_check',
      kind: 'chat',
    });
    expect((await roundRow(id)).state.questions[0]?.nudgedAt).toEqual(expect.any(String));
    await clock.advance(10_000);
    await ticks(id, 5);
    expect(m.of('nudge')).toHaveLength(0);
    expect((await storedMessages(id)).filter((r) => r.intent === 'time_check')).toHaveLength(1);
    expectRequestsClean(m.calls);
    await expectBrowserClean(id, [...s.raw, ...(await httpTexts(a, id))]);
    s.close();
  });

  it('keeps answering hints when the bank’s hint ladder changes mid-round', {
    timeout: 60_000,
  }, async () => {
    const { id, s, model: m } = await started('Ladder');
    const q0 = (await roundRow(id)).state.questions[0];
    if (!q0) throw new Error('not posed');
    const k = q0.questionId.slice('qreal-'.length);
    const original = QuizQuestion.parse(BANK.get(q0.questionId));
    if (original.type !== 'short' && original.type !== 'numeric') throw new Error('fixture');
    // A deploy re-seeds the bank while the round is on: the question now has a third hint.
    const grown = { ...original, hints: [...original.hints, `[HINT-${k}-3] look hardest`] };
    await db()
      .update(quizQuestions)
      .set({ data: grown })
      .where(eq(quizQuestions.id, q0.questionId));
    try {
      for (const [i, rung] of [1, 2, 3].entries()) {
        m.script(
          'reply',
          turn({ action: 'hint', hint_rung: rung, message: `Hint number ${rung}.` }),
        );
        const mark = say(s, `Another hint, please (${rung}).`);
        await eventually(() => saidAfter(s, mark).length === 1, 10_000, `a reply to hint ${rung}`);
        expect(saidAfter(s, mark)[0]).toMatchObject({
          text: `Hint number ${rung}.`,
          intent: 'hint',
        });
        await s.waitFor('round.updated', (e) => e.round.version === i + 2);
      }
      // The round was built with two authored hints: a third is in the interviewer's own words.
      expect((await roundRow(id)).state.questions[0]?.hintRungs).toEqual([1, 2, 0]);
      expect(requestText(must(m.of('reply').at(-1)).req)).not.toContain(`[HINT-${k}-3]`);
    } finally {
      await db()
        .update(quizQuestions)
        .set({ data: original })
        .where(eq(quizQuestions.id, q0.questionId));
    }
    s.close();
  });

  // ---------------------------------------------------------------- ending mid-question

  it('ends mid-question; the assessment judges the open question and the report shows it unfinished', {
    timeout: 60_000,
  }, async () => {
    const { a, id, s, model: m } = await started('Ender');
    m.script(
      'reply',
      turn({
        action: 'close',
        message: "That's right. Let's move on.",
        score: 0.8,
        summary: '[VERDICT-0] Right.',
      }),
      turn({ action: 'stay', message: 'Keep going.' }),
      { hang: true },
    );
    let mark = say(s, 'The answer is two.');
    await stepEvents(s, mark, 2);
    mark = say(s, 'For this one I would set up a recursion on the first toss.');
    await stepEvents(s, mark, 3);
    await rig.idle(id);
    await expectBrowserClean(id, [...s.raw, ...(await httpTexts(a, id))]);

    // The pad is ended while the interviewer is answering the candidate's latest message.
    const from = m.calls.length;
    say(s, 'So the recursion gives E = 1 + E/2.');
    const inFlight = await m.next('reply', from);
    m.script('verdict', JSON.stringify({ score: 0.35, summary: '[LATE-1] On track, unfinished.' }));
    mark = s.events.length;
    expect((await a.post(`/api/pads/${id}/end`)).status).toBe(200);
    const ended = await s.waitFor('round.updated', (e) => e.round.version === 4);
    await eventually(() => inFlight.aborted, 10_000, 'the reply aborted');
    expect(ended.round.phase).toBe('finished');
    await eventually(
      async () => (await a.get(`/api/pads/${id}/report`)).json?.status === 'ready',
      15_000,
      'the report',
    );
    const state = (await roundRow(id)).state;
    expect(state.questions.map((x) => x.closedBy)).toEqual(['interviewer', 'ended', null]);
    expect(state.questions[1]?.verdict).toEqual({
      score: 0.35,
      summary: '[LATE-1] On track, unfinished.',
    });
    const report = (await a.get(`/api/pads/${id}/report`)).json;
    expect(report.quant.questions.map((x: { status: string }) => x.status)).toEqual([
      'answered',
      'unfinished',
      'not_reached',
    ]);
    expect(report.quant.questions.map((x: { verdict: unknown }) => x.verdict)).toEqual([
      { score: 0.8, summary: '[VERDICT-0] Right.' },
      { score: 0.35, summary: '[LATE-1] On track, unfinished.' },
      null,
    ]);
    expect(report.assessment.scores.map((x: { dimension: string }) => x.dimension)).toEqual([
      ...QUANT_REPORT_DIMENSIONS,
    ]);
    expect(JSON.stringify(report)).not.toContain('[HINT-');
    // Both judged questions are now the candidate's quiz answers: the live verdict, and the one
    // the assessment gave, each with what was said while the question was open.
    const answers = await db()
      .select()
      .from(quantRoundAnswers)
      .where(eq(quantRoundAnswers.padId, id))
      .orderBy(asc(quantRoundAnswers.answeredAt));
    expect(answers.map((x) => [x.questionId, x.score, x.feedback, x.response])).toEqual([
      [
        state.questions[0]?.questionId,
        0.8,
        '[VERDICT-0] Right.',
        { type: 'short', text: 'The answer is two.' },
      ],
      [
        state.questions[1]?.questionId,
        0.35,
        '[LATE-1] On track, unfinished.',
        {
          type: 'short',
          text: 'For this one I would set up a recursion on the first toss.\n\nSo the recursion gives E = 1 + E/2.',
        },
      ],
    ]);
    const bank = await a.get(`/api/quiz/questions/${state.questions[1]?.questionId}`);
    expect(bank.json).toMatchObject({ status: 'partial', score: 0.35 });

    // One verdict call, for the open question only, with its conversation and not question 3.
    const verdicts = m.of('verdict');
    expect(verdicts).toHaveLength(1);
    const v = requestText(must(verdicts[0]).req);
    const id1 = state.questions[1]?.questionId ?? '';
    expect(v).toContain(promptMarker(id1));
    expect(v).toContain('set up a recursion on the first toss');
    expect(v).toContain('So the recursion gives E = 1 + E/2.');
    expect(v).toContain('open when the pad was ended');
    expect(m.of('assessment')).toHaveLength(1);
    // Nothing was said after the pad ended.
    expect(saidAfter(s, mark)).toEqual([]);
    expectRequestsClean(m.calls);
    s.close();
  });

  // ---------------------------------------------------------------- model failures

  it('answers a failed, refused or unparseable turn with a canned reply and no step; the round goes on', {
    timeout: 60_000,
  }, async () => {
    const { id, s, model: m } = await started('Failing');
    const cases: [Parameters<ScriptedModel['script']>[1], string][] = [
      [{ error: 'transient' }, CANNED_FAILED],
      [{ refused: true }, CANNED_REFUSED],
      ['{"action": "stay", "message": "unterminated', CANNED_FAILED],
      [turn({ action: 'stay', message: '' }), CANNED_FAILED],
    ];
    for (const [reply, canned] of cases) {
      m.script('reply', reply);
      const mark = say(s, `Attempt ${canned.length}`);
      await eventually(() => saidAfter(s, mark).length === 1, 10_000, 'the canned reply');
      expect(saidAfter(s, mark)[0]).toMatchObject({ text: canned, intent: 'answer' });
      await rig.idle(id);
      expect((await roundRow(id)).version).toBe(1);
      expect(
        s.events.slice(mark).some((e) => e.type === 'round.updated'),
        'no round change',
      ).toBe(false);
    }
    const state = (await roundRow(id)).state;
    expect(state.questions[0]).toMatchObject({
      hintRungs: [],
      followUpAsked: false,
      closedAt: null,
    });

    m.script('reply', turn({ action: 'hint', hint_rung: 1, message: 'Try a smaller case.' }));
    const mark = say(s, 'Still stuck, a hint?');
    expect((await stepEvents(s, mark, 2)).map(label)).toEqual([
      'candidate:chat',
      'interviewer:hint',
      'round:2',
    ]);
    expect((await roundRow(id)).state.questions[0]?.hintRungs).toEqual([1]);
    expectRequestsClean(m.calls);
    s.close();
  });

  // ---------------------------------------------------------------- a restart

  it('after a restart: no second greeting, no second nudge, and the question’s context intact', {
    timeout: 60_000,
  }, async () => {
    const { a, id, s, model: m } = await started('Restart');
    m.script(
      'reply',
      turn({ action: 'stay', message: 'What is your sample space?' }),
      turn({ action: 'hint', hint_rung: 1, message: 'Think about the complement.' }),
    );
    let mark = say(s, 'RESTART-A: I will list the outcomes.');
    await stepEvents(s, mark, 2);
    mark = say(s, 'RESTART-B: I am stuck.');
    await stepEvents(s, mark, 3);
    const q0 = (await roundRow(id)).state.questions[0];
    if (!q0?.posedAt || !q0.budgetSec) throw new Error('not posed');
    m.script('nudge', turn({ action: 'stay', message: 'RESTART-NUDGE: best answer?' }));
    mark = s.events.length;
    await clock.advanceTo(Date.parse(q0.posedAt) + q0.budgetSec * 1000 + 1_000);
    await stepEvents(s, mark, 4);

    // A new interviewer over the same database, mid-question.
    rig.restart();
    const calls = m.calls.length;
    mark = s.events.length;
    await ticks(id, 5);
    // A key saved again raises session_started in the open pad: still no second greeting.
    const starts = rig.of('session_started', id).length;
    await a.saveKey(a.apiKey);
    await eventually(
      () => rig.of('session_started', id).length > starts,
      10_000,
      'session_started',
    );
    await ticks(id, 5);
    await clock.advance(20_000);
    await ticks(id, 5);
    expect(m.calls.slice(calls).filter((c) => c.task !== 'stall')).toEqual([]);
    expect(saidAfter(s, mark)).toEqual([]);
    expect((await roundRow(id)).version).toBe(4);
    // A greeting moment the new interviewer may have raised was dropped: the round has started.
    expect(
      rig
        .quantTraces(id)
        .filter((t) => t.generation === 1 && t.trigger === 'opening' && t.outcome !== 'dropped'),
    ).toEqual([]);

    m.script('reply', turn({ action: 'stay', message: 'Is that your final answer?' }));
    mark = say(s, 'RESTART-C: is it one half?');
    expect((await stepEvents(s, mark, 5)).map(label)).toEqual([
      'candidate:chat',
      'interviewer:answer',
      'round:5',
    ]);
    const reply = m.of('reply').at(-1);
    if (!reply) throw new Error('no reply call');
    const f = finalTurn(reply);
    const text = requestText(reply.req);
    expect(f.question).toContain(promptMarker(q0.questionId));
    expect(f.question).toContain(`[HINT-${q0.questionId.slice(6)}-2]`);
    for (const said of [
      'RESTART-A: I will list the outcomes.',
      'What is your sample space?',
      'RESTART-B: I am stuck.',
      'Think about the complement.',
      'RESTART-NUDGE: best answer?',
    ])
      expect(text, said).toContain(said);
    expect(f.user).toContain('RESTART-C: is it one half?');
    expect(f.system).toContain('You have already told them its time is up.');
    expect(f.system).toContain('Hints: 1 of 2 authored rungs given');
    expect(m.of('opening')).toHaveLength(1);
    expect(m.of('nudge')).toHaveLength(1);
    const rows = await storedMessages(id);
    expect(rows.filter((r) => r.intent === 'greeting')).toHaveLength(1);
    expect(rows.filter((r) => r.intent === 'time_check')).toHaveLength(1);
    expectRequestsClean(m.calls);
    await expectBrowserClean(id, [...s.raw, ...(await httpTexts(a, id))]);
    s.close();
  });

  // ---------------------------------------------------------------- coding pads

  it('leaves a coding pad as it was: a streamed greeting and a streamed reply', {
    timeout: 60_000,
  }, async () => {
    const a = await account('Coder');
    const pad = (await a.post('/api/pads', { problemSlug: 'two-sum', language: 'python' })).json;
    expect(pad.format).toBe('coding');
    const m = a.model;
    const s = await openEvents(a, pad.id);
    const greeting = await s.waitFor(
      'message.created',
      (e) => e.message.intent === 'greeting',
      15_000,
    );
    expect(greeting.message.text).toBe(
      'Hi! Take a look at the problem and tell me your first thoughts.',
    );
    m.script('coding:reply', 'A hash map sounds right. What would you store in it?');
    const mark = say(s, 'I would use a hash map.');
    const reply = await s.waitFor(
      'message.created',
      (e) => e.message.role === 'interviewer' && e.message.intent !== 'greeting',
      15_000,
    );
    expect(reply.message.text).toBe('A hash map sounds right. What would you store in it?');
    expect(s.events.slice(mark).some((e) => e.type === 'message.delta')).toBe(true);
    expect(s.events.some((e) => e.type === 'round.updated')).toBe(false);
    expect(m.calls.map((c) => c.task).filter((t) => t !== 'coding:decision')).toEqual([
      'coding:greeting',
      'coding:reply',
    ]);
    expect(m.calls.every((c) => c.req.purpose !== 'turn')).toBe(true);
    const replyReq = m.of('coding:reply')[0]?.req;
    if (!replyReq) throw new Error('no reply call');
    expect(requestText(replyReq)).toContain('Two Sum');
    expect(requestText(replyReq)).toContain('I would use a hash map.');
    expect(requestText(replyReq)).not.toContain('live quantitative interview');
    const detail = await a.get(`/api/pads/${pad.id}`);
    expect(detail.json.round).toBeNull();
    expect(rig.quantTraces(pad.id)).toEqual([]);
    s.close();
  });
});
