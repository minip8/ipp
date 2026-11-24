import {
  interviewerNotes,
  messages,
  padDocs,
  padMembers,
  pads,
  padUpdates,
  reports,
  runs,
  timelineEvents,
} from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_WEB_ORIGIN } from './helpers/env';
import { Client, flushRedis, type Harness, startApi } from './helpers/harness';

let h: Harness;
beforeAll(async () => {
  await flushRedis();
  h = await startApi();
});
afterAll(async () => h?.stop());

describe('auth', () => {
  it('signs up, signs in, signs out; 401 without a session', async () => {
    const anon = new Client(h.base);
    expect((await anon.get('/api/me')).status).toBe(401);
    expect((await anon.get('/api/me')).json).toEqual({
      error: { code: 'unauthorized', message: 'Sign in required' },
    });
    expect((await anon.get('/api/pads')).status).toBe(401);
    expect((await anon.post('/api/pads', { language: 'python' })).status).toBe(401);
    expect((await anon.get('/api/quiz/topics')).status).toBe(401);

    const a = new Client(h.base);
    const { email, id } = await a.signUp('Alice');
    expect([...a.cookies.keys()]).toContain('better-auth.session_token');
    const me = await a.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.json).toEqual({ user: { id, name: 'Alice', email, image: null } });

    const out = await a.post('/api/auth/sign-out', {});
    expect(out.status).toBe(200);
    expect((await a.get('/api/me')).status).toBe(401);

    const bad = await a.post('/api/auth/sign-in/email', { email, password: 'wrong password!!' });
    expect(bad.status).toBe(401);
    const ok = await a.post('/api/auth/sign-in/email', {
      email,
      password: 'correct horse battery',
    });
    expect(ok.status).toBe(200);
    expect((await a.get('/api/me')).json.user.id).toBe(id);
  });

  it('rejects state-changing requests from a foreign origin', async () => {
    const a = new Client(h.base);
    await a.signUp('Mallory');
    const res = await a.req(
      'POST',
      '/api/pads',
      { language: 'cpp' },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    const cross = await a.req(
      'POST',
      '/api/pads',
      { language: 'cpp' },
      { 'sec-fetch-site': 'cross-site', origin: '' },
    );
    expect(cross.status).toBe(403);
  });

  it('rate limits auth attempts per IP', async () => {
    h.api.ctx.config.limits.auth.ipBurst = { limit: 2, windowSec: 60 };
    try {
      const c = new Client(h.base, '203.0.113.99');
      const body = { email: 'nobody@example.com', password: 'whatever-123' };
      expect((await c.post('/api/auth/sign-in/email', body)).status).toBe(401);
      expect((await c.post('/api/auth/sign-in/email', body)).status).toBe(401);
      const limited = await c.post('/api/auth/sign-in/email', body);
      expect(limited.status).toBe(429);
      expect(limited.json.error.code).toBe('rate_limited');
      // A different address is unaffected.
      expect(
        (await new Client(h.base, '203.0.113.98').post('/api/auth/sign-in/email', body)).status,
      ).toBe(401);
    } finally {
      h.api.ctx.config.limits.auth.ipBurst = { limit: 20, windowSec: 60 };
    }
  });

  it('config, health and readiness', async () => {
    const c = new Client(h.base);
    expect((await c.get('/api/config')).json).toEqual({
      githubAuth: h.api.ctx.config.github !== null,
      googleAuth: h.api.ctx.config.google !== null,
      ai: { requiresUserKey: true, model: 'claude-opus-5-5', keyTtlHours: 24 },
    });
    expect((await c.get('/healthz')).status).toBe(200);
    const ready = await c.get('/readyz');
    expect(ready.json).toEqual({ ok: true, checks: { postgres: true, redis: true } });
    expect(ready.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ready.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('problems', () => {
  it('lists and filters; detail never contains server-only fields', async () => {
    const c = new Client(h.base);
    const list = await c.get('/api/problems');
    expect(list.json.map((p: { slug: string }) => p.slug).sort()).toEqual(['lru-cache', 'two-sum']);
    expect(
      (await c.get('/api/problems?difficulty=easy')).json.map((p: { slug: string }) => p.slug),
    ).toEqual(['two-sum']);
    expect((await c.get('/api/problems?q=LRU')).json).toHaveLength(1);
    expect((await c.get('/api/problems?difficulty=impossible')).status).toBe(400);
    expect(
      Object.fromEntries(
        list.json.map((p: { slug: string; category: string }) => [p.slug, p.category]),
      ),
    ).toEqual({ 'two-sum': 'dsa', 'lru-cache': 'data-structure' });
    expect(
      (await c.get('/api/problems?category=data-structure')).json.map(
        (p: { slug: string }) => p.slug,
      ),
    ).toEqual(['lru-cache']);
    expect((await c.get('/api/problems?category=puzzles')).status).toBe(400);
    const d = await c.get('/api/problems/two-sum');
    expect(d.status).toBe(200);
    expect(d.json.hiddenTestCount).toBe(1);
    expect(d.json.category).toBe('dsa');
    expect(d.json.sampleTests.map((t: { id: string }) => t.id)).toEqual(['s1', 's2']);
    expect(Object.keys(d.json.scaffolds).sort()).toEqual(['cpp', 'java', 'python']);
    expect(d.json).not.toHaveProperty('interviewerNotes');
    expect(d.json).not.toHaveProperty('referenceSolutions');
    expect(d.text).not.toContain('"h1"');
    expect((await c.get('/api/problems/nope')).status).toBe(404);
  });
});

describe('pads', () => {
  it('lifecycle, membership and share tokens', async () => {
    const owner = new Client(h.base, '198.51.100.1');
    const other = new Client(h.base, '198.51.100.2');
    await owner.signUp('Owner');
    const otherUser = await other.signUp('Other');

    expect((await owner.post('/api/pads', { problemSlug: 'nope', language: 'cpp' })).status).toBe(
      404,
    );
    expect((await owner.post('/api/pads', { language: 'cobol' })).status).toBe(400);
    expect((await owner.req('POST', '/api/pads', '{not json')).status).toBe(400);

    const created = await owner.post('/api/pads', {
      problemSlug: 'two-sum',
      language: 'python',
      durationMin: 30,
    });
    expect(created.status).toBe(200);
    const pad = created.json;
    expect(pad).toMatchObject({
      problemSlug: 'two-sum',
      language: 'python',
      status: 'active',
      durationMin: 30,
      title: 'Two Sum',
    });
    expect(pad.shareToken).toBeTruthy();
    expect(pad.interviewer).toEqual({
      enabled: true,
      style: 'neutral',
      proactivity: 'normal',
      voice: false,
    });

    const random = await owner.post('/api/pads', {
      random: { difficulty: 'medium' },
      language: 'cpp',
    });
    expect(random.json.problemSlug).toBe('lru-cache');

    const list = await owner.get('/api/pads');
    expect(list.json.map((p: { id: string }) => p.id)).toEqual([random.json.id, pad.id]);
    expect(list.json[1]).toMatchObject({
      problemTitle: 'Two Sum',
      difficulty: 'easy',
      accepted: false,
    });

    // Another user cannot see it.
    expect((await other.get(`/api/pads/${pad.id}`)).status).toBe(404);
    expect((await other.post('/api/ws-ticket', { padId: pad.id })).status).toBe(404);
    expect(
      (
        await other.post(`/api/pads/${pad.id}/runs`, {
          mode: 'file',
          language: 'python',
          source: 'print(1)',
        })
      ).status,
    ).toBe(404);
    expect((await other.get(`/api/pads/${pad.id}/playback`)).status).toBe(404);
    expect((await other.get('/api/pads')).json).toEqual([]);
    expect((await other.get('/api/pads/not-a-uuid')).status).toBe(404);

    // Share token lets them join as a collaborator.
    expect((await other.post('/api/pads/join', { shareToken: 'wrong' })).status).toBe(404);
    const join = await other.post('/api/pads/join', { shareToken: pad.shareToken });
    expect(join.json).toEqual({ padId: pad.id });
    const detail = await other.get(`/api/pads/${pad.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.role).toBe('collaborator');
    expect(detail.json.pad.shareToken).toBeNull();
    expect(detail.json.problem.slug).toBe('two-sum');
    // The owner has no key yet: the interviewer is unavailable, for collaborators too.
    expect(detail.json).toMatchObject({ interviewerAvailable: false, interviewerKey: 'missing' });
    await owner.saveKey();
    expect((await other.get(`/api/pads/${pad.id}`)).json).toMatchObject({
      interviewerAvailable: true,
      interviewerKey: 'active',
    });
    expect(detail.text).not.toContain('interviewerNotes');

    const ownerDetail = await owner.get(`/api/pads/${pad.id}`);
    expect(ownerDetail.json.role).toBe('owner');
    expect(ownerDetail.json.pad.shareToken).toBe(pad.shareToken);

    // PATCH: collaborators may switch language but not settings.
    expect((await other.patch(`/api/pads/${pad.id}`, { title: 'mine now' })).status).toBe(403);
    const lang = await other.patch(`/api/pads/${pad.id}`, { language: 'java' });
    expect(lang.status).toBe(200);
    expect(lang.json.language).toBe('java');
    const settings = await owner.patch(`/api/pads/${pad.id}`, {
      title: 'Renamed',
      interviewer: { style: 'tough' },
    });
    expect(settings.json).toMatchObject({
      title: 'Renamed',
      interviewer: { style: 'tough', enabled: true },
    });

    // Report before the end is a conflict; only the owner ends.
    expect((await owner.get(`/api/pads/${pad.id}/report`)).status).toBe(409);
    expect((await other.post(`/api/pads/${pad.id}/end`)).status).toBe(403);
    const ended = await owner.post(`/api/pads/${pad.id}/end`);
    expect(ended.json).toMatchObject({ status: 'ended' });
    expect(ended.json.endedAt).toBeTruthy();
    expect((await owner.post(`/api/pads/${pad.id}/end`)).json.status).toBe('ended');

    // Ended pads refuse runs and edits.
    expect(
      (
        await owner.post(`/api/pads/${pad.id}/runs`, {
          mode: 'file',
          language: 'python',
          source: 'print(1)',
        })
      ).status,
    ).toBe(409);
    expect((await owner.patch(`/api/pads/${pad.id}`, { language: 'cpp' })).status).toBe(409);

    // Report: stats always, assessment from the interviewer.
    let report = await owner.get(`/api/pads/${pad.id}/report`);
    for (let i = 0; i < 50 && report.json.status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      report = await owner.get(`/api/pads/${pad.id}/report`);
    }
    expect(report.json).toMatchObject({
      padId: pad.id,
      status: 'ready',
      stats: { runs: 0, submissions: 0, accepted: false },
    });
    expect(report.json.assessment.recommendation).toBe('hire');
    expect((await other.get(`/api/pads/${pad.id}/report`)).status).toBe(200);
    expect(h.fake.of('session_ended', pad.id)).toHaveLength(1);
    expect(h.fake.of('language_changed', pad.id)).toHaveLength(1);
    void otherUser;
  });

  it('report without an interviewer has a null assessment', async () => {
    const owner = new Client(h.base, '198.51.100.3');
    await owner.signUp('NoAi');
    const pad = (
      await owner.post('/api/pads', {
        problemSlug: 'two-sum',
        language: 'cpp',
        interviewer: { enabled: false },
      })
    ).json;
    await owner.post(`/api/pads/${pad.id}/end`);
    let report = await owner.get(`/api/pads/${pad.id}/report`);
    for (let i = 0; i < 50 && report.json.status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      report = await owner.get(`/api/pads/${pad.id}/report`);
    }
    expect(report.json).toMatchObject({
      status: 'ready',
      assessment: null,
      assessmentUnavailable: 'interviewer_off',
    });
    expect(h.fake.triggers.filter((t) => t.padId === pad.id)).toEqual([]);
  });
});

describe('deleting pads', () => {
  /** Row counts per pad-scoped table (everything that cascades from pads). */
  async function rowsFor(padId: string) {
    const { db } = h.api.ctx;
    return {
      pads: (await db.select().from(pads).where(eq(pads.id, padId))).length,
      members: (await db.select().from(padMembers).where(eq(padMembers.padId, padId))).length,
      docs: (await db.select().from(padDocs).where(eq(padDocs.padId, padId))).length,
      updates: (await db.select().from(padUpdates).where(eq(padUpdates.padId, padId))).length,
      messages: (await db.select().from(messages).where(eq(messages.padId, padId))).length,
      notes: (await db.select().from(interviewerNotes).where(eq(interviewerNotes.padId, padId)))
        .length,
      timeline: (await db.select().from(timelineEvents).where(eq(timelineEvents.padId, padId)))
        .length,
      runs: (await db.select().from(runs).where(eq(runs.padId, padId))).length,
      reports: (await db.select().from(reports).where(eq(reports.padId, padId))).length,
    };
  }

  async function endedPadWithEverything() {
    const owner = new Client(h.base, '198.51.100.21');
    const collab = new Client(h.base, '198.51.100.22');
    const owned = await owner.signUp('DelOwner');
    await collab.signUp('DelCollab');
    const pad = (await owner.post('/api/pads', { problemSlug: 'two-sum', language: 'python' }))
      .json;
    await collab.post('/api/pads/join', { shareToken: pad.shareToken });
    const { db } = h.api.ctx;
    await db.insert(padDocs).values({ padId: pad.id, state: new Uint8Array([0, 0]) });
    await db.insert(padUpdates).values({ padId: pad.id, seq: 1, update: new Uint8Array([0, 0]) });
    await db.insert(messages).values({
      padId: pad.id,
      role: 'candidate',
      kind: 'chat',
      intent: null,
      text: 'hello',
      via: 'text',
      userId: owned.id,
    });
    await db.insert(interviewerNotes).values({ padId: pad.id, note: 'private' });
    await db.insert(runs).values({
      padId: pad.id,
      userId: owned.id,
      mode: 'file',
      language: 'python',
      source: 'print(1)',
      status: 'finished',
      hiddenIds: [],
      testCount: 0,
      deadlineAt: new Date(),
    });
    expect((await owner.post(`/api/pads/${pad.id}/end`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100)); // let the report settle
    return { owner, collab, pad };
  }

  it('the owner deletes the pad and everything attached to it, for everyone', async () => {
    const { owner, collab, pad } = await endedPadWithEverything();
    const before = await rowsFor(pad.id);
    for (const [table, n] of Object.entries(before)) expect(n, table).toBeGreaterThan(0);
    expect(before.members).toBe(2);
    expect((await owner.get('/api/pads')).json[0]).toMatchObject({ id: pad.id, role: 'owner' });
    expect((await collab.get('/api/pads')).json[0]).toMatchObject({
      id: pad.id,
      role: 'collaborator',
    });

    const res = await owner.del(`/api/pads/${pad.id}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ padId: pad.id, removed: 'pad' });
    const after = await rowsFor(pad.id);
    for (const [table, n] of Object.entries(after)) expect(n, table).toBe(0);

    for (const c of [owner, collab]) {
      expect((await c.get(`/api/pads/${pad.id}`)).status).toBe(404);
      expect((await c.get(`/api/pads/${pad.id}/report`)).status).toBe(404);
      expect((await c.get(`/api/pads/${pad.id}/playback`)).status).toBe(404);
      expect((await c.get('/api/pads')).json).toEqual([]);
    }
    // A repeat (double click) is the plain not-found every pad route gives; nothing breaks.
    const again = await owner.del(`/api/pads/${pad.id}`);
    expect(again.status).toBe(404);
    expect(again.json.error.code).toBe('not_found');
    // The share token no longer leads anywhere.
    expect((await collab.post('/api/pads/join', { shareToken: pad.shareToken })).status).toBe(404);
    expect(h.fake.released).toContain(pad.id);
  });

  it('a collaborator only removes it from their own history', async () => {
    const { owner, collab, pad } = await endedPadWithEverything();
    const before = await rowsFor(pad.id);
    const res = await collab.del(`/api/pads/${pad.id}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ padId: pad.id, removed: 'membership' });
    expect(await rowsFor(pad.id)).toEqual({ ...before, members: 1 });
    expect((await collab.get(`/api/pads/${pad.id}`)).status).toBe(404);
    expect((await collab.get('/api/pads')).json).toEqual([]);
    expect((await collab.del(`/api/pads/${pad.id}`)).status).toBe(404);
    // The owner keeps everything.
    expect((await owner.get(`/api/pads/${pad.id}`)).json.role).toBe('owner');
    expect((await owner.get(`/api/pads/${pad.id}/report`)).status).toBe(200);
    expect((await owner.get('/api/pads')).json.map((p: { id: string }) => p.id)).toEqual([pad.id]);
    // The invite link still works if they want it back.
    expect((await collab.post('/api/pads/join', { shareToken: pad.shareToken })).status).toBe(200);
    expect((await collab.get(`/api/pads/${pad.id}`)).json.role).toBe('collaborator');
  });

  it('non-members get the same not-found as the other pad routes, and nothing changes', async () => {
    const { owner, pad } = await endedPadWithEverything();
    const stranger = new Client(h.base, '198.51.100.23');
    await stranger.signUp('Stranger');
    const before = await rowsFor(pad.id);
    const res = await stranger.del(`/api/pads/${pad.id}`);
    expect(res.status).toBe(404);
    expect(res.json).toEqual((await stranger.get(`/api/pads/${pad.id}`)).json);
    expect((await stranger.del('/api/pads/not-a-uuid')).status).toBe(404);
    expect((await new Client(h.base).del(`/api/pads/${pad.id}`)).status).toBe(401);
    // State-changing: a foreign origin is refused like any other.
    expect(
      (
        await owner.req('DELETE', `/api/pads/${pad.id}`, undefined, {
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect(await rowsFor(pad.id)).toEqual(before);
  });
});

describe('social sign-in', () => {
  it('offers Google when configured and starts the flow with our callback URLs', async () => {
    const g = await startApi({
      config: {
        google: { clientId: 'test-client-id.apps.googleusercontent.com', clientSecret: 's' },
      },
    });
    try {
      const c = new Client(g.base);
      expect((await c.get('/api/config')).json).toMatchObject({
        googleAuth: true,
        githubAuth: false,
      });

      const start = await c.post('/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL: `${TEST_WEB_ORIGIN}/dashboard`,
        errorCallbackURL: `${TEST_WEB_ORIGIN}/sign-in`,
      });
      expect(start.status).toBe(200);
      const url = new URL(start.json.url);
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
      // The provider returns to the web origin; Next rewrites /api/* to the API.
      expect(url.searchParams.get('redirect_uri')).toBe(
        `${TEST_WEB_ORIGIN}/api/auth/callback/google`,
      );

      // Callback and error targets on another origin are refused.
      const evil = await c.post('/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL: 'https://evil.example/steal',
      });
      expect(evil.status).toBe(403);
    } finally {
      await g.stop();
    }
  });

  it('is unavailable when no provider is configured', async () => {
    // The developer's root .env may configure Google; this test needs it off.
    const g = await startApi({ config: { google: null, github: null } });
    try {
      const c = new Client(g.base);
      const res = await c.post('/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL: `${TEST_WEB_ORIGIN}/dashboard`,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      await g.stop();
    }
  });
});
