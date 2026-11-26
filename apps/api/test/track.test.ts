/**
 * The site track (Software | Quant): `user.track` on `GET /api/me`, `PUT /api/me/track`, and
 * `also` on every topic shape (a topic shown in more than its home's track).
 */
import { SetTrackResponse } from '@ipp/contracts';
import { quizTopics, user } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config';
import { Client, flushRedis, type Harness, startApi } from './helpers/harness';

let h: Harness;
let ipCounter = 0;
const SHARED = {
  slug: 'track-shared',
  title: 'Shared topic',
  description: 'A fundamentals topic also shown in the Quant track',
  track: 'fundamentals' as const,
  also: ['quant' as const],
  position: 99,
};
beforeAll(async () => {
  await flushRedis();
  h = await startApi();
  await h.api.ctx.db.insert(quizTopics).values(SHARED).onConflictDoNothing();
});
afterAll(async () => {
  await h?.api.ctx.db.delete(quizTopics).where(eq(quizTopics.slug, SHARED.slug));
  await h?.stop();
});
beforeEach(() => {
  h.api.ctx.config.limits = structuredClone(DEFAULT_LIMITS);
});

const client = () => new Client(h.base, `198.51.102.${++ipCounter}`);
async function account(name: string) {
  const c = client();
  const { email, id } = await c.signUp(name);
  return Object.assign(c, { email, id });
}

describe('the site track', () => {
  it('is null until chosen, then the chosen one, and it lasts beyond the session', async () => {
    const c = await account('Tracy');
    expect((await c.get('/api/me')).json.user).toMatchObject({ id: c.id, track: null });

    const set = await c.put('/api/me/track', { track: 'quant' });
    expect(set.status).toBe(200);
    expect(set.json).toEqual({ track: 'quant' });
    expect(SetTrackResponse.parse(set.json)).toEqual({ track: 'quant' });
    // Straight away, not after a session refresh.
    expect((await c.get('/api/me')).json.user.track).toBe('quant');
    const [row] = await h.api.ctx.db
      .select({ track: user.track })
      .from(user)
      .where(eq(user.id, c.id));
    expect(row?.track).toBe('quant');

    expect((await c.put('/api/me/track', { track: 'software' })).json).toEqual({
      track: 'software',
    });
    // Signed out and in again: still there, and the user's other fields are untouched.
    expect((await c.post('/api/auth/sign-out', {})).status).toBe(200);
    const again = await c.post('/api/auth/sign-in/email', {
      email: c.email,
      password: 'correct horse battery',
    });
    expect(again.status).toBe(200);
    expect((await c.get('/api/me')).json).toEqual({
      user: {
        id: c.id,
        name: 'Tracy',
        email: c.email,
        image: null,
        guest: false,
        track: 'software',
      },
    });
  });

  it('validates the body: an unknown track, a missing one, and not JSON', async () => {
    const c = await account('Picky');
    for (const body of [{ track: 'fundamentals' }, { track: 'physics' }, {}, { track: null }]) {
      const res = await c.put('/api/me/track', body);
      expect([res.status, res.json.error.code], JSON.stringify(body)).toEqual([
        400,
        'validation_error',
      ]);
    }
    const raw = await c.req('PUT', '/api/me/track', 'not json');
    expect([raw.status, raw.json.error.code]).toEqual([400, 'invalid_json']);
    expect((await c.get('/api/me')).json.user.track).toBeNull();
  });

  it('needs an account: anonymous callers and guests are refused; a guest has no track', async () => {
    const anon = client();
    const refused = await anon.put('/api/me/track', { track: 'quant' });
    expect([refused.status, refused.json.error.code]).toEqual([401, 'unauthorized']);

    const host = await account('Host');
    const room = await host.post('/api/pads', { kind: 'room', language: 'python', blank: true });
    expect(room.status).toBe(200);
    const guest = client();
    const joined = await guest.post('/api/pads/join-guest', {
      shareToken: room.json.shareToken,
      name: 'Casey',
    });
    expect(joined.status).toBe(200);
    expect((await guest.get('/api/me')).json.user).toMatchObject({ guest: true, track: null });
    const res = await guest.put('/api/me/track', { track: 'quant' });
    expect([res.status, res.json.error.code]).toEqual([403, 'account_required']);
    const guestId = (await guest.get('/api/me')).json.user.id as string;
    const [row] = await h.api.ctx.db
      .select({ track: user.track })
      .from(user)
      .where(eq(user.id, guestId));
    expect(row?.track).toBeNull();
  });

  it('a guest who signs in to an account that chose a track gets that track', async () => {
    const owner = await account('Quinn');
    await owner.put('/api/me/track', { track: 'quant' });

    const host = await account('Hosting');
    const room = await host.post('/api/pads', { kind: 'room', language: 'python', blank: true });
    const guest = client();
    await guest.post('/api/pads/join-guest', { shareToken: room.json.shareToken, name: 'Q' });
    const guestId = (await guest.get('/api/me')).json.user.id as string;
    const signIn = await guest.post('/api/auth/sign-in/email', {
      email: owner.email,
      password: 'correct horse battery',
    });
    expect(signIn.status).toBe(200);
    expect((await guest.get('/api/me')).json.user).toMatchObject({
      id: owner.id,
      guest: false,
      track: 'quant',
    });
    // The anonymous plugin deleted the guest once it was linked.
    expect(await h.api.ctx.db.select().from(user).where(eq(user.id, guestId))).toEqual([]);
  });

  it('is rate limited', async () => {
    h.api.ctx.config.limits.trackChanges.userBurst = { limit: 2, windowSec: 60 };
    const c = await account('Flip');
    expect((await c.put('/api/me/track', { track: 'quant' })).status).toBe(200);
    expect((await c.put('/api/me/track', { track: 'software' })).status).toBe(200);
    const limited = await c.put('/api/me/track', { track: 'quant' });
    expect(limited.status).toBe(429);
    expect(limited.json.error.retryAfter).toBeGreaterThan(0);
    expect((await c.get('/api/me')).json.user.track).toBe('software');
  });
});

describe('also on every topic shape', () => {
  // Read raw: parsing with the contract would default a missing `also` to [].
  it('the topic list, the roadmap and the bank carry also', async () => {
    const c = await account('Shapes');
    const topics = (await c.get('/api/quiz/topics')).json as Record<string, unknown>[];
    expect(topics.find((t) => t.slug === SHARED.slug)).toMatchObject({
      track: 'fundamentals',
      also: ['quant'],
    });
    expect(topics.find((t) => t.slug === 'test-topic')).toMatchObject({ also: [] });

    const roadmap = (await c.get('/api/quiz/roadmap')).json as Record<string, unknown>[];
    expect(roadmap.find((t) => t.slug === SHARED.slug)).toMatchObject({
      track: 'fundamentals',
      also: ['quant'],
    });
    expect(roadmap.find((t) => t.slug === 'test-topic')).toMatchObject({ also: [] });

    const bank = await c.get(`/api/quiz/topics/${SHARED.slug}/questions`);
    expect(bank.status).toBe(200);
    expect(bank.json.topic).toEqual({
      slug: SHARED.slug,
      title: SHARED.title,
      description: SHARED.description,
      track: 'fundamentals',
      also: ['quant'],
    });
    expect((await c.get('/api/quiz/topics/test-topic/questions')).json.topic.also).toEqual([]);
  });
});
