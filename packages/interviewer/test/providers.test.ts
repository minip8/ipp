/**
 * Providers other than Anthropic: the OpenAI-compatible client (OpenAI, Gemini, OpenRouter) on an
 * injected fetch, per-provider error classification, model listing and key verification, and the
 * interviewer's "chosen model unavailable" fallback that keeps the key.
 *
 * Request/response shapes follow the providers' docs; none of this ran against a real API.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { interviewerConfigFromEnv } from '../src/config';
import { ModelError, scrubSecrets } from '../src/model';
import { OpenAICompatModelClient, strictJsonSchema, toChatMessages } from '../src/openai-compat';
import {
  classifyGemini,
  classifyOpenAI,
  classifyOpenRouter,
  createModelClient,
  defaultModelFor,
  fallbackModels,
  listProviderModels,
  PROVIDERS,
  verifyProviderKey,
} from '../src/providers';
import { FakeModel, harness, speak } from './harness';

const OPENAI_KEY = 'sk-proj-TESTopenaiKEY-0123456789abcdefghijklmnop';
const GEMINI_KEY = 'AIzaSyTESTgeminiKEY_0123456789abcdefghi';
const OPENROUTER_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab';

type Seen = { url: string; headers: Headers; body: Record<string, unknown> | null };

/** A fetch that records requests and answers from `respond`. */
function fakeFetch(respond: (req: Seen, n: number) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const req: Seen = {
      url: String(url),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    seen.push(req);
    const signal = init?.signal;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return respond(req, seen.length);
  }) as typeof fetch;
  return { f, seen };
}

/** An SSE body of chat.completion.chunk events (OpenAI shape), ending with usage and [DONE]. */
function sse(text: string, opts: { finish?: string; refusal?: string; cached?: number } = {}) {
  const lines: string[] = [];
  const chunk = (o: object) => lines.push(`data: ${JSON.stringify(o)}\n\n`);
  chunk({ model: 'gpt-test-2026', choices: [{ index: 0, delta: { role: 'assistant' } }] });
  for (const part of text.match(/.{1,4}/gs) ?? [])
    chunk({ model: 'gpt-test-2026', choices: [{ index: 0, delta: { content: part } }] });
  if (opts.refusal) chunk({ choices: [{ index: 0, delta: { refusal: opts.refusal } }] });
  chunk({ choices: [{ index: 0, delta: {}, finish_reason: opts.finish ?? 'stop' }] });
  chunk({
    choices: [],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 9,
      prompt_tokens_details: { cached_tokens: opts.cached ?? 100 },
    },
  });
  lines.push('data: [DONE]\n\n');
  return new Response(lines.join(''), { headers: { 'content-type': 'text/event-stream' } });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const request = (extra: Record<string, unknown> = {}) => ({
  purpose: 'decision' as const,
  system: [
    { type: 'text' as const, text: 'core', cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: 'problem' },
  ],
  messages: [
    { role: 'user' as const, content: 'data' },
    { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'said' }] },
    { role: 'user' as const, content: 'more data' },
    { role: 'system' as const, content: 'task' },
  ],
  effort: 'low' as const,
  maxTokens: 1000,
  timeoutMs: 5000,
  ...extra,
});

const openai = (f: typeof fetch, model = 'gpt-test') =>
  createModelClient('openai', OPENAI_KEY, model, { fetch: f });

describe('OpenAI-compatible client', () => {
  it('streams text, sends effort, structured output and the operator channel; reads usage', async () => {
    const { f, seen } = fakeFetch(() => sse('{"ok":true}'));
    const deltas: string[] = [];
    const res = await openai(f).call(
      request({ schema: z.object({ ok: z.boolean() }), onText: (d: string) => deltas.push(d) }),
    );
    expect(res.text).toBe('{"ok":true}');
    expect(deltas.join('')).toBe('{"ok":true}');
    expect(res).toMatchObject({ refused: false, stopReason: 'stop', model: 'gpt-test-2026' });
    expect(res.usage).toEqual({
      inputTokens: 20,
      outputTokens: 9,
      cacheReadInputTokens: 100,
      cacheCreationInputTokens: 0,
    });
    expect(res.ttftMs).not.toBeNull();

    const req = seen[0] as Seen;
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(req.headers.get('authorization')).toBe(`Bearer ${OPENAI_KEY}`);
    const body = req.body as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-test',
      stream: true,
      reasoning_effort: 'low',
      max_completion_tokens: 1000,
      stream_options: { include_usage: true, include_obfuscation: false },
    });
    // Operator text keeps its own role (OpenAI: developer), in place.
    expect(body.messages).toEqual([
      { role: 'developer', content: 'core\n\nproblem' },
      { role: 'user', content: 'data' },
      { role: 'assistant', content: 'said' },
      { role: 'user', content: 'more data' },
      { role: 'developer', content: 'task' },
    ]);
    const format = body.response_format as {
      type: string;
      json_schema: {
        strict: boolean;
        schema: { additionalProperties: boolean; required: string[] };
      };
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema).toMatchObject({
      additionalProperties: false,
      required: ['ok'],
    });
  });

  it('Gemini and OpenRouter: fixed hosts, their effort parameter, system role kept', async () => {
    const { f, seen } = fakeFetch(() => sse('hi'));
    await createModelClient('gemini', GEMINI_KEY, 'gemini-x', { fetch: f }).call(request());
    await createModelClient('openrouter', OPENROUTER_KEY, 'vendor/model', { fetch: f }).call(
      request({ effort: 'high' }),
    );
    expect(seen[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
    expect(seen[0]?.body).toMatchObject({ reasoning_effort: 'low', max_tokens: 1000 });
    expect(seen[0]?.body).not.toHaveProperty('max_completion_tokens');
    const messages = (seen[0]?.body?.messages ?? []) as { role: string }[];
    expect(messages[0]?.role).toBe('system');
    expect(seen[1]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(seen[1]?.body).toMatchObject({ reasoning: { effort: 'high' } });
    expect(seen[1]?.body).not.toHaveProperty('reasoning_effort');
  });

  it('reports refusals', async () => {
    const { f } = fakeFetch(() => sse('', { refusal: 'I cannot help with that.' }));
    expect(await openai(f).call(request())).toMatchObject({ refused: true, stopReason: 'refusal' });
    const filtered = fakeFetch(() => sse('', { finish: 'content_filter' }));
    expect((await openai(filtered.f).call(request())).refused).toBe(true);
  });

  it('retries without reasoning effort once when a model does not take it, then remembers', async () => {
    const { f, seen } = fakeFetch((req) =>
      'reasoning_effort' in (req.body ?? {})
        ? json(400, {
            error: {
              message:
                "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
              type: 'invalid_request_error',
              param: 'reasoning_effort',
              code: 'unsupported_parameter',
            },
          })
        : sse('ok'),
    );
    const client = openai(f);
    expect((await client.call(request())).text).toBe('ok');
    expect((await client.call(request())).text).toBe('ok');
    expect(seen.map((s) => 'reasoning_effort' in (s.body ?? {}))).toEqual([true, false, false]);
  });

  it('retries transient failures, not key failures', async () => {
    const flaky = fakeFetch((_r, n) =>
      n === 1 ? json(503, { error: { message: 'busy' } }) : sse('ok'),
    );
    expect((await openai(flaky.f).call(request())).text).toBe('ok');
    expect(flaky.seen).toHaveLength(2);
    const bad = fakeFetch(() => json(401, { error: { message: 'Incorrect API key provided' } }));
    await expect(openai(bad.f).call(request())).rejects.toMatchObject({
      kind: 'permanent',
      status: 401,
      keyFailure: 'invalid',
    });
    expect(bad.seen).toHaveLength(1);
  });

  it('a mid-stream error chunk (OpenRouter) is a transient failure', async () => {
    const { f } = fakeFetch(
      () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'par' } }] })}\n\n: OPENROUTER PROCESSING\n\ndata: ${JSON.stringify({ error: { code: 502, message: 'provider down' }, choices: [{ delta: {}, finish_reason: 'error' }] })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    await expect(
      createModelClient('openrouter', OPENROUTER_KEY, 'm', { fetch: f }).call(request()),
    ).rejects.toMatchObject({ kind: 'transient' });
  });

  it('enforces an overall deadline on a stalled stream, and reports an external abort', async () => {
    const stalled = (signal?: AbortSignal | null) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
            signal?.addEventListener('abort', () =>
              c.error(new DOMException('aborted', 'AbortError')),
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    const f = (async (_u: unknown, init?: RequestInit) => stalled(init?.signal)) as typeof fetch;
    const err = await openai(f)
      .call(request({ timeoutMs: 200 }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.kind).toBe('transient');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    const aborted = await openai(f)
      .call(request({ signal: ac.signal }))
      .catch((e) => e);
    expect(aborted).toMatchObject({ kind: 'aborted' });
  });

  it('never builds a client without a key', () => {
    expect(() => new OpenAICompatModelClient('', 'm', { ...openAIOpts() })).toThrow(/no API key/);
    expect(() => createModelClient('gemini', '  ', 'm')).toThrow(/no API key/);
  });
});

const openAIOpts = () => ({
  baseURL: 'https://api.openai.com/v1',
  classify: classifyOpenAI,
  effortParam: 'reasoning_effort' as const,
});

describe('error classification per provider', () => {
  const pe = (
    o: Partial<{ message: string; code: string; type: string; status: string }> = {},
  ) => ({
    message: o.message ?? '',
    code: o.code ?? null,
    type: o.type ?? null,
    status: o.status ?? null,
    reasons: [] as string[],
    param: null,
  });

  it.each([
    [401, pe({ message: 'Incorrect API key provided' }), 'invalid', false],
    [403, pe({ message: 'Country, region, or territory not supported' }), 'permission', false],
    [404, pe({ code: 'model_not_found' }), 'permission', true],
    [429, pe({ type: 'insufficient_quota', code: 'credit_balance_exhausted' }), 'billing', false],
    [429, pe({ code: 'organization_spend_limit_exceeded' }), 'spend_limit', false],
    [429, pe({ code: 'project_spend_limit_exceeded' }), 'spend_limit', false],
    [429, pe({ message: 'Rate limit reached for requests' }), 'rate_limited', false],
    [500, pe(), undefined, false],
  ])('OpenAI %i %j -> %s', (status, e, expected, model) => {
    const f = classifyOpenAI(status, e);
    expect(f.keyFailure).toBe(expected);
    expect(!!f.modelUnavailable).toBe(model);
  });

  it('OpenAI: an unsupported parameter makes the model unavailable, not the key', () => {
    const f = classifyOpenAI(400, pe({ message: "Unsupported value: 'response_format'" }));
    expect(f).toMatchObject({ kind: 'permanent', modelUnavailable: true });
    expect(f.keyFailure).toBeUndefined();
  });

  it('Gemini: array bodies, API_KEY_INVALID, quotas are transient', async () => {
    const { providerError } = await import('../src/openai-compat');
    const body = [
      {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [
            { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
          ],
        },
      },
    ];
    expect(classifyGemini(400, providerError(body)).keyFailure).toBe('invalid');
    expect(classifyGemini(403, pe({ status: 'PERMISSION_DENIED' })).keyFailure).toBe('permission');
    expect(classifyGemini(402, pe({ status: 'RESOURCE_EXHAUSTED' })).keyFailure).toBe('billing');
    expect(classifyGemini(404, pe({ status: 'NOT_FOUND' }))).toMatchObject({
      keyFailure: 'permission',
      modelUnavailable: true,
    });
    expect(classifyGemini(429, pe({ status: 'RESOURCE_EXHAUSTED' }))).toMatchObject({
      kind: 'transient',
      keyFailure: 'rate_limited',
    });
    expect(classifyGemini(400, pe({ status: 'FAILED_PRECONDITION' })).keyFailure).toBe(
      'permission',
    );
    expect(classifyGemini(503, pe()).kind).toBe('transient');
  });

  it('OpenRouter: 402 credits, 403 moderation is not about the key, 404 is the model', () => {
    expect(classifyOpenRouter(401, pe()).keyFailure).toBe('invalid');
    expect(classifyOpenRouter(402, pe({ message: 'Insufficient credits' })).keyFailure).toBe(
      'billing',
    );
    expect(classifyOpenRouter(402, pe({ message: 'Key limit exceeded' })).keyFailure).toBe(
      'spend_limit',
    );
    expect(classifyOpenRouter(403, pe({ message: 'flagged' })).keyFailure).toBeUndefined();
    expect(classifyOpenRouter(404, pe())).toMatchObject({ modelUnavailable: true });
    expect(classifyOpenRouter(404, pe()).keyFailure).toBeUndefined();
    expect(classifyOpenRouter(400, pe({ message: 'x/y is not a valid model ID' }))).toMatchObject({
      modelUnavailable: true,
    });
    expect(classifyOpenRouter(429, pe()).keyFailure).toBe('rate_limited');
  });

  it('scrubs every supported key shape', () => {
    for (const k of [OPENAI_KEY, GEMINI_KEY, OPENROUTER_KEY, 'sk-svcacct-abcdefghijklmnop1234'])
      expect(scrubSecrets(`oops ${k} there`)).not.toContain(k);
    expect(scrubSecrets(`Authorization: Bearer ${OPENAI_KEY}`)).not.toContain('TESTopenai');
    const e = new ModelError('permanent', `bad ${GEMINI_KEY}`);
    expect(e.message).not.toContain(GEMINI_KEY);
  });
});

describe('listing models', () => {
  it('OpenAI: chat models only, newest first, default always present and marked', async () => {
    const { f, seen } = fakeFetch(() =>
      json(200, {
        object: 'list',
        data: [
          { id: 'gpt-old', object: 'model', created: 1, owned_by: 'openai' },
          { id: 'gpt-new', object: 'model', created: 3, owned_by: 'openai' },
          { id: 'gpt-new-2026-01-01', object: 'model', created: 2, owned_by: 'openai' },
          { id: 'text-embedding-9', object: 'model', created: 4, owned_by: 'openai' },
          { id: 'gpt-realtime-x', object: 'model', created: 5, owned_by: 'openai' },
          { id: 'whisper-2', object: 'model', created: 6, owned_by: 'openai' },
        ],
      }),
    );
    const list = await listProviderModels('openai', OPENAI_KEY, 'gpt-default', { fetch: f });
    expect(list.map((m) => m.id)).toEqual(['gpt-default', 'gpt-new', 'gpt-old']);
    expect(list.filter((m) => m.default).map((m) => m.id)).toEqual(['gpt-default']);
    expect(seen[0]?.url).toBe('https://api.openai.com/v1/models');
  });

  it('Gemini: the native list, generateContent text models, ids without "models/"', async () => {
    const { f, seen } = fakeFetch(() =>
      json(200, {
        models: [
          {
            name: 'models/gemini-4-hydrogen',
            displayName: 'Gemini 4 Hydrogen',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          { name: 'models/gemini-embedding-2', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-4-image', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/imagen-5', supportedGenerationMethods: ['predict'] },
        ],
      }),
    );
    const list = await listProviderModels('gemini', GEMINI_KEY, 'gemini-4-hydrogen', { fetch: f });
    expect(list).toEqual([{ id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', default: true }]);
    expect(seen[0]?.url).toMatch(
      /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\?/,
    );
    expect(seen[0]?.headers.get('x-goog-api-key')).toBe(GEMINI_KEY);
  });

  it('OpenRouter: the public catalogue (no key sent), structured-output text models', async () => {
    const { f, seen } = fakeFetch(() =>
      json(200, {
        data: [
          {
            id: 'openai/gpt-6.2-sol',
            name: 'OpenAI: GPT-6.2 Sol',
            architecture: { output_modalities: ['text'] },
            supported_parameters: ['response_format', 'structured_outputs', 'reasoning'],
          },
          {
            id: 'some/image-model',
            name: 'Image',
            architecture: { output_modalities: ['image', 'text'] },
            supported_parameters: ['structured_outputs'],
          },
          {
            id: 'some/plain',
            name: 'Plain',
            architecture: { output_modalities: ['text'] },
            supported_parameters: ['temperature'],
          },
        ],
      }),
    );
    const list = await listProviderModels('openrouter', OPENROUTER_KEY, 'openai/gpt-6.2-sol', {
      fetch: f,
    });
    expect(list.map((m) => m.id)).toEqual(['openai/gpt-6.2-sol']);
    expect(seen[0]?.headers.get('authorization')).toBeNull();
  });

  it('Anthropic: capability-filtered live list, curated models first', async () => {
    const { f } = fakeFetch(() =>
      json(200, {
        data: [
          model('claude-haiku-5-5', 'Claude Haiku 5.5'),
          model('claude-new-7', 'Claude New 7'),
          model('claude-opus-5-5', 'Claude Opus 5.5'),
          model('claude-fable-5-2', 'Claude Fable 5.2'),
          { ...model('claude-old-3', 'Claude Old 3'), capabilities: caps(false) },
        ],
        has_more: false,
        first_id: 'a',
        last_id: 'b',
      }),
    );
    const list = await listProviderModels('anthropic', 'sk-ant-api03-x', 'claude-opus-5-5', {
      fetch: f,
    });
    expect(list.map((m) => m.id)).toEqual([
      'claude-fable-5-2',
      'claude-opus-5-5',
      'claude-haiku-5-5',
      'claude-new-7',
    ]);
    expect(list.find((m) => m.default)?.id).toBe('claude-opus-5-5');
  });

  it('a listing refused for the key is a classified error without the key in it', async () => {
    const { f } = fakeFetch(() => json(401, { error: { message: `bad key ${OPENAI_KEY}` } }));
    const err = await listProviderModels('openai', OPENAI_KEY, 'd', { fetch: f }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.keyFailure).toBe('invalid');
    expect(err.message).not.toContain(OPENAI_KEY);
  });

  it('the built-in fallback is the curated Anthropic list; others offer just the default', () => {
    expect(fallbackModels('anthropic', 'claude-opus-5-5').map((m) => m.id)).toEqual([
      'claude-fable-5-2',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]);
    expect(fallbackModels('gemini', 'gemini-4-hydrogen')).toEqual([
      { id: 'gemini-4-hydrogen', label: 'gemini-4-hydrogen', default: true },
    ]);
  });
});

function caps(ok: boolean) {
  const s = { supported: ok };
  return {
    thinking: { supported: ok, types: { adaptive: s, enabled: { supported: !ok } } },
    effort: { supported: ok, low: s, medium: s, high: s, max: s, xhigh: s },
    structured_outputs: s,
  };
}
function model(id: string, display_name: string) {
  return {
    type: 'model',
    id,
    display_name,
    created_at: '2026-01-01T00:00:00Z',
    lifecycle: 'active',
    capabilities: caps(true),
  };
}

describe('verifying keys', () => {
  it('OpenAI and Gemini: one tiny completion on the default model', async () => {
    const ok = fakeFetch(() => json(200, { choices: [{ message: { content: 'OK' } }] }));
    expect(await verifyProviderKey('openai', OPENAI_KEY, 'gpt-d', { fetch: ok.f })).toEqual({
      ok: true,
    });
    expect(ok.seen[0]?.body).toMatchObject({ model: 'gpt-d' });
    const quota = fakeFetch(() =>
      json(429, { error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } }),
    );
    expect(await verifyProviderKey('openai', OPENAI_KEY, 'gpt-d', { fetch: quota.f })).toEqual({
      ok: false,
      problem: 'billing',
    });
    const limited = fakeFetch(() => json(429, { error: { message: 'Rate limit reached' } }));
    expect(await verifyProviderKey('gemini', GEMINI_KEY, 'g', { fetch: limited.f })).toEqual({
      ok: false,
      problem: 'unverifiable',
    });
    expect(limited.seen[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
  });

  it('OpenRouter: the free key endpoint; an exhausted key limit is a spend limit', async () => {
    const ok = fakeFetch(() => json(200, { data: { label: 'x', limit: 10, limit_remaining: 4 } }));
    expect(await verifyProviderKey('openrouter', OPENROUTER_KEY, 'm', { fetch: ok.f })).toEqual({
      ok: true,
    });
    expect(ok.seen[0]?.url).toBe('https://openrouter.ai/api/v1/key');
    const spent = fakeFetch(() => json(200, { data: { limit: 10, limit_remaining: 0 } }));
    expect(await verifyProviderKey('openrouter', OPENROUTER_KEY, 'm', { fetch: spent.f })).toEqual({
      ok: false,
      problem: 'spend_limit',
    });
    const bad = fakeFetch(() => json(401, { error: { code: 401, message: 'No auth' } }));
    expect(await verifyProviderKey('openrouter', OPENROUTER_KEY, 'm', { fetch: bad.f })).toEqual({
      ok: false,
      problem: 'invalid',
    });
  });
});

describe('defaults', () => {
  it('per provider, overridable by env; never a key', () => {
    const c = interviewerConfigFromEnv({
      INTERVIEWER_MODEL: 'claude-x',
      INTERVIEWER_MODEL_OPENAI: 'gpt-y',
      OPENAI_API_KEY: OPENAI_KEY,
      GEMINI_API_KEY: GEMINI_KEY,
    });
    expect(c).toEqual({ model: 'claude-x', models: { openai: 'gpt-y' } });
    expect(JSON.stringify(c)).not.toContain(OPENAI_KEY);
    expect(defaultModelFor(c, 'anthropic')).toBe('claude-x');
    expect(defaultModelFor(c, 'openai')).toBe('gpt-y');
    expect(defaultModelFor(c, 'gemini')).toBe(PROVIDERS.gemini.defaultModel);
  });

  it('base URLs are fixed https endpoints of the provider', () => {
    expect(Object.values(PROVIDERS).map((p) => new URL(p.baseURL).protocol)).toEqual([
      'https:',
      'https:',
      'https:',
      'https:',
    ]);
  });

  it('strict schemas close every object and require every property', () => {
    const s = strictJsonSchema(
      z.object({ a: z.number().int(), b: z.object({ c: z.string() }), d: z.array(z.boolean()) }),
    ) as { required: string[]; properties: { a: object; b: { additionalProperties: boolean } } };
    expect(s.required).toEqual(['a', 'b', 'd']);
    expect(s.properties.b.additionalProperties).toBe(false);
    expect(s.properties.a).not.toHaveProperty('minimum');
    expect(s).not.toHaveProperty('$schema');
  });

  it('chat messages drop non-text content and keep the order', () => {
    expect(
      toChatMessages({
        system: [{ type: 'text', text: 's' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      }),
    ).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'ab' },
    ]);
  });
});

describe('a chosen model the provider refuses', () => {
  /** Model-aware fake: `refuse` names models that answer 404 "model not found". */
  function modelAware(refuse: Set<string>) {
    const calls: { model: string; purpose: string }[] = [];
    const make = (_k: unknown, model: string) => {
      const inner = new FakeModel((req) =>
        req.purpose === 'decision'
          ? speak('Take a look at the edge cases.')
          : `Reply from ${model}.`,
      );
      return {
        model,
        async call(req: Parameters<FakeModel['call']>[0]) {
          calls.push({ model, purpose: req.purpose });
          if (refuse.has(model))
            throw new ModelError(
              'permanent',
              'key refused (permission, 404)',
              404,
              'permission',
              true,
            );
          return inner.call(req);
        },
      };
    };
    return { calls, make };
  }

  it('falls back to the default for the pad, keeps the key, and says so once', async () => {
    const m = modelAware(new Set(['claude-gone']));
    const unavailable: unknown[] = [];
    const h = harness({
      greeted: true,
      settings: { model: { provider: 'anthropic', id: 'claude-gone' } },
      clientFor: m.make,
      modelUnavailable: (padId, model) => unavailable.push({ padId, model }),
    });
    await h.say('Is the input sorted?');
    expect(h.rejected).toEqual([]); // the key is fine
    expect(h.key.ok).toBe(true);
    expect(unavailable).toEqual([
      { padId: h.padId, model: { provider: 'anthropic', id: 'claude-gone' } },
    ]);
    const texts = h.saved.map((s) => s.text);
    expect(texts[0]).toMatch(/claude-gone.*isn't available.*fake-model/s);
    expect(texts[1]).toBe('Reply from fake-model.');
    await h.say('And duplicates?');
    expect(h.saved.filter((s) => /isn't available/.test(s.text))).toHaveLength(1);
    expect(m.calls.map((c) => c.model)).toEqual(['claude-gone', 'fake-model', 'fake-model']);
    expect(h.usage.every((u) => u.model === 'fake-model')).toBe(true);
  });

  it('a chosen model for another provider is ignored: the key provider default is used', async () => {
    const m = modelAware(new Set());
    const h = harness({
      greeted: true,
      settings: { model: { provider: 'openai', id: 'gpt-something' } },
      clientFor: m.make,
    });
    await h.say('hello');
    expect(m.calls.map((c) => c.model)).toEqual(['fake-model']);
  });

  it('a chosen model that works is used for replies, decisions and the assessment', async () => {
    const m = modelAware(new Set());
    const h = harness({
      greeted: true,
      settings: { model: { provider: 'anthropic', id: 'claude-chosen' } },
      clientFor: m.make,
    });
    await h.say('hello');
    expect(h.replies().at(-1)?.text).toBe('Reply from claude-chosen.');
    await h.iv.generateAssessment(h.padId).catch(() => null);
    expect(new Set(m.calls.map((c) => c.model))).toEqual(new Set(['claude-chosen']));
    expect(h.iv.cachedClients()).toBe(1);
  });

  it('the default model refused is still a key problem (the key cannot do anything useful)', async () => {
    const m = modelAware(new Set(['fake-model']));
    const h = harness({ greeted: true, clientFor: m.make });
    await h.say('hello');
    expect(h.rejected).toEqual([{ scope: { padId: h.padId }, keyId: 'k1', problem: 'permission' }]);
  });

  it('grading always uses the provider default', async () => {
    const m = modelAware(new Set());
    const h = harness({
      settings: { model: { provider: 'anthropic', id: 'claude-chosen' } },
      clientFor: m.make,
    });
    await h.iv.gradeShortAnswer(
      'u',
      {
        id: 'q',
        topic: 't',
        subtopic: 's',
        difficulty: 'easy',
        prompt: 'p',
        explanation: '',
        tags: [],
        type: 'short',
        reference: 'r',
        keyPoints: ['a'],
        hints: [],
        followUps: [],
      },
      'a',
    );
    expect(m.calls.map((c) => c.model)).toEqual(['fake-model']);
  });

  it('the notices name the key provider', async () => {
    const h = harness({
      greeted: true,
      key: { ok: true, keyId: 'k1', provider: 'gemini', apiKey: GEMINI_KEY },
      model: new FakeModel(() => ({ error: 'permanent', keyFailure: 'invalid', status: 401 })),
    });
    await h.say('hello');
    expect(h.saved[0]?.text).toMatch(/^Google Gemini rejected the API key/);
  });
});
