/**
 * Interview rooms: the owner hosts, candidates join by the invite link (a name is enough), the
 * AI stays out of the conversation, and everything under "host" is the host's alone.
 */

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  BLANK_SCAFFOLDS,
  HostView,
  InviteInfo,
  JUDGE_KEYS,
  PadDetail,
  PadProblem,
  Playback,
  Report,
  SolutionReview,
  YDOC,
} from '@ipp/contracts';
import { padMembers, pads, runs, user } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { DEFAULT_LIMITS } from '../src/config';
import { FakeJudge } from './helpers/fake-judge';
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

let h: Harness;
let fake: FakeInterviewer;
let judge: FakeJudge;
let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

beforeAll(async () => {
  await flushRedis();
  fake = new FakeInterviewer();
  h = await startApi({ fake });
  judge = new FakeJudge();
  await judge.start();
});
afterAll(async () => {
  await judge?.stop();
  await h?.stop();
});
beforeEach(() => {
  h.api.ctx.config.limits = structuredClone(DEFAULT_LIMITS);
});

/** A host with an account and a room; `key` saves an AI key for them. */
async function room(body: Record<string, unknown> = { problemSlug: 'two-sum' }, key = false) {
  const host = new Client(h.base, nextIp());
  const me = await host.signUp('Hana');
  if (key) await host.saveKey();
  const res = await host.post('/api/pads', { kind: 'room', language: 'python', ...body });
  expect(res.status).toBe(200);
  return { host, hostId: me.id, pad: res.json };
}

/** Someone with no account who opens the invite link and types a name. */
async function guest(shareToken: string, name = 'Casey') {
  const c = new Client(h.base, nextIp());
  const res = await c.post('/api/pads/join-guest', { shareToken, name });
  return { c, res };
}

async function openDoc(c: Client, padId: string) {
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url: `${h.wsBase}/collab`,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: YDOC.name(padId),
    document: doc,
    token: () => c.ticket(padId).catch(() => 'gone'),
  });
  provider.attach();
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('collab sync timed out')), 10_000);
    provider.on('synced', () => {
      clearTimeout(t);
      resolve();
    });
    provider.on('authenticationFailed', ({ reason }: { reason: string }) =>
      reject(new Error(`auth failed: ${reason}`)),
    );
  });
  return {
    doc,
    close() {
      provider.destroy();
      socket.destroy();
    },
  };
}

const events = async (c: Client, padId: string) =>
  EventSocket.open(`${h.wsBase}/ws/pads/${padId}?ticket=${await c.ticket(padId)}`);

describe('creating a room', () => {
  it('has no AI in the conversation, and may start blank', async () => {
    const { host, pad } = await room({
      problemSlug: 'two-sum',
      interviewer: { enabled: true, style: 'tough', proactivity: 'high', voice: true },
    });
    expect(pad).toMatchObject({ kind: 'room', problemSlug: 'two-sum', title: 'Two Sum' });
    expect(pad.interviewer).toMatchObject({ enabled: false, voice: false });
    expect(pad.shareToken).toEqual(expect.any(String));
    // ...and it cannot be switched on later.
    const patched = await host.patch(`/api/pads/${pad.id}`, { interviewer: { enabled: true } });
    expect(patched.json.interviewer.enabled).toBe(false);

    const blank = await host.post('/api/pads', { kind: 'room', language: 'cpp', blank: true });
    expect(blank.json).toMatchObject({ kind: 'room', problemSlug: null, title: 'Interview room' });
    const detail = PadDetail.parse((await host.get(`/api/pads/${blank.json.id}`)).json);
    expect(detail.problem).toBeNull();
    expect(detail.members).toEqual([
      { userId: detail.pad.ownerId, name: 'Hana', role: 'owner', guest: false },
    ]);
    const doc = await openDoc(host, blank.json.id);
    expect(doc.doc.getText(YDOC.code('cpp')).toString()).toBe(BLANK_SCAFFOLDS.cpp);
    doc.close();

    // The dashboard lists both, a blank one without a problem.
    const list = (await host.get('/api/pads')).json;
    expect(list.map((p: { kind: string }) => p.kind)).toEqual(['room', 'room']);
    expect(list[0]).toMatchObject({ problemSlug: null, problemTitle: null, difficulty: null });

    // Practice pads stay as they were, and cannot be blank.
    const practice = await host.post('/api/pads', { problemSlug: 'two-sum', language: 'python' });
    expect(practice.json).toMatchObject({ kind: 'practice', problemSlug: 'two-sum' });
    expect(practice.json.interviewer.enabled).toBe(true);
    expect((await host.post('/api/pads', { language: 'python', blank: true })).status).toBe(400);
    expect(
      (
        await host.post('/api/pads', {
          kind: 'room',
          language: 'python',
          blank: true,
          problemSlug: 'two-sum',
        })
      ).status,
    ).toBe(400);
  });
});

describe('joining by the invite link', () => {
  it('shows who invites, and lets a guest in with just a name', async () => {
    const { host, hostId, pad } = await room();
    const anon = new Client(h.base, nextIp());
    const info = await anon.get(`/api/pads/invite/${pad.shareToken}`);
    expect(InviteInfo.parse(info.json)).toEqual({
      kind: 'room',
      format: 'coding',
      title: 'Two Sum',
      hostName: 'Hana',
      status: 'active',
    });
    expect((await anon.get('/api/pads/invite/not-a-token')).status).toBe(404);

    const hostEvents = await events(host, pad.id);
    const { c, res } = await guest(pad.shareToken, '  Casey\tJones \n');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ padId: pad.id });
    const me = (await c.get('/api/me')).json.user;
    expect(me).toMatchObject({ name: 'Casey Jones', guest: true });
    const joined = await hostEvents.waitFor('member.joined');
    expect(joined.member).toEqual({
      userId: me.id,
      name: 'Casey Jones',
      role: 'collaborator',
      guest: true,
    });
    hostEvents.close();

    // The candidate sees the pad as a collaborator: no share token, nothing about the host's key.
    const detail = PadDetail.parse((await c.get(`/api/pads/${pad.id}`)).json);
    expect(detail.role).toBe('collaborator');
    expect(detail.pad.shareToken).toBeNull();
    expect(detail.members.map((m) => m.name)).toEqual(['Hana', 'Casey Jones']);
    expect(detail.members[0]?.userId).toBe(hostId);
    expect(JSON.stringify(detail)).not.toContain('interviewerNotes');

    // Joining again with the same session (a reload of the link) changes nothing but the name.
    const again = await c.post('/api/pads/join-guest', {
      shareToken: pad.shareToken,
      name: 'Casey',
    });
    expect(again.json).toEqual({ padId: pad.id });
    expect((await c.get('/api/me')).json.user).toMatchObject({ id: me.id, name: 'Casey' });
    const members = await h.api.ctx.db
      .select()
      .from(padMembers)
      .where(eq(padMembers.padId, pad.id));
    expect(members).toHaveLength(2);
  });

  it('a guest can use the room and nothing else', async () => {
    const { pad } = await room();
    const { c } = await guest(pad.shareToken);
    for (const [method, path, body] of [
      ['POST', '/api/pads', { problemSlug: 'two-sum', language: 'python' }],
      ['GET', '/api/pads', undefined],
      ['GET', '/api/ai-key', undefined],
      ['PUT', '/api/ai-key', { apiKey: 'sk-ant-good-000000000000000000000000' }],
      ['GET', '/api/quiz/topics', undefined],
      ['POST', '/api/quiz/attempts', { topics: ['test-topic'], mode: 'practice', count: 5 }],
    ] as const) {
      const res = await c.req(method, path, body);
      expect([method, path, res.status, res.json?.error?.code]).toEqual([
        method,
        path,
        403,
        'account_required',
      ]);
    }
    // Practice pads are shared between accounts only.
    const owner = new Client(h.base, nextIp());
    await owner.signUp('Owner');
    const practice = (await owner.post('/api/pads', { problemSlug: 'two-sum', language: 'python' }))
      .json;
    expect((await c.post('/api/pads/join', { shareToken: practice.shareToken })).status).toBe(403);
    const stranger = new Client(h.base, nextIp());
    const viaGuest = await stranger.post('/api/pads/join-guest', {
      shareToken: practice.shareToken,
      name: 'Nope',
    });
    expect(viaGuest.status).toBe(404);
    expect(stranger.cookies.size).toBe(0);
    // Host-only actions.
    expect((await c.post(`/api/pads/${pad.id}/end`)).status).toBe(403);
    expect((await c.get(`/api/pads/${pad.id}/host`)).status).toBe(403);
    expect((await c.post(`/api/pads/${pad.id}/problem`, { problemSlug: null })).status).toBe(403);
    expect((await c.post(`/api/pads/${pad.id}/review`, {})).status).toBe(403);
    expect((await c.put(`/api/pads/${pad.id}/host/notes`, { notes: 'x' })).status).toBe(403);
  });

  it('guests are created only through a room link', async () => {
    const anon = new Client(h.base, nextIp());
    const direct = await anon.post('/api/auth/sign-in/anonymous', {});
    expect(direct.status).toBe(404);
    expect(anon.cookies.size).toBe(0);
    const bad = await anon.post('/api/pads/join-guest', { shareToken: 'nope', name: 'X' });
    expect(bad.status).toBe(404);
    expect(anon.cookies.size).toBe(0);
    const { pad } = await room();
    expect(
      (await anon.post('/api/pads/join-guest', { shareToken: pad.shareToken, name: ' ' })).status,
    ).toBe(400);
    expect(anon.cookies.size).toBe(0);
  });

  it('an account joins a room as itself; an ended or full room takes nobody new', async () => {
    const { host, pad } = await room();
    const friend = new Client(h.base, nextIp());
    const f = await friend.signUp('Farid');
    expect((await friend.post('/api/pads/join', { shareToken: pad.shareToken })).json).toEqual({
      padId: pad.id,
    });
    const detail = PadDetail.parse((await host.get(`/api/pads/${pad.id}`)).json);
    expect(detail.members[1]).toEqual({
      userId: f.id,
      name: 'Farid',
      role: 'collaborator',
      guest: false,
    });

    // Full: a guest that could not get in is not left behind.
    const before = (await h.api.ctx.db.select().from(user).where(eq(user.isAnonymous, true)))
      .length;
    await h.api.ctx.db.transaction(async (tx) => {
      for (let i = 0; i < 11; i++) {
        const id = `filler-${pad.id}-${i}`;
        await tx.insert(user).values({ id, name: `F${i}`, email: `${id}@example.com` });
        await tx.insert(padMembers).values({ padId: pad.id, userId: id, role: 'collaborator' });
      }
    });
    const full = await guest(pad.shareToken, 'Late');
    expect([full.res.status, full.res.json.error.code]).toEqual([409, 'pad_full']);
    expect(full.c.cookies.size).toBe(0);
    const after = (await h.api.ctx.db.select().from(user).where(eq(user.isAnonymous, true))).length;
    expect(after).toBe(before);

    const second = await room();
    await second.host.post(`/api/pads/${second.pad.id}/end`);
    const late = await guest(second.pad.shareToken, 'Late');
    expect([late.res.status, late.res.json.error.code]).toEqual([409, 'pad_ended']);
    expect(
      InviteInfo.parse((await late.c.get(`/api/pads/invite/${second.pad.shareToken}`)).json).status,
    ).toBe('ended');
  });

  it('a guest who then creates an account keeps the room', async () => {
    const { pad } = await room();
    const { c } = await guest(pad.shareToken);
    const guestId = (await c.get('/api/me')).json.user.id;
    const account = await c.signUp('Casey');
    expect(account.id).not.toBe(guestId);
    expect((await c.get('/api/me')).json.user.guest).toBe(false);
    expect(PadDetail.parse((await c.get(`/api/pads/${pad.id}`)).json).role).toBe('collaborator');
    expect(await h.api.ctx.db.select().from(user).where(eq(user.id, guestId))).toEqual([]);
  });
});

describe('in the room', () => {
  it('chat is between the host and the candidate; the AI is never triggered', async () => {
    const { host, hostId, pad } = await room({ problemSlug: 'two-sum' }, true);
    const { c } = await guest(pad.shareToken);
    const candidateId = (await c.get('/api/me')).json.user.id;
    const hs = await events(host, pad.id);
    const cs = await events(c, pad.id);
    const used = fake.keysUsed.length;

    hs.send({ type: 'chat.send', text: 'Welcome! Talk me through your approach.' });
    const first = await cs.waitFor('message.created');
    expect(first.message).toMatchObject({ role: 'interviewer', userId: hostId, kind: 'chat' });
    cs.send({ type: 'chat.send', text: 'A hash map from value to index.' });
    const second = await hs.waitFor('message.created', (e) => e.message.role === 'candidate');
    expect(second.message).toMatchObject({
      userId: candidateId,
      text: 'A hash map from value to index.',
    });

    await sleep(300);
    expect(fake.of('candidate_message', pad.id)).toEqual([]);
    expect(fake.of('session_started', pad.id)).toEqual([]);
    expect(fake.keysUsed.length).toBe(used);
    expect(hs.events.filter((e) => e.type === 'message.created')).toHaveLength(2);
    hs.close();
    cs.close();
  });

  it("the candidate runs code on the host's allowance; a blank room only runs programs", async () => {
    const { host, hostId, pad } = await room({ blank: true });
    const { c } = await guest(pad.shareToken);
    const candidateId = (await c.get('/api/me')).json.user.id;
    const source = 'print("hi")\n';
    const tests = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source,
    });
    expect([tests.status, tests.json.error.code]).toEqual([400, 'no_problem']);

    h.api.ctx.config.limits.runs.userBurst = { limit: 2, windowSec: 60 };
    const cs = await events(c, pad.id);
    const first = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source,
    });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ userId: candidateId, problemSlug: null, mode: 'file' });
    await cs.waitFor('run.finished', (e) => e.run.id === first.json.id);
    // The host's run uses the same allowance...
    const second = await host.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source,
    });
    expect(second.status).toBe(201);
    await cs.waitFor('run.finished', (e) => e.run.id === second.json.id);
    // ...so the third is refused whoever asks, and it is the host's counter that is full.
    const third = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'file',
      language: 'python',
      source,
    });
    expect(third.status).toBe(429);
    const prefix = h.api.ctx.config.redisPrefix;
    const keys = await h.api.ctx.redis.keys(`${prefix}*runs:u:*`);
    expect(keys.some((k) => k.includes(hostId))).toBe(true);
    expect(keys.some((k) => k.includes(candidateId))).toBe(false);
    cs.close();
    expect(await h.api.ctx.redis.xlen(JUDGE_KEYS.jobsStream)).toBeGreaterThanOrEqual(0);
  });

  it('the host changes the problem: each problem keeps its own code', async () => {
    const { host, pad } = await room({ problemSlug: 'two-sum' });
    const { c } = await guest(pad.shareToken);
    const hd = await openDoc(host, pad.id);
    const cd = await openDoc(c, pad.id);
    const cs = await events(c, pad.id);
    const py = cd.doc.getText(YDOC.code('python'));
    const twoSumStart = py.toString();
    py.insert(py.length, '# two sum work\n');
    await until(() => hd.doc.getText(YDOC.code('python')).toString().includes('# two sum work'));

    const other = (await host.get('/api/problems')).json.find(
      (p: { slug: string; languages: string[] }) =>
        p.slug !== 'two-sum' && p.languages.includes('python'),
    );
    const moved = await host.post(`/api/pads/${pad.id}/problem`, { problemSlug: other.slug });
    expect(moved.status).toBe(200);
    const body = PadProblem.parse(moved.json);
    expect(body.pad.problemSlug).toBe(other.slug);
    expect(body.pad.shareToken).toBe(pad.shareToken);
    expect(body.problem?.slug).toBe(other.slug);
    const told = await cs.waitFor('pad.problem');
    expect(told.pad.problemSlug).toBe(other.slug);
    expect(told.pad.shareToken).toBeNull();
    expect(told.problem?.title).toBe(other.title);
    expect(JSON.stringify(told)).not.toContain('referenceSolutions');
    await until(
      () => cd.doc.getText(YDOC.code('python')).toString() === told.problem?.scaffolds.python,
    );
    expect(cd.doc.getText(YDOC.code('python')).toString()).not.toContain('two sum work');

    // Work on the second problem, go blank, then come back to each.
    py.insert(py.length, '# second problem work\n');
    await until(() =>
      hd.doc.getText(YDOC.code('python')).toString().includes('# second problem work'),
    );
    expect(
      (await host.post(`/api/pads/${pad.id}/problem`, { problemSlug: null })).json.problem,
    ).toBeNull();
    await until(() => cd.doc.getText(YDOC.code('python')).toString() === BLANK_SCAFFOLDS.python);
    await host.post(`/api/pads/${pad.id}/problem`, { problemSlug: 'two-sum' });
    await until(
      () => cd.doc.getText(YDOC.code('python')).toString() === `${twoSumStart}# two sum work\n`,
    );
    await host.post(`/api/pads/${pad.id}/problem`, { problemSlug: other.slug });
    await until(() =>
      cd.doc.getText(YDOC.code('python')).toString().endsWith('# second problem work\n'),
    );

    // Runs are judged against the current problem and remember which one that was.
    const detail = PadDetail.parse((await c.get(`/api/pads/${pad.id}`)).json);
    expect(detail.problem?.slug).toBe(other.slug);
    const run = await c.post(`/api/pads/${pad.id}/runs`, {
      mode: 'samples',
      language: 'python',
      source: py.toString(),
    });
    expect(run.json.problemSlug).toBe(other.slug);
    await cs.waitFor('run.finished', (e) => e.run.id === run.json.id);

    // Unknown problems and ended rooms are refused; the same problem again is a no-op.
    expect(
      (await host.post(`/api/pads/${pad.id}/problem`, { problemSlug: 'no-such-problem' })).status,
    ).toBe(404);
    const same = await host.post(`/api/pads/${pad.id}/problem`, { problemSlug: other.slug });
    expect(same.status).toBe(200);
    hd.close();
    cd.close();
    cs.close();
    await host.post(`/api/pads/${pad.id}/end`);
    const ended = await host.post(`/api/pads/${pad.id}/problem`, { problemSlug: 'two-sum' });
    expect([ended.status, ended.json.error.code]).toEqual([409, 'pad_ended']);

    // The changes are on the timeline for playback, in order.
    const playback = Playback.parse((await host.get(`/api/pads/${pad.id}/playback`)).json);
    expect(
      playback.events.flatMap((e) => (e.event.type === 'problem' ? [e.event.problemSlug] : [])),
    ).toEqual([other.slug, null, 'two-sum', other.slug]);
  });

  it('a practice pad cannot change its problem or serve host material', async () => {
    const owner = new Client(h.base, nextIp());
    await owner.signUp('Owner');
    const pad = (await owner.post('/api/pads', { problemSlug: 'two-sum', language: 'python' }))
      .json;
    expect((await owner.post(`/api/pads/${pad.id}/problem`, { problemSlug: null })).status).toBe(
      403,
    );
    expect((await owner.get(`/api/pads/${pad.id}/host`)).status).toBe(403);
    expect((await owner.post(`/api/pads/${pad.id}/review`, {})).status).toBe(403);
  });
});

describe('host only', () => {
  it('interviewer notes, reference solutions and private notes', async () => {
    const { host, pad } = await room();
    const view = HostView.parse((await host.get(`/api/pads/${pad.id}/host`)).json);
    expect(view.problem?.slug).toBe('two-sum');
    expect(view.problem?.interviewerNotes.length).toBeGreaterThan(20);
    expect(view.problem?.referenceSolutions.python).toContain('class Solution');
    expect(view.notes).toBe('');

    const saved = await host.put(`/api/pads/${pad.id}/host/notes`, {
      notes: 'Strong start. Missed duplicates.',
    });
    expect(saved.json).toEqual({ notes: 'Strong start. Missed duplicates.' });
    expect(
      (await host.put(`/api/pads/${pad.id}/host/notes`, { notes: 'x'.repeat(20_001) })).status,
    ).toBe(400);
    expect(HostView.parse((await host.get(`/api/pads/${pad.id}/host`)).json).notes).toBe(
      'Strong start. Missed duplicates.',
    );

    // Nothing the candidate can fetch contains any of it.
    const { c } = await guest(pad.shareToken);
    const detail = (await c.get(`/api/pads/${pad.id}`)).text;
    expect(detail).not.toContain('Missed duplicates');
    expect(detail).not.toContain('hostNotes');
    expect(detail).not.toContain(view.problem?.interviewerNotes.slice(0, 40) ?? 'x');

    // A blank room has notes only.
    await host.post(`/api/pads/${pad.id}/problem`, { problemSlug: null });
    expect(HostView.parse((await host.get(`/api/pads/${pad.id}/host`)).json)).toEqual({
      problem: null,
      notes: 'Strong start. Missed duplicates.',
      round: null,
    });
  });

  it("the AI second opinion runs on the host's key and goes to the host alone", async () => {
    const { host, pad } = await room({ problemSlug: 'two-sum' });
    const { c } = await guest(pad.shareToken);
    const cs = await events(c, pad.id);
    const noKey = await host.post(`/api/pads/${pad.id}/review`, {});
    expect([noKey.status, noKey.json.error.code]).toEqual([409, 'ai_key_missing']);

    await host.saveKey();
    await host.put(`/api/pads/${pad.id}/host/notes`, { notes: 'Check the empty input.' });
    cs.send({ type: 'chat.send', text: 'I think this is done.' });
    await cs.waitFor('message.created');
    const res = await host.post(`/api/pads/${pad.id}/review`, {
      question: ' Is the loop bound right? ',
    });
    expect(res.status).toBe(200);
    const review = SolutionReview.parse(res.json);
    expect(review).toMatchObject({ verdict: 'incorrect', language: 'python' });
    expect(review.answer).toBe('About "Is the loop bound right?": yes.');
    // The adviser saw the problem's private material, the chat and the host's notes.
    const seen = fake.roomContexts.at(-1);
    expect(seen?.problem?.interviewerNotes.length).toBeGreaterThan(0);
    expect(seen?.hostNotes).toBe('Check the empty input.');
    expect(seen?.transcript.map((m) => [m.role, m.text])).toEqual([
      ['candidate', 'I think this is done.'],
    ]);
    expect(seen?.code).toContain('class Solution');
    // Nothing about it reached the candidate, and nothing was stored as a message.
    await sleep(200);
    expect(cs.events.map((e) => e.type)).toEqual(['message.created']);
    expect(PadDetail.parse((await c.get(`/api/pads/${pad.id}`)).json).messages).toHaveLength(1);
    cs.close();

    // One review was counted above: a limit of two allows one more.
    h.api.ctx.config.limits.review.userBurst = { limit: 2, windowSec: 60 };
    expect((await host.post(`/api/pads/${pad.id}/review`, {})).status).toBe(200);
    expect((await host.post(`/api/pads/${pad.id}/review`, {})).status).toBe(429);
  });

  it("the report and playback are the host's; the assessment is written on request", async () => {
    const { host, pad } = await room({ problemSlug: 'two-sum' });
    const { c } = await guest(pad.shareToken);
    await host.put(`/api/pads/${pad.id}/host/notes`, { notes: 'Lean hire.' });
    const used = fake.keysUsed.length;
    expect((await host.post(`/api/pads/${pad.id}/end`)).json.status).toBe('ended');

    expect((await c.get(`/api/pads/${pad.id}/report`)).status).toBe(403);
    expect((await c.get(`/api/pads/${pad.id}/playback`)).status).toBe(403);
    expect((await c.get(`/api/pads/${pad.id}`)).status).toBe(200);

    const report = Report.parse((await host.get(`/api/pads/${pad.id}/report`)).json);
    expect(report).toMatchObject({
      status: 'ready',
      assessment: null,
      assessmentUnavailable: 'not_requested',
      hostNotes: 'Lean hire.',
    });
    expect(fake.keysUsed.length).toBe(used);
    expect((await host.get(`/api/pads/${pad.id}/playback`)).status).toBe(200);

    // Asking needs a key; with one, the observer's assessment is written.
    const noKey = await host.post(`/api/pads/${pad.id}/report/assessment`);
    expect([noKey.status, noKey.json.error.code]).toEqual([409, 'ai_key_missing']);
    await host.saveKey();
    const asked = await host.post(`/api/pads/${pad.id}/report/assessment`);
    expect(asked.status).toBe(200);
    await until(async () => {
      const r = Report.parse((await host.get(`/api/pads/${pad.id}/report`)).json);
      return r.status === 'ready' && r.assessment !== null;
    });
    expect(fake.roomContexts.at(-1)?.hostNotes).toBe('Lean hire.');
    // Notes can still be finished after the room ended.
    expect((await host.put(`/api/pads/${pad.id}/host/notes`, { notes: 'Hire.' })).status).toBe(200);
  });

  it('deleting a room removes guests who are in no other room', async () => {
    const { host, pad } = await room();
    const other = await room();
    const one = await guest(pad.shareToken, 'One');
    const two = await guest(pad.shareToken, 'Two');
    await two.c.post('/api/pads/join', { shareToken: other.pad.shareToken });
    const idOf = async (c: Client) => (await c.get('/api/me')).json.user.id as string;
    const [a, b] = [await idOf(one.c), await idOf(two.c)];
    await host.del(`/api/pads/${pad.id}`);
    expect(await h.api.ctx.db.select().from(user).where(eq(user.id, a))).toEqual([]);
    expect(await h.api.ctx.db.select().from(user).where(eq(user.id, b))).toHaveLength(1);
    expect((await one.c.get('/api/me')).status).toBe(401);
    expect(await h.api.ctx.db.select().from(pads).where(eq(pads.id, pad.id))).toEqual([]);
    expect(await h.api.ctx.db.select().from(runs).where(eq(runs.padId, pad.id))).toEqual([]);
  });
});
