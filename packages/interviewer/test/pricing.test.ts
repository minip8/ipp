/**
 * Cost estimates for the spend guard: the arithmetic, the static table, OpenRouter's catalogue
 * (parsed from a trimmed copy of its real `GET /api/v1/models` response, fetched 2026-11-27) and
 * its cache, and OpenRouter's reported cost in a streamed response.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OpenAICompatModelClient, reportedCostMicros } from '../src/openai-compat';
import {
  costMicros,
  createPriceBook,
  OPENROUTER_MODELS_URL,
  parseOpenRouterPrices,
  STATIC_PRICES,
  staticPrice,
} from '../src/pricing';
import { createModelClient, PROVIDERS } from '../src/providers';
import type { ModelUsage } from '../src/types';

const catalogue = JSON.parse(
  readFileSync(new URL('./fixtures/openrouter-models.json', import.meta.url), 'utf8'),
);

const tokens = (o: Partial<ModelUsage> = {}) => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  ...o,
});

const usage = (o: Partial<ModelUsage> = {}): ModelUsage => ({
  purpose: 'reply',
  model: 'claude-opus-5-5',
  provider: 'anthropic',
  ...tokens(o),
  ...o,
});

describe('costMicros', () => {
  const price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

  it('is dollars per million tokens times tokens, in micro-dollars', () => {
    expect(costMicros(price, tokens({ inputTokens: 1_000_000 }))).toBe(4_000_000);
    expect(costMicros(price, tokens({ outputTokens: 1_000 }))).toBe(20_000);
    expect(costMicros(price, tokens())).toBe(0);
  });

  it('prices cache reads and writes separately', () => {
    expect(costMicros(price, tokens({ cacheReadInputTokens: 10_000 }))).toBe(2_000);
    expect(costMicros(price, tokens({ cacheCreationInputTokens: 10_000 }))).toBe(50_000);
    expect(
      costMicros(
        price,
        tokens({
          inputTokens: 1_000,
          outputTokens: 500,
          cacheReadInputTokens: 20_000,
          cacheCreationInputTokens: 3_000,
        }),
      ),
    ).toBe(4_000 + 10_000 + 4_000 + 15_000);
  });

  it('rounds to the nearest micro-dollar, without binary noise', () => {
    // 3 × 0.1 is 0.30000000000000004 in floating point.
    expect(costMicros({ ...price, cacheRead: 0.1 }, tokens({ cacheReadInputTokens: 3 }))).toBe(0);
    expect(costMicros({ ...price, cacheRead: 0.1 }, tokens({ cacheReadInputTokens: 5 }))).toBe(1);
    expect(costMicros({ ...price, cacheRead: 0.1 }, tokens({ cacheReadInputTokens: 4 }))).toBe(0);
    expect(costMicros({ ...price, input: 0.125 }, tokens({ inputTokens: 12 }))).toBe(2);
  });

  it('charges a long prompt the long-context prices, cache reads counted in its length', () => {
    const haiku = STATIC_PRICES.anthropic['claude-haiku-5-5'];
    if (!haiku) throw new Error('no Haiku price');
    expect(costMicros(haiku, tokens({ inputTokens: 100_000, outputTokens: 1_000 }))).toBe(
      10_000 + 500,
    );
    // 100,001 prompt tokens, most of them cache reads: the whole request pays the higher rate.
    expect(
      costMicros(
        haiku,
        tokens({ inputTokens: 1, cacheReadInputTokens: 100_000, outputTokens: 1_000 }),
      ),
    ).toBe(Math.round(0.5 + 5_000 + 2_500));
  });
});

describe('the static table', () => {
  it('prices every curated Anthropic model and each provider default', () => {
    for (const m of PROVIDERS.anthropic.curated)
      expect(staticPrice('anthropic', m.id), m.id).not.toBeNull();
    for (const provider of ['anthropic', 'openai', 'gemini'] as const)
      expect(staticPrice(provider, PROVIDERS[provider].defaultModel), provider).not.toBeNull();
  });

  it('matches ids exactly or without a dated snapshot suffix', () => {
    const opus = staticPrice('anthropic', 'claude-opus-5-5');
    expect(opus).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
    expect(staticPrice('anthropic', 'claude-opus-5-5-20260921')).toEqual(opus);
    expect(staticPrice('openai', 'gpt-6.2-astra-2026-11-01')).toEqual(
      staticPrice('openai', 'gpt-6.2-astra'),
    );
    expect(staticPrice('gemini', 'gemini-4-hydrogen')?.input).toBe(1.5);
  });

  it('leaves anything else unpriced', () => {
    expect(staticPrice('anthropic', 'claude-opus-5')).toBeNull();
    expect(staticPrice('anthropic', 'claude-opus-5-5-preview')).toBeNull();
    expect(staticPrice('anthropic', 'claude-opus-5-5-2026')).toBeNull();
    expect(staticPrice('openai', 'claude-opus-5-5')).toBeNull();
    expect(staticPrice('openai', 'toString')).toBeNull();
    expect(staticPrice('openai', '__proto__')).toBeNull();
    expect(staticPrice('openrouter', 'openai/gpt-6.2-sol')).toBeNull();
  });
});

describe('OpenRouter catalogue prices', () => {
  it('parses per-token strings into dollars per million tokens', () => {
    const prices = parseOpenRouterPrices(catalogue);
    expect(prices.get('anthropic/claude-opus-5.5')).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
    });
    expect(prices.get('anthropic/claude-opus-5.5:batch')?.input).toBe(2);
  });

  it('files a plain id under its canonical slug too (not a :variant)', () => {
    const prices = parseOpenRouterPrices(catalogue);
    expect(prices.get('anthropic/claude-opus-5.5-20260921')).toEqual(
      prices.get('anthropic/claude-opus-5.5'),
    );
  });

  it('takes the prompt-length override as the long-context price', () => {
    const sol = parseOpenRouterPrices(catalogue).get('openai/gpt-6.2-sol');
    expect(sol).toEqual({
      input: 2,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2.5,
      longContext: { above: 271_999, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 },
    });
  });

  it('prices missing cache rates as input and skips variable-price routers', () => {
    const prices = parseOpenRouterPrices(catalogue);
    const ling = prices.get('inclusionai/lingsante-3.1-air-vl');
    expect(ling).toEqual({ input: 0.06, output: 0.18, cacheRead: 0.012, cacheWrite: 0.06 });
    expect(prices.has('openrouter/auto')).toBe(false);
  });

  it('applies a discount and survives junk', () => {
    const prices = parseOpenRouterPrices({
      data: [
        { id: 'a/b', pricing: { prompt: '0.000002', completion: '0.00001', discount: 0.5 } },
        { id: 'a/c', pricing: { prompt: 'x', completion: '0.00001' } },
        { id: 7, pricing: { prompt: '0.1', completion: '0.1' } },
        null,
      ],
    });
    expect(prices.get('a/b')).toEqual({ input: 1, output: 5, cacheRead: 1, cacheWrite: 1 });
    expect(prices.size).toBe(1);
    expect(parseOpenRouterPrices(null).size).toBe(0);
    expect(parseOpenRouterPrices({ data: 'nope' }).size).toBe(0);
  });
});

/** A fetch that serves the catalogue (or fails), counting calls and the headers sent. */
function catalogueFetch(
  answer: () => Response | Promise<Response> = () => Response.json(catalogue),
) {
  const seen: { url: string; headers: Headers }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers) });
    return answer();
  }) as typeof fetch;
  return { f, seen };
}

describe('the price book', () => {
  it('reads static prices without fetching anything', async () => {
    const { f, seen } = catalogueFetch();
    const book = createPriceBook({ fetch: f });
    expect(await book.price('anthropic', 'claude-sonnet-5-5')).toEqual({
      price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      source: 'list',
    });
    expect(await book.price('gemini', 'gemini-unknown')).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('fetches the public catalogue once per TTL, with no key', async () => {
    let t = 0;
    const { f, seen } = catalogueFetch();
    const book = createPriceBook({ fetch: f, ttlMs: 1_000, now: () => t });
    const [a, b] = await Promise.all([
      book.price('openrouter', 'anthropic/claude-opus-5.5'),
      book.price('openrouter', 'openai/gpt-6.2-sol'),
    ]);
    expect(a?.price.input).toBe(4);
    expect(b?.price.output).toBe(10);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(OPENROUTER_MODELS_URL);
    expect(seen[0]?.headers.get('authorization')).toBeNull();
    t = 999;
    await book.price('openrouter', 'anthropic/claude-opus-5.5');
    expect(seen).toHaveLength(1);
    t = 1_000;
    await book.price('openrouter', 'anthropic/claude-opus-5.5');
    expect(seen).toHaveLength(2);
  });

  it('treats a model the catalogue lacks as unpriced', async () => {
    const book = createPriceBook({ fetch: catalogueFetch().f });
    expect(await book.price('openrouter', 'vendor/not-listed')).toBeNull();
    expect(await book.price('openrouter', 'openrouter/auto')).toBeNull();
  });

  it('never throws: an outage is unpriced, retried after the short TTL, a stale list kept', async () => {
    let t = 0;
    let mode: 'down' | 'up' | 'throw' = 'down';
    const { f, seen } = catalogueFetch(() => {
      if (mode === 'throw') throw new Error('network down');
      return mode === 'down' ? new Response('nope', { status: 503 }) : Response.json(catalogue);
    });
    const book = createPriceBook({ fetch: f, ttlMs: 10_000, failedTtlMs: 100, now: () => t });
    expect(await book.price('openrouter', 'anthropic/claude-opus-5.5')).toBeNull();
    expect(await book.price('openrouter', 'anthropic/claude-opus-5.5')).toBeNull();
    expect(seen).toHaveLength(1);
    t = 100;
    mode = 'up';
    expect((await book.price('openrouter', 'anthropic/claude-opus-5.5'))?.price.input).toBe(4);
    t = 20_000;
    mode = 'throw';
    // Expired, and the refresh fails: the stale prices still answer.
    expect((await book.price('openrouter', 'anthropic/claude-opus-5.5'))?.price.input).toBe(4);
    const broken = createPriceBook({
      fetch: (() => Promise.resolve(new Response('{not json'))) as unknown as typeof fetch,
    });
    expect(await broken.price('openrouter', 'anthropic/claude-opus-5.5')).toBeNull();
  });

  it('costs a call: reported cost first, else list price, else unpriced', async () => {
    const book = createPriceBook({ fetch: catalogueFetch().f });
    expect(await book.costOf(usage({ inputTokens: 1_000, outputTokens: 100 }))).toBe(6_000);
    expect(
      await book.costOf(
        usage({ provider: 'openrouter', model: 'x/unknown', reportedCostMicros: 1234 }),
      ),
    ).toBe(1234);
    expect(
      await book.costOf(
        usage({ provider: 'openrouter', model: 'anthropic/claude-opus-5.5', outputTokens: 1_000 }),
      ),
    ).toBe(20_000);
    expect(await book.costOf(usage({ model: 'claude-unknown', inputTokens: 5 }))).toBeNull();
    expect(await book.costOf(usage({ provider: undefined, inputTokens: 5 }))).toBeNull();
  });
});

describe('OpenRouter reported cost', () => {
  it('reads usage.cost in dollars, adding the upstream cost of a BYOK call', () => {
    expect(reportedCostMicros({ cost: 0.0123 })).toBe(12_300);
    expect(reportedCostMicros({ cost: 0 })).toBe(0);
    expect(
      reportedCostMicros({
        cost: 0.001,
        is_byok: true,
        cost_details: { upstream_inference_cost: 0.02 },
      }),
    ).toBe(21_000);
    // Not BYOK: upstream is already in the cost.
    expect(
      reportedCostMicros({
        cost: 0.02,
        is_byok: false,
        cost_details: { upstream_inference_cost: 0.02 },
      }),
    ).toBe(20_000);
    expect(reportedCostMicros({})).toBeNull();
    expect(reportedCostMicros(null)).toBeNull();
    expect(reportedCostMicros({ cost: -1 })).toBeNull();
  });

  const stream = (usageChunk: object) => {
    const lines = [
      { model: 'openai/gpt-6.2-sol', choices: [{ index: 0, delta: { content: 'ok' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: usageChunk },
    ].map((c) => `data: ${JSON.stringify(c)}\n\n`);
    lines.push('data: [DONE]\n\n');
    return new Response(lines.join(''), { headers: { 'content-type': 'text/event-stream' } });
  };
  const req = {
    purpose: 'reply' as const,
    system: [{ type: 'text' as const, text: 'core' }],
    messages: [{ role: 'user' as const, content: 'hi' }],
    effort: 'low' as const,
    maxTokens: 100,
    timeoutMs: 5000,
  };
  const OR_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab';

  it('comes back with an OpenRouter response, cache writes split out of the prompt', async () => {
    const f = (async () =>
      stream({
        prompt_tokens: 1_000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 },
        cost: 0.00042,
        is_byok: false,
      })) as unknown as typeof fetch;
    const res = await createModelClient('openrouter', OR_KEY, 'openai/gpt-6.2-sol', {
      fetch: f,
    }).call(req);
    expect(res.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 600,
      cacheCreationInputTokens: 300,
      reportedCostMicros: 420,
    });
  });

  it('is ignored for a provider that does not report cost', async () => {
    const f = (async () =>
      stream({ prompt_tokens: 10, completion_tokens: 5, cost: 1 })) as unknown as typeof fetch;
    const client = new OpenAICompatModelClient('sk-test-key', 'm', {
      baseURL: 'https://example.invalid/v1',
      classify: () => ({ kind: 'permanent', message: 'x' }),
      effortParam: 'none',
      fetch: f,
    });
    const res = await client.call(req);
    expect(res.usage.reportedCostMicros).toBeUndefined();
    expect(res.usage.inputTokens).toBe(10);
  });
});
