import { generateScaffolds, type Message, type PadDetail, type Run } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { activeRun, chatItems, initPadState, padReducer } from './state';

const PAD = '00000000-0000-4000-8000-000000000001';
const sig = {
  className: 'Solution',
  kind: 'function' as const,
  ctorParams: [],
  methods: [{ name: 'f', params: [], returns: 'int' as const, compare: 'exact' as const }],
};
const detail: PadDetail = {
  pad: {
    id: PAD,
    ownerId: 'me',
    title: 'T',
    problemSlug: 'two-sum',
    language: 'cpp',
    status: 'active',
    durationMin: 45,
    interviewer: { enabled: true, style: 'neutral', proactivity: 'normal', voice: false },
    shareToken: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
  },
  role: 'owner',
  problem: {
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'easy',
    tags: [],
    statement: '',
    signature: sig,
    limits: { timeMs: 1000, memoryMb: 256 },
    sampleTests: [],
    hiddenTestCount: 0,
    scaffolds: generateScaffolds(sig),
  },
  messages: [],
  runs: [],
  interviewerAvailable: true,
  interviewerKey: 'active',
};
const msg = (over: Partial<Message>): Message => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  padId: PAD,
  role: 'interviewer',
  kind: 'chat',
  intent: null,
  text: 'hi',
  via: 'text',
  userId: null,
  createdAt: '2026-01-01T00:01:00.000Z',
  ...over,
});
const run = (over: Partial<Run>): Run => ({
  id: '00000000-0000-4000-8000-0000000000r1'.replace('r1', 'b1'),
  padId: PAD,
  userId: 'me',
  mode: 'samples',
  language: 'cpp',
  status: 'queued',
  verdict: null,
  compile: null,
  file: null,
  tests: [],
  passed: 0,
  total: 0,
  message: null,
  createdAt: '2026-01-01T00:02:00.000Z',
  finishedAt: null,
  ...over,
});

describe('padReducer', () => {
  it('follows the pad owner key: missing -> active -> rejected', () => {
    let s = initPadState(
      { ...detail, interviewerAvailable: false, interviewerKey: 'missing' },
      'me',
    );
    expect(s).toMatchObject({ interviewerKey: 'missing', interviewerAvailable: false });
    s = padReducer(s, { type: 'event', event: { type: 'interviewer.status', key: 'active' } });
    expect(s).toMatchObject({ interviewerKey: 'active', interviewerAvailable: true });
    s = padReducer(s, { type: 'event', event: { type: 'interviewer.thinking', active: true } });
    s = padReducer(s, { type: 'event', event: { type: 'interviewer.status', key: 'rejected' } });
    expect(s).toMatchObject({
      interviewerKey: 'rejected',
      interviewerAvailable: false,
      thinking: false,
    });
  });

  it('accumulates deltas and finalizes on message.created with the same id', () => {
    let s = initPadState(detail, 'me');
    s = padReducer(s, { type: 'event', event: { type: 'interviewer.thinking', active: true } });
    s = padReducer(s, {
      type: 'event',
      event: { type: 'message.delta', messageId: msg({}).id, delta: 'Hel' },
    });
    s = padReducer(s, {
      type: 'event',
      event: { type: 'message.delta', messageId: msg({}).id, delta: 'lo' },
    });
    expect(s.streaming[msg({}).id]?.text).toBe('Hello');
    expect(chatItems(s).at(-1)).toMatchObject({ kind: 'streaming', text: 'Hello' });
    s = padReducer(s, {
      type: 'event',
      event: { type: 'message.created', message: msg({ text: 'Hello' }) },
    });
    expect(s.streaming).toEqual({});
    expect(s.messages).toHaveLength(1);
    expect(s.thinking).toBe(false);
  });

  it('ignores late deltas for a message that is already final', () => {
    let s = initPadState(detail, 'me');
    s = padReducer(s, { type: 'event', event: { type: 'message.created', message: msg({}) } });
    s = padReducer(s, {
      type: 'event',
      event: { type: 'message.delta', messageId: msg({}).id, delta: 'x' },
    });
    expect(s.streaming).toEqual({});
  });

  it('replaces the optimistic copy when our own message is echoed', () => {
    let s = initPadState(detail, 'me');
    s = padReducer(s, {
      type: 'pending.add',
      message: {
        localId: 'l1',
        text: 'Is it sorted?',
        via: 'text',
        createdAt: '2026-01-01T00:03:00.000Z',
        status: 'sending',
      },
    });
    expect(chatItems(s).at(-1)).toMatchObject({ kind: 'pending' });
    s = padReducer(s, {
      type: 'event',
      event: {
        type: 'message.created',
        message: msg({ role: 'candidate', userId: 'me', text: 'Is it sorted? ' }),
      },
    });
    expect(s.pending).toHaveLength(0);
    expect(s.messages).toHaveLength(1);
  });

  it('keeps a collaborator message without touching our pending ones', () => {
    let s = initPadState(detail, 'me');
    s = padReducer(s, {
      type: 'pending.add',
      message: {
        localId: 'l1',
        text: 'same',
        via: 'text',
        createdAt: '2026-01-01T00:03:00.000Z',
        status: 'sending',
      },
    });
    s = padReducer(s, {
      type: 'event',
      event: {
        type: 'message.created',
        message: msg({ role: 'candidate', userId: 'other', text: 'same' }),
      },
    });
    expect(s.pending).toHaveLength(1);
  });

  it('never regresses a finished run when a stale snapshot arrives later', () => {
    let s = initPadState(detail, 'me');
    const finished = run({
      status: 'finished',
      verdict: 'accepted',
      finishedAt: '2026-01-01T00:02:05.000Z',
    });
    s = padReducer(s, { type: 'event', event: { type: 'run.finished', run: finished } });
    s = padReducer(s, { type: 'run.upsert', run: run({}) }); // POST response arriving after the WS result
    expect(s.runs[0]?.status).toBe('finished');
    expect(activeRun(s)).toBeUndefined();
    s = padReducer(s, {
      type: 'event',
      event: { type: 'run.progress', runId: finished.id, event: { type: 'compiling' } },
    });
    expect(s.progress[finished.id]).toBeUndefined();
  });

  it('tracks progress phases and streams file output', () => {
    let s = initPadState(detail, 'me');
    const r = run({ mode: 'file' });
    s = padReducer(s, { type: 'run.upsert', run: r });
    expect(activeRun(s)?.id).toBe(r.id);
    s = padReducer(s, {
      type: 'event',
      event: { type: 'run.progress', runId: r.id, event: { type: 'compiling' } },
    });
    expect(s.progress[r.id]?.phase).toBe('compiling');
    s = padReducer(s, {
      type: 'event',
      event: {
        type: 'run.progress',
        runId: r.id,
        event: { type: 'output', stream: 'stdout', chunk: 'a\n' },
      },
    });
    s = padReducer(s, {
      type: 'event',
      event: {
        type: 'run.progress',
        runId: r.id,
        event: { type: 'output', stream: 'stdout', chunk: 'b\n' },
      },
    });
    expect(s.progress[r.id]?.stdout).toBe('a\nb\n');
    s = padReducer(s, {
      type: 'event',
      event: { type: 'run.progress', runId: r.id, event: { type: 'running', done: 1, total: 4 } },
    });
    expect(s.progress[r.id]).toMatchObject({ phase: 'running', done: 1, total: 4 });
  });

  it('applies pad.updated and records server errors', () => {
    let s = initPadState(detail, 'me');
    s = padReducer(s, {
      type: 'event',
      event: { type: 'pad.updated', pad: { ...detail.pad, language: 'java' } },
    });
    expect(s.pad.language).toBe('java');
    s = padReducer(s, {
      type: 'event',
      event: { type: 'error', code: 'rate_limited', message: 'Slow down' },
    });
    expect(s.serverError?.code).toBe('rate_limited');
  });
});

describe('chat order', () => {
  it('keeps arrival order even when the server clock is behind', () => {
    let s = initPadState(detail, 'me');
    s = padReducer(s, {
      type: 'pending.add',
      message: {
        localId: 'l1',
        text: 'Should I use a map?',
        via: 'text',
        createdAt: '2026-01-01T10:00:00.000Z',
        status: 'sending',
      },
    });
    s = padReducer(s, {
      type: 'event',
      event: { type: 'message.delta', messageId: msg({}).id, delta: 'Yes' },
    });
    s = padReducer(s, {
      type: 'event',
      event: {
        type: 'message.created',
        message: msg({ text: 'Yes', createdAt: '2026-01-01T09:59:00.000Z' }),
      },
    });
    const items = chatItems(s);
    expect(items.map((i) => i.kind)).toEqual(['pending', 'message']);
    // the echo of our message replaces the optimistic copy in place
    s = padReducer(s, {
      type: 'event',
      event: {
        type: 'message.created',
        message: msg({
          id: '00000000-0000-4000-8000-0000000000bb',
          role: 'candidate',
          userId: 'me',
          text: 'Should I use a map?',
          createdAt: '2026-01-01T09:58:00.000Z',
        }),
      },
    });
    expect(chatItems(s).map((i) => (i.kind === 'message' ? i.message.role : i.kind))).toEqual([
      'candidate',
      'interviewer',
    ]);
  });
});
