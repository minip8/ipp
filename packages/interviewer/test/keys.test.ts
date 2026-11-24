/** Bring-your-own-key behaviour: no key, rejected key, rate limits, client cache, verification. */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { interviewerConfigFromEnv } from '../src/config';
import { ClientCache } from '../src/interviewer';
import {
  anthropicClient,
  classifyError,
  keyFailureOf,
  type ModelClient,
  scrubSecrets,
  verifyApiKey,
} from '../src/model';
import { FakeModel, harness, TEST_KEY } from './harness';

const SHORT_Q = {
  id: 'q-1',
  topic: 't',
  subtopic: 's',
  difficulty: 'easy' as const,
  prompt: 'Why?',
  explanation: '',
  tags: [],
  type: 'short' as const,
  reference: 'Because.',
  keyPoints: ['a'],
};

const apiError = (status: number, body: object, message = 'x') =>
  Anthropic.APIError.generate(status, body, message, new Headers());

describe('no key', () => {
  it('stays silent: no model calls, no messages, no thinking indicator', async () => {
    const h = harness({ key: { ok: false, state: 'missing' } });
    await h.start();
    await h.say('Can I assume the input is sorted?');
    await h.type(30);
    await h.advance(200);
    expect(h.model.calls).toHaveLength(0);
    expect(h.saved).toHaveLength(0);
    expect(h.events.filter((e) => e.type === 'interviewer.thinking')).toHaveLength(0);
    expect(h.keyLookups.length).toBeGreaterThan(0);
    expect(h.keyLookups.every((s) => 'padId' in s && s.padId === h.padId)).toBe(true);
  });

  it('greets once the owner adds a key a few minutes in', async () => {
    const h = harness({ key: { ok: false, state: 'missing' } });
    await h.start();
    await h.advance(120);
    expect(h.saved).toHaveLength(0);
    h.key = { ok: true, keyId: 'k2', provider: 'anthropic', apiKey: TEST_KEY };
    await h.advance(5);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({ kind: 'proactive', intent: 'greeting' });
  });

  it('assessment and grading return null without calling the model', async () => {
    const h = harness({ key: { ok: false, state: 'missing' } });
    expect(await h.iv.generateAssessment(h.padId)).toBeNull();
    expect(await h.iv.gradeShortAnswer('quiz-user', SHORT_Q, 'because')).toBeNull();
    expect(h.model.calls).toHaveLength(0);
    expect(h.keyLookups).toContainEqual({ userId: 'quiz-user' });
    expect(h.keyLookups).toContainEqual({ padId: h.padId });
  });

  it('a rejected key behaves like no key (silent, no notice) until replaced', async () => {
    const h = harness({ key: { ok: false, state: 'rejected' } });
    await h.start();
    await h.say('hello?');
    await h.advance(60);
    expect(h.model.calls).toHaveLength(0);
    expect(h.saved).toHaveLength(0);
  });
});

describe('key rejected while in use', () => {
  const refuse = () => ({
    error: 'permanent' as const,
    keyFailure: 'invalid' as const,
    status: 401,
  });

  it('posts one clear notice, reports the key, then stays silent', async () => {
    const model = new FakeModel(refuse);
    const h = harness({ model });
    await h.start();
    expect(h.rejected).toEqual([{ scope: { padId: h.padId }, keyId: 'k1', problem: 'invalid' }]);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]?.text).toMatch(/rejected the API key/);
    expect(h.saved[0]?.text).toMatch(/AI key/);
    const calls = model.calls.length;
    await h.say('are you there?');
    await h.say('hello?');
    await h.type(20);
    await h.advance(300);
    expect(model.calls.length).toBe(calls);
    expect(h.saved).toHaveLength(1);
    expect(h.rejected).toHaveLength(1);
    expect(JSON.stringify(h.logs)).not.toContain(TEST_KEY);
    expect(h.iv.cachedClients()).toBe(0);
  });

  it('a new key brings the interviewer back; a second rejection gets its own notice', async () => {
    let fail = true;
    const model = new FakeModel((req) =>
      fail ? refuse() : req.purpose === 'decision' ? '{}' : 'Back again.',
    );
    const h = harness({ model, greeted: true });
    await h.say('hi');
    expect(h.saved.map((m) => m.text)).toEqual([expect.stringMatching(/rejected/)]);
    fail = false;
    h.key = { ok: true, keyId: 'k2', provider: 'anthropic', apiKey: `${TEST_KEY}-2` };
    await h.say('hi again');
    expect(h.replies().at(-1)?.text).toBe('Back again.');
    fail = true;
    await h.say('and again');
    expect(h.saved.filter((m) => /rejected/.test(m.text))).toHaveLength(2);
    expect(h.rejected.map((r) => r.keyId)).toEqual(['k1', 'k2']);
  });

  it('a rejection during a silent decision also posts the notice once', async () => {
    const model = new FakeModel((_req, n) => (n === 1 ? 'Hello!' : refuse()));
    const h = harness({ model, settings: { proactivity: 'high' } });
    await h.start();
    await h.type(40);
    await h.advance(400);
    expect(h.saved.filter((m) => /rejected/.test(m.text))).toHaveLength(1);
    expect(h.rejected).toHaveLength(1);
  });

  it('assessment and grading report the rejection and return null', async () => {
    const h = harness({ model: new FakeModel(refuse) });
    expect(await h.iv.generateAssessment(h.padId)).toBeNull();
    expect(h.rejected).toEqual([{ scope: { padId: h.padId }, keyId: 'k1', problem: 'invalid' }]);
    h.key = { ok: true, keyId: 'k9', provider: 'anthropic', apiKey: TEST_KEY };
    expect(await h.iv.gradeShortAnswer('quiz-user', SHORT_Q, 'x')).toBeNull();
    expect(h.rejected[1]).toEqual({
      scope: { userId: 'quiz-user' },
      keyId: 'k9',
      problem: 'invalid',
    });
  });
});

describe('rate limits on the user key', () => {
  it('a rate-limited reply says so, keeps the key, and backs off proactive turns', async () => {
    let limited = true;
    const model = new FakeModel((req) =>
      limited && req.purpose === 'reply'
        ? { error: 'transient', keyFailure: 'rate_limited', status: 429 }
        : req.purpose === 'decision'
          ? '{}'
          : 'ok',
    );
    const h = harness({ model, greeted: true });
    await h.say('question');
    expect(h.replies().at(-1)?.text).toMatch(/rate-limiting/);
    expect(h.rejected).toHaveLength(0);
    limited = false;
    await h.say('question 2');
    expect(h.replies().at(-1)?.text).toBe('ok');
  });
});

describe('client cache', () => {
  const fake = (): ModelClient => new FakeModel();

  it('one client per key id and model, LRU-bounded, dropped when idle or on request', async () => {
    const made: string[] = [];
    const cache = new ClientCache(
      (k, model) => {
        made.push(`${k.apiKey}/${model}`);
        return fake();
      },
      3,
      50,
    );
    const key = (id: string) => ({
      ok: true as const,
      keyId: id,
      provider: 'anthropic' as const,
      apiKey: `k${id}`,
    });
    const a = cache.get(key('a'), 'm');
    expect(cache.get(key('a'), 'm')).toBe(a);
    expect(cache.get(key('a'), 'other')).not.toBe(a); // another model: another client
    cache.get(key('b'), 'm');
    cache.get(key('c'), 'm');
    expect(cache.size).toBe(3);
    cache.get(key('a'), 'm'); // a/m was evicted
    expect(made).toEqual(['ka/m', 'ka/other', 'kb/m', 'kc/m', 'ka/m']);
    cache.drop('a'); // every model of key a
    expect(cache.size).toBe(2);
    await new Promise((r) => setTimeout(r, 80));
    cache.sweep();
    expect(cache.size).toBe(0);
  });

  it('a replaced key (new key id) gets a new client', async () => {
    const h = harness({ greeted: true });
    await h.say('one');
    expect(h.iv.cachedClients()).toBe(1);
    h.key = { ok: true, keyId: 'k2', provider: 'anthropic', apiKey: `${TEST_KEY}-2` };
    await h.say('two');
    expect(h.iv.cachedClients()).toBe(2);
  });
});

describe('classifying Anthropic errors', () => {
  it.each([
    [401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid'],
    [403, { error: { type: 'permission_error', message: 'no' } }, 'permission'],
    [402, { error: { type: 'billing_error', message: 'pay' } }, 'billing'],
    [
      400,
      { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } },
      'billing',
    ],
    [404, { error: { type: 'not_found_error', message: 'model: claude-opus-5-5' } }, 'permission'],
    [
      429,
      {
        error: {
          type: 'rate_limit_error',
          message: 'limit',
          details: { error_code: 'enforced_spend_limit_reached' },
        },
      },
      'spend_limit',
    ],
    [429, { error: { type: 'rate_limit_error', message: 'slow down' } }, 'rate_limited'],
    [400, { error: { type: 'invalid_request_error', message: 'bad field' } }, undefined],
    [529, { error: { type: 'overloaded_error', message: 'busy' } }, undefined],
  ])('%i %j -> %s', (status, body, expected) => {
    expect(keyFailureOf(apiError(status, body))).toBe(expected);
    const e = classifyError(apiError(status, body));
    expect(e.keyFailure).toBe(expected);
  });

  it('scrubs anything that looks like a key from messages', () => {
    expect(scrubSecrets(`bad key ${TEST_KEY} here`)).toBe('bad key sk-ant-[redacted] here');
    expect(classifyError(new Error(`boom ${TEST_KEY}`)).message).not.toContain(TEST_KEY);
  });
});

describe('no operator key', () => {
  it('the config has no key, whatever the environment says', () => {
    const c = interviewerConfigFromEnv({
      ANTHROPIC_API_KEY: 'sk-ant-operator-000000000000000000',
      ANTHROPIC_KEY: 'sk-ant-operator-111111111111111111',
      INTERVIEWER_MODEL: 'm',
    });
    expect(c).toEqual({ model: 'm' });
  });

  it('a client is never built without an explicit key (the SDK would read the env)', () => {
    const before = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-operator-000000000000000000';
    try {
      expect(() => anthropicClient('')).toThrow(/no API key/);
      expect(() => anthropicClient('   ')).toThrow(/no API key/);
      expect(anthropicClient(TEST_KEY).apiKey).toBe(TEST_KEY);
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = before;
    }
  });
});

describe('verifyApiKey', () => {
  function fakeFetch(status: number, body: object) {
    const seen: { url: string; key: string | null; body: unknown }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(url),
        key:
          headers.get('x-api-key') ?? headers.get('authorization')?.replace(/^Bearer /, '') ?? null,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'request-id': 'req_1' },
      });
    }) as typeof fetch;
    return { f, seen };
  }

  it('accepts a working key with one tiny call to the interviewer model', async () => {
    const { f, seen } = fakeFetch(200, {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 1 },
    });
    expect(await verifyApiKey(TEST_KEY, 'claude-opus-5-5', { fetch: f })).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.key).toBe(TEST_KEY);
    expect(seen[0]?.url).toMatch(/\/v1\/messages$/);
    expect(seen[0]?.body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16 });
  });

  it('maps refusals to problems and outages to unverifiable', async () => {
    const r401 = fakeFetch(401, {
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    expect(await verifyApiKey(TEST_KEY, 'm', { fetch: r401.f })).toEqual({
      ok: false,
      problem: 'invalid',
    });
    const r529 = fakeFetch(529, {
      type: 'error',
      error: { type: 'overloaded_error', message: '' },
    });
    expect(await verifyApiKey(TEST_KEY, 'm', { fetch: r529.f })).toEqual({
      ok: false,
      problem: 'unverifiable',
    });
    expect(r529.seen).toHaveLength(1); // no retries: saving must not turn into a burst of calls
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await verifyApiKey(TEST_KEY, 'm', { fetch: down })).toEqual({
      ok: false,
      problem: 'unverifiable',
    });
  });
});
