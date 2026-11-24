import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { generateScaffold, Playback, ProblemContent, YDOC } from '@ipp/contracts';
import { aiUsage, padDocs, padUpdates, timelineEvents } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
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

const require = createRequire(import.meta.url);
const twoSum = ProblemContent.parse(
  JSON.parse(readFileSync(require.resolve('@ipp/contracts/fixtures/problem-two-sum.json'), 'utf8')),
);

let h: Harness;
let fake: FakeInterviewer;
beforeAll(async () => {
  await flushRedis();
  fake = new FakeInterviewer();
  h = await startApi({ fake });
});
afterAll(async () => h?.stop());

/** A user with their own API key (unless `withKey` is false) and a fresh pad. */
async function setup(name: string, withKey = true) {
  const c = new Client(h.base, `100.64.0.${Math.floor(Math.random() * 250)}`);
  await c.signUp(name);
  if (withKey) await c.saveKey();
  const pad = (await c.post('/api/pads', { problemSlug: 'two-sum', language: 'python' })).json;
  return { c, pad };
}

interface Collab {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  socket: HocuspocusProviderWebsocket;
  close(): void;
}

async function openCollab(base: string, c: Client, padId: string): Promise<Collab> {
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url: `${base}/collab`,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: YDOC.name(padId),
    document: doc,
    // No ticket once the pad is gone for this user: reconnects then fail authentication.
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
    provider,
    socket,
    close() {
      provider.destroy();
      socket.destroy();
    },
  };
}

describe('ws tickets', () => {
  it('are single use, expire, and are bound to a pad', async () => {
    const { c, pad } = await setup('Ticket');
    const other = await setup('Other');
    const ticket = await c.ticket(pad.id);
    const ws = await EventSocket.open(`${h.wsBase}/ws/pads/${pad.id}?ticket=${ticket}`);
    ws.send({ type: 'ping' });
    await ws.waitFor('pong');
    ws.close();
    // Reuse fails.
    await expect(
      EventSocket.open(`${h.wsBase}/ws/pads/${pad.id}?ticket=${ticket}`),
    ).rejects.toThrow(/401/);
    // Wrong pad fails.
    const t2 = await c.ticket(pad.id);
    await expect(
      EventSocket.open(`${h.wsBase}/ws/pads/${other.pad.id}?ticket=${t2}`),
    ).rejects.toThrow(/401/);
    // Expiry: shorten the TTL in Redis.
    const t3 = await c.ticket(pad.id);
    await h.api.ctx.redis.pexpire(`ipptest:wst:${t3}`, 1);
    await sleep(20);
    await expect(EventSocket.open(`${h.wsBase}/ws/pads/${pad.id}?ticket=${t3}`)).rejects.toThrow(
      /401/,
    );
    // No ticket, garbage ticket.
    await expect(EventSocket.open(`${h.wsBase}/ws/pads/${pad.id}`)).rejects.toThrow(/401/);
    await expect(EventSocket.open(`${h.wsBase}/ws/pads/${pad.id}?ticket=%00%00`)).rejects.toThrow(
      /401/,
    );
    // Foreign Origin is refused.
    await expect(
      new Promise((resolve, reject) => {
        const w = new WebSocket(`${h.wsBase}/ws/pads/${pad.id}?ticket=x`, {
          origin: 'https://evil.example',
        });
        w.once('open', resolve);
        w.once('unexpected-response', (_q, res) => reject(new Error(String(res.statusCode))));
        w.once('error', reject);
      }),
    ).rejects.toThrow(/403/);
    const ticketRes = await c.post('/api/ws-ticket', { padId: pad.id });
    expect(ticketRes.json).toEqual({ ticket: expect.any(String), expiresInSec: 30 });
    expect((await c.post('/api/ws-ticket', { padId: 'nope' })).status).toBe(400);
  });
});

describe('collab (Hocuspocus)', () => {
  it('seeds scaffolds, persists across a restart, records playback history, is read-only after end', async () => {
    const { c, pad } = await setup('Collab');
    const a = await openCollab(h.wsBase, c, pad.id);
    for (const lang of ['cpp', 'python', 'java'] as const) {
      expect(a.doc.getText(YDOC.code(lang)).toString()).toBe(
        generateScaffold(twoSum.signature, lang),
      );
    }
    const py = a.doc.getText(YDOC.code('python'));
    py.insert(py.length, '\n# first edit\n');
    await sleep(300); // > historyCoalesceMs: a separate history row
    py.insert(py.length, '# second edit\n');
    a.doc.getText(YDOC.notes).insert(0, 'my notes');

    // A second client sees the edits.
    const b = await openCollab(h.wsBase, c, pad.id);
    await until(() => b.doc.getText(YDOC.code('python')).toString().includes('# second edit'));

    // code_changed is throttled to at most one per second per pad.
    const before = fake.of('code_changed', pad.id).length;
    for (let i = 0; i < 10; i++) {
      py.insert(py.length, `# burst ${i}\n`);
      await sleep(20);
    }
    await sleep(1300);
    const raised = fake.of('code_changed', pad.id).length - before;
    expect(raised).toBeGreaterThanOrEqual(1);
    expect(raised).toBeLessThanOrEqual(2);

    // The interviewer reads code and notes from the live doc.
    const ctx = await fake.deps.loadContext(pad.id);
    expect(ctx.code).toContain('# burst 9');
    expect(ctx.notes).toBe('my notes');
    expect(ctx.problem.interviewerNotes.length).toBeGreaterThan(0);

    // Ticks are raised while someone is connected.
    const ticks = fake.of('tick', pad.id).length;
    await until(() => fake.of('tick', pad.id).length > ticks, 2000);

    const finalText = py.toString();
    a.close();
    b.close();
    await until(async () => {
      const [row] = await h.api.ctx.db.select().from(padDocs).where(eq(padDocs.padId, pad.id));
      if (!row) return false;
      const d = new Y.Doc();
      Y.applyUpdate(d, row.state);
      return d.getText(YDOC.code('python')).toString() === finalText;
    });

    // Simulated restart: a fresh API process over the same database.
    await h.stop();
    h = await startApi({ fake });
    const c2 = new Client(h.base, c.ip);
    c2.cookies = c.cookies;
    const again = await openCollab(h.wsBase, c2, pad.id);
    expect(again.doc.getText(YDOC.code('python')).toString()).toBe(finalText);
    expect(again.doc.getText(YDOC.notes).toString()).toBe('my notes');
    // Not re-seeded: the cpp buffer is still the single scaffold.
    expect(again.doc.getText(YDOC.code('cpp')).toString()).toBe(
      generateScaffold(twoSum.signature, 'cpp'),
    );

    // Playback replays to the same text, from coalesced rows.
    const playback = Playback.parse((await c2.get(`/api/pads/${pad.id}/playback`)).json);
    expect(playback.updates[0]?.seq).toBe(1);
    expect(playback.updates.length).toBeGreaterThanOrEqual(3);
    const rows = await h.api.ctx.db.select().from(padUpdates).where(eq(padUpdates.padId, pad.id));
    expect(rows.length).toBe(playback.updates.length);
    expect(rows.length).toBeLessThan(15); // ~16 edits were coalesced
    const replay = new Y.Doc();
    for (const u of playback.updates) Y.applyUpdate(replay, Buffer.from(u.update, 'base64'));
    expect(replay.getText(YDOC.code('python')).toString()).toBe(finalText);

    // End the pad: the live connection is dropped and comes back read-only.
    const ended = await c2.post(`/api/pads/${pad.id}/end`);
    expect(ended.json.status).toBe('ended');
    again.close();
    const ro = await openCollab(h.wsBase, c2, pad.id);
    expect(ro.provider.authorizedScope).toBe('readonly');
    ro.doc.getText(YDOC.code('python')).insert(0, 'SHOULD NOT PERSIST');
    await sleep(400);
    ro.close();
    await sleep(300);
    const texts = await h.api.ctx.collab.readTexts(pad.id);
    expect(texts.code.python).toBe(finalText);
  });

  it('rejects collab connections without a valid ticket for that pad', async () => {
    const { c, pad } = await setup('NoTicket');
    const other = await setup('Intruder');
    // A ticket for the intruder's own pad cannot open this pad's document.
    const bogus = new Client(h.base);
    bogus.cookies = other.c.cookies;
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({
      url: `${h.wsBase}/collab`,
      WebSocketPolyfill: WebSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: YDOC.name(pad.id),
      document: doc,
      token: () => other.c.ticket(other.pad.id),
    });
    provider.attach();
    const reason = await new Promise<string>((resolve) =>
      provider.on('authenticationFailed', ({ reason }: { reason: string }) => resolve(reason)),
    );
    expect(reason).toBeTruthy();
    expect(doc.getText(YDOC.code('python')).toString()).toBe('');
    provider.destroy();
    socket.destroy();
    void c;
  });
});

describe('event channel', () => {
  it('chat round trip with the interviewer, session_started, telemetry and language', async () => {
    const { c, pad } = await setup('Chatter');
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    await until(() => fake.of('session_started', pad.id).length === 1);
    const ws2 = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    await sleep(100);
    expect(fake.of('session_started', pad.id)).toHaveLength(1);

    ws.send({ type: 'chat.send', text: '  Can I assume the input is sorted?  ' });
    const mine = await ws2.waitFor('message.created', (e) => e.message.role === 'candidate');
    expect(mine.message).toMatchObject({
      role: 'candidate',
      kind: 'chat',
      text: 'Can I assume the input is sorted?',
      via: 'text',
    });
    const delta = await ws.waitFor('message.delta');
    const reply = await ws.waitFor('message.created', (e) => e.message.role === 'interviewer');
    expect(reply.message.id).toBe(delta.messageId);
    expect(reply.message.text).toContain('Echo: Can I assume the input is sorted?');
    // The fake interviewer read the scaffold from the (never opened) doc.
    expect(reply.message.text).toMatch(/python code \d+ chars/);
    expect(ws.events.some((e) => e.type === 'interviewer.thinking')).toBe(true);
    const trig = fake.of('candidate_message', pad.id)[0]?.trigger;
    expect(trig).toMatchObject({
      type: 'candidate_message',
      text: 'Can I assume the input is sorted?',
      via: 'text',
    });

    ws.send({ type: 'chat.send', text: 'x'.repeat(4001) });
    expect((await ws.waitFor('error', (e) => e.code === 'too_long')).code).toBe('too_long');
    ws.send({ type: 'nonsense' });
    await ws.waitFor('error', (e) => e.code === 'bad_event');

    ws.send({ type: 'telemetry', kind: 'paste', chars: 120 });
    ws.send({ type: 'language', language: 'cpp' });
    const updated = await ws2.waitFor('pad.updated');
    expect(updated.pad.language).toBe('cpp');
    expect(updated.pad.shareToken).toBeNull();
    await until(
      () =>
        fake.of('telemetry', pad.id).length === 1 &&
        fake.of('language_changed', pad.id).length === 1,
    );

    const detail = await c.get(`/api/pads/${pad.id}`);
    expect(detail.json.messages.map((m: { role: string }) => m.role)).toEqual([
      'candidate',
      'interviewer',
    ]);
    const playback = (await c.get(`/api/pads/${pad.id}/playback`)).json;
    expect(playback.events.map((e: { event: { type: string } }) => e.event.type)).toEqual([
      'paste',
      'language',
    ]);
    expect(playback.messages).toHaveLength(2);

    // Chat after the end is refused.
    await c.post(`/api/pads/${pad.id}/end`);
    await ws.waitFor('pad.updated', (e) => e.pad.status === 'ended');
    ws.send({ type: 'chat.send', text: 'hello?' });
    await ws.waitFor('error', (e) => e.code === 'pad_ended');
    ws.close();
    ws2.close();
  });

  it('rate limits chat', async () => {
    h.api.ctx.config.limits.chat.userBurst = { limit: 2, windowSec: 60 };
    const { c, pad } = await setup('Flood');
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    for (let i = 0; i < 3; i++) ws.send({ type: 'chat.send', text: `m${i}` });
    await ws.waitFor('error', (e) => e.code === 'rate_limited');
    ws.close();
  });

  it('checkBudget enforces the daily AI message limit', async () => {
    const { c, pad } = await setup('Budget');
    expect(await fake.deps.checkBudget(pad.id)).toEqual({ ok: true });
    h.api.ctx.config.aiDailyMessageLimit = 1;
    await fake.deps.saveMessage(pad.id, { kind: 'proactive', intent: 'greeting', text: 'Hi' });
    expect((await fake.deps.checkBudget(pad.id)).ok).toBe(false);
    h.api.ctx.config.aiDailyMessageLimit = 300;
    await fake.deps.appendPrivateNote(pad.id, 'candidate seems nervous');
    const ctx = await fake.deps.loadContext(pad.id);
    expect(ctx.privateNotes).toEqual(['candidate seems nervous']);
    expect(ctx.transcript.map((m) => m.text)).toEqual(['Hi']);
    fake.deps.recordUsage?.(
      { padId: pad.id },
      {
        purpose: 'reply',
        model: 'm',
        inputTokens: 5,
        outputTokens: 7,
        cacheReadInputTokens: 2,
        cacheCreationInputTokens: 1,
      },
    );
    const owner = pad.ownerId as string;
    await until(async () => {
      const [row] = await h.api.ctx.db.select().from(aiUsage).where(eq(aiUsage.userId, owner));
      return row?.inputTokens === 8 && row.outputTokens === 7 && row.messages === 1;
    });
    void c;
  });
});

describe('abuse controls (security review)', () => {
  const limits = () => h.api.ctx.config.limits;

  /** Raw Hocuspocus frame: varString document name, then varUints / varUint8Arrays. */
  function frame(doc: string, parts: (number | Uint8Array)[]): Buffer {
    const vu = (n: number) => {
      const out: number[] = [];
      while (n > 127) {
        out.push((n & 127) | 128);
        n = Math.floor(n / 128);
      }
      out.push(n);
      return Buffer.from(out);
    };
    const name = Buffer.from(doc);
    const chunks = [vu(name.length), name];
    for (const p of parts)
      chunks.push(typeof p === 'number' ? vu(p) : Buffer.concat([vu(p.length), Buffer.from(p)]));
    return Buffer.concat(chunks);
  }
  const openRaw = () =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${h.wsBase}/collab`);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  const closed = (ws: WebSocket) =>
    new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) resolve();
      ws.once('close', () => resolve());
    });

  it('closes /collab sockets that send too much before authenticating', async () => {
    // Hocuspocus queues messages for a document until it is authenticated, without bound:
    // ~100 MB sent this way grew the live API by ~110 MB with no account at all.
    const ws = await openRaw();
    const junk = new Uint8Array(32 * 1024).fill(65);
    for (let i = 0; i < 4; i++)
      ws.send(frame(`pad:${'0'.repeat(8)}-0000-0000-0000-000000000000`, [0, 2, junk]));
    await closed(ws);
  });

  it('closes /collab sockets that never authenticate, or switch documents', async () => {
    const saved = limits().collab.authTimeoutMs;
    limits().collab.authTimeoutMs = 300;
    try {
      const idle = await openRaw();
      const started = Date.now();
      await closed(idle);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      limits().collab.authTimeoutMs = saved;
    }
    const ws = await openRaw();
    ws.send(frame('pad:11111111-1111-4111-8111-111111111111', [3]));
    ws.send(frame('pad:22222222-2222-4222-8222-222222222222', [3]));
    await closed(ws);
  });

  it('refuses edits once a pad has accumulated docBytes of updates', async () => {
    const { c, pad } = await setup('BigDoc');
    const saved = limits().collab.docBytes;
    limits().collab.docBytes = 40_000;
    try {
      const a = await openCollab(h.wsBase, c, pad.id);
      const gone = new Promise<void>((r) => a.provider.on('close', () => r()));
      a.doc.getText(YDOC.notes).insert(0, 'x'.repeat(60_000));
      await gone;
      a.close();
      await h.api.ctx.collab.flushHistory(pad.id);
      await sleep(300);
      const b = await openCollab(h.wsBase, c, pad.id);
      expect(b.doc.getText(YDOC.notes).length).toBe(0);
      b.close();
    } finally {
      limits().collab.docBytes = saved;
    }
  });

  it('awareness `user` must be the authenticated user', async () => {
    const { c, pad } = await setup('Presence');
    const me = (await c.get('/api/me')).json.user;
    const ok = await openCollab(h.wsBase, c, pad.id);
    let okClosed = false;
    ok.provider.on('close', () => {
      okClosed = true;
    });
    ok.provider.setAwarenessField('user', { name: me.name, color: '#fff', userId: me.id });
    await sleep(300);
    expect(okClosed).toBe(false);
    ok.close();

    const bad = await openCollab(h.wsBase, c, pad.id);
    const gone = new Promise<void>((r) => bad.provider.on('close', () => r()));
    bad.provider.setAwarenessField('user', { name: 'Interviewer', color: '#fff', userId: 'x' });
    await gone;
    bad.close();
  });

  it('rate limits telemetry and language events', async () => {
    const { c, pad } = await setup('Telemetry');
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    const n = limits().padEvents.userBurst.limit + 10;
    for (let i = 0; i < n; i++) ws.send({ type: 'telemetry', kind: 'blur', ms: i });
    await ws.waitFor('error', (e) => e.code === 'rate_limited');
    await sleep(300);
    const rows = await h.api.ctx.db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.padId, pad.id));
    expect(rows.filter((r) => r.event.type === 'blur').length).toBe(
      limits().padEvents.userBurst.limit,
    );
    ws.close();
  });

  it('checkBudget also enforces the daily token limits', async () => {
    const { pad } = await setup('Tokens');
    expect(await fake.deps.checkBudget(pad.id)).toEqual({ ok: true });
    const saved = h.api.ctx.config.aiDailyOutputTokenLimit;
    h.api.ctx.config.aiDailyOutputTokenLimit = 100;
    try {
      // Silent decisions and assessments produce no message but cost tokens.
      fake.deps.recordUsage?.(
        { padId: pad.id },
        {
          purpose: 'decision',
          model: 'm',
          inputTokens: 10,
          outputTokens: 150,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      );
      await until(async () => !(await fake.deps.checkBudget(pad.id)).ok);
    } finally {
      h.api.ctx.config.aiDailyOutputTokenLimit = saved;
    }
  });
});

describe('deleting a live pad', () => {
  const closeCode = (s: EventSocket) =>
    new Promise<number>((resolve) => s.ws.once('close', (code) => resolve(code)));
  const docLoaded = (padId: string) => h.api.ctx.collab.hocuspocus.documents.has(YDOC.name(padId));

  it('closes sockets and collab sessions, releases the interviewer, and persists nothing after', async () => {
    const errors = vi.spyOn(console, 'error');
    try {
      const { c, pad } = await setup('LiveDel');
      const other = new Client(h.base, '100.64.1.9');
      await other.signUp('LiveDelGuest');
      await other.post('/api/pads/join', { shareToken: pad.shareToken });
      const mine = await EventSocket.open(
        `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
      );
      const theirs = await EventSocket.open(
        `${h.wsBase}/ws/pads/${pad.id}?ticket=${await other.ticket(pad.id)}`,
      );
      const a = await openCollab(h.wsBase, c, pad.id);
      await until(
        async () =>
          (await h.api.ctx.db.select().from(padDocs).where(eq(padDocs.padId, pad.id))).length === 1,
      );
      // Keep typing through the delete, so a debounced save is always pending when the
      // connections drop (Hocuspocus then stores once more, after the row is gone).
      const py = a.doc.getText(YDOC.code('python'));
      const typing = setInterval(() => py.insert(py.length, 'x'), 10);
      await sleep(50);

      const closedMine = closeCode(mine);
      const closedTheirs = closeCode(theirs);
      const res = await c.del(`/api/pads/${pad.id}`);
      expect(res.json).toEqual({ padId: pad.id, removed: 'pad' });
      expect(await closedMine).toBe(4404);
      expect(await closedTheirs).toBe(4404);
      await until(() => !docLoaded(pad.id));
      clearInterval(typing);
      await until(() => h.api.ctx.rooms.count(pad.id) === 0);
      expect(fake.released).toContain(pad.id);

      // Past the debounce and coalescing windows: nothing was written back for the pad.
      await sleep(800);
      const { db } = h.api.ctx;
      expect(await db.select().from(padDocs).where(eq(padDocs.padId, pad.id))).toEqual([]);
      expect(await db.select().from(padUpdates).where(eq(padUpdates.padId, pad.id))).toEqual([]);
      // The provider's reconnect is refused and does not load the document again.
      expect(docLoaded(pad.id)).toBe(false);
      expect((await c.post('/api/ws-ticket', { padId: pad.id })).status).toBe(404);
      a.close();
      const noisy = errors.mock.calls.flat().map(String).join('\n');
      expect(noisy).not.toMatch(/foreign key|storeDocument|pad_docs|pad_updates/i);
    } finally {
      errors.mockRestore();
    }
  });

  it('a collaborator leaving closes only their own sockets', async () => {
    const { c, pad } = await setup('LeaveOwner');
    const other = new Client(h.base, '100.64.1.10');
    await other.signUp('LeaveGuest');
    await other.post('/api/pads/join', { shareToken: pad.shareToken });
    const mine = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
    );
    const theirs = await EventSocket.open(
      `${h.wsBase}/ws/pads/${pad.id}?ticket=${await other.ticket(pad.id)}`,
    );
    const a = await openCollab(h.wsBase, c, pad.id);
    const b = await openCollab(h.wsBase, other, pad.id);
    expect(h.api.ctx.collab.connectionCount(pad.id)).toBe(2);

    const closedTheirs = closeCode(theirs);
    const res = await other.del(`/api/pads/${pad.id}`);
    expect(res.json).toEqual({ padId: pad.id, removed: 'membership' });
    expect(await closedTheirs).toBe(4404);
    await until(() => h.api.ctx.collab.connectionCount(pad.id) === 1);
    // Their edits no longer reach the document; the owner carries on.
    b.doc.getText(YDOC.notes).insert(0, 'after leaving');
    a.doc.getText(YDOC.notes).insert(0, 'owner here');
    await sleep(300);
    expect(a.doc.getText(YDOC.notes).toString()).toBe('owner here');
    mine.send({ type: 'ping' });
    await mine.waitFor('pong');
    expect(h.api.ctx.collab.connectionCount(pad.id)).toBe(1);
    a.close();
    b.close();
    mine.close();
  });
});
