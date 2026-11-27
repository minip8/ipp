/**
 * What a model call costs, as an estimate from list prices (ARCHITECTURE §7, "Spend guard"). The
 * provider's bill is the truth; this only lets a user cap their day in dollars.
 *
 * - Anthropic, OpenAI and Gemini have no pricing API: a small static table for the models
 *   providers.ts names, copied from each provider's pricing page (sources and dates below). A
 *   model that is not in it is unpriced. Ids match exactly, or after dropping a dated snapshot
 *   suffix (`-20260101` or `-2026-01-01`), which providers give the same price as the alias.
 * - OpenRouter reports each call's cost in its usage (openai-compat.ts, `reportedCostMicros`),
 *   which wins. Its public catalogue (`GET /api/v1/models`, no key) also lists per-token prices;
 *   they are cached in memory for a few hours and used when a call reports no cost, and to show
 *   a model's price. A lookup never throws and never delays or fails a model call: a miss, a
 *   timeout or an outage only means "unpriced".
 */
import type { AiModelPrice, AiProvider } from '@ipp/contracts';
import type { ModelUsage } from './types';

/** US dollars per million tokens, with the higher prices of a long prompt when it has them. */
export interface ModelPrice extends AiModelPrice {
  /** A request whose prompt (input, cache reads and writes) is over `above` tokens pays these. */
  longContext?: AiModelPrice & { above: number };
}

export type TokenCounts = Pick<
  ModelUsage,
  'inputTokens' | 'outputTokens' | 'cacheReadInputTokens' | 'cacheCreationInputTokens'
>;

/**
 * One call's cost in micro-dollars, rounded to the nearest. Dollars per million tokens times
 * tokens is micro-dollars, so there is no scaling. Cache reads and writes have their own prices.
 */
export function costMicros(price: ModelPrice, u: TokenCounts): number {
  const prompt = u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
  const p = price.longContext && prompt > price.longContext.above ? price.longContext : price;
  const exact =
    p.input * u.inputTokens +
    p.output * u.outputTokens +
    p.cacheRead * u.cacheReadInputTokens +
    p.cacheWrite * u.cacheCreationInputTokens;
  // Products of decimals carry binary noise (0.1 * 3); cut it before rounding.
  return Math.max(0, Math.round(Number(exact.toFixed(6))));
}

// ---------------------------------------------------------------- static table

/**
 * Standard (not batch, not fast mode, global routing) list prices, USD per million tokens.
 *
 * Anthropic: platform.claude.com/docs/en/about-claude/pricing, checked 2026-11-27. Cache writes
 * are the 5-minute rate (the interviewer's `cache_control` is `ephemeral` with the default TTL).
 * Haiku 5.5 charges more for a prompt over 100,000 tokens.
 *
 * OpenAI: developers.openai.com/api/docs/pricing, checked 2026-11-27, Standard tier; long
 * context is a prompt over 272K tokens. Cache writes are the 30-minute rate (the client reports
 * none: OpenAI's caching is automatic and only cached reads come back).
 *
 * Gemini: aistudio.google.com/docs/pricing, checked 2026-11-27, paid tier; one price at any
 * prompt length, output including thinking tokens. Caching is implicit only (no write charge),
 * so a write is priced as input.
 */
export const STATIC_PRICES: Record<
  Exclude<AiProvider, 'openrouter'>,
  Record<string, ModelPrice>
> = {
  anthropic: {
    'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    'claude-haiku-5-5': {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      longContext: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
    },
  },
  openai: {
    'gpt-6.2-astra': {
      input: 8,
      output: 40,
      cacheRead: 0.4,
      cacheWrite: 10,
      longContext: { above: 272_000, input: 16, output: 60, cacheRead: 0.8, cacheWrite: 20 },
    },
  },
  gemini: {
    'gemini-4-hydrogen': { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 1.5 },
  },
};

const DATED = /-(\d{8}|\d{4}-\d{2}-\d{2})$/;

/** A static table's price for `model`: exact id, or the id without a dated snapshot suffix. */
export function staticPrice(provider: AiProvider, model: string): ModelPrice | null {
  if (provider === 'openrouter') return null;
  const table = STATIC_PRICES[provider];
  if (Object.hasOwn(table, model)) return table[model] ?? null;
  const alias = model.replace(DATED, '');
  return alias !== model && Object.hasOwn(table, alias) ? (table[alias] ?? null) : null;
}

// ---------------------------------------------------------------- OpenRouter catalogue

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** A per-token price string as dollars per million tokens; null when absent or not a price. */
function perMillion(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  // OpenRouter lists "-1" for a router whose price depends on the model it picks.
  if (!Number.isFinite(n) || n < 0) return null;
  return Number((n * 1_000_000).toFixed(6));
}

/**
 * Prices from OpenRouter's `GET /api/v1/models` (openrouter.ai/docs/api/api-reference/models/
 * get-models, checked 2026-11-27): `pricing.prompt` and `.completion` are required decimal
 * strings in US dollars per token; `input_cache_read` and `input_cache_write` are optional
 * (absent: priced as input); `discount` (0..1) scales them all. Of the conditional `overrides`,
 * the one that depends only on prompt length (`min_prompt_tokens`, keys it leaves out keeping
 * the base price) becomes the long-context price; time-of-day ones are not applied: this is an
 * estimate. Each model is filed under its `id`, and a plain id (no `:variant`) also under its
 * `canonical_slug` (the dated name a response may carry).
 */
export function parseOpenRouterPrices(body: unknown): Map<string, ModelPrice> {
  const out = new Map<string, ModelPrice>();
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data.slice(0, 5000)) {
    const e = m as { id?: unknown; canonical_slug?: unknown; pricing?: Record<string, unknown> };
    if (typeof e?.id !== 'string' || !e.pricing || typeof e.pricing !== 'object') continue;
    const base = tierOf(e.pricing, null);
    if (!base) continue;
    const d = Number(e.pricing.discount ?? 0);
    const scale = Number.isFinite(d) && d > 0 && d < 1 ? 1 - d : 1;
    const s = (p: AiModelPrice): AiModelPrice => ({
      input: Number((p.input * scale).toFixed(6)),
      output: Number((p.output * scale).toFixed(6)),
      cacheRead: Number((p.cacheRead * scale).toFixed(6)),
      cacheWrite: Number((p.cacheWrite * scale).toFixed(6)),
    });
    const price: ModelPrice = s(base);
    const overrides = Array.isArray(e.pricing.overrides) ? e.pricing.overrides : [];
    for (const o of overrides as Record<string, unknown>[]) {
      const min = Number(o?.min_prompt_tokens);
      const timed = Object.keys(o ?? {}).some((k) => k.startsWith('utc_'));
      if (!Number.isInteger(min) || min <= 0 || timed) continue;
      const tier = tierOf(o, base);
      if (tier) price.longContext = { above: min - 1, ...s(tier) };
      break;
    }
    out.set(e.id, price);
    if (typeof e.canonical_slug === 'string' && !e.id.includes(':') && !out.has(e.canonical_slug))
      out.set(e.canonical_slug, price);
  }
  return out;
}

/** One price tier of a catalogue entry; keys it lacks come from `base` (or input, for caches). */
function tierOf(p: Record<string, unknown>, base: AiModelPrice | null): AiModelPrice | null {
  const input = perMillion(p.prompt) ?? base?.input ?? null;
  const output = perMillion(p.completion) ?? base?.output ?? null;
  if (input === null || output === null) return null;
  return {
    input,
    output,
    cacheRead: perMillion(p.input_cache_read) ?? base?.cacheRead ?? input,
    cacheWrite: perMillion(p.input_cache_write) ?? base?.cacheWrite ?? input,
  };
}

export interface PriceBookOptions {
  /** OpenRouter's catalogue is fetched with this (tests inject one). */
  fetch?: typeof fetch;
  /** How long a fetched catalogue is used. */
  ttlMs?: number;
  /** How long a failed fetch is remembered before trying again. */
  failedTtlMs?: number;
  /** Deadline of one catalogue fetch. */
  timeoutMs?: number;
  now?: () => number;
}

export interface PriceLookup {
  price: ModelPrice;
  /** `list`: a price table; the static one or OpenRouter's catalogue. */
  source: 'list';
}

export interface PriceBook {
  /** The list price of `model` on `provider`; null when unknown. Never throws. */
  price(provider: AiProvider, model: string): Promise<PriceLookup | null>;
  /**
   * One call's cost in micro-dollars: the provider's reported cost, else list price times
   * tokens; null when neither is known (the call's tokens are unpriced). Never throws.
   */
  costOf(usage: ModelUsage): Promise<number | null>;
}

/** Prices for the spend guard. One per process (the OpenRouter catalogue is cached in it). */
export function createPriceBook(opts: PriceBookOptions = {}): PriceBook {
  const ttlMs = opts.ttlMs ?? 6 * 60 * 60_000;
  const failedTtlMs = opts.failedTtlMs ?? 5 * 60_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const now = opts.now ?? Date.now;
  let catalogue: { at: number; ttl: number; prices: Map<string, ModelPrice> } | null = null;
  let inflight: Promise<Map<string, ModelPrice>> | null = null;

  async function fetchCatalogue(): Promise<Map<string, ModelPrice>> {
    try {
      // Public: no key is sent anywhere for this.
      const res = await (opts.fetch ?? globalThis.fetch)(OPENROUTER_MODELS_URL, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const prices = parseOpenRouterPrices(await res.json());
      if (prices.size === 0) throw new Error('empty catalogue');
      catalogue = { at: now(), ttl: ttlMs, prices };
      return prices;
    } catch {
      // Keep a stale catalogue over none; try again after a short while either way.
      const prices = catalogue?.prices ?? new Map<string, ModelPrice>();
      catalogue = { at: now(), ttl: failedTtlMs, prices };
      return prices;
    }
  }

  async function openRouterPrices(): Promise<Map<string, ModelPrice>> {
    if (catalogue && now() - catalogue.at < catalogue.ttl) return catalogue.prices;
    inflight ??= fetchCatalogue().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  const book: PriceBook = {
    async price(provider, model) {
      try {
        if (provider !== 'openrouter') {
          const p = staticPrice(provider, model);
          return p ? { price: p, source: 'list' } : null;
        }
        const prices = await openRouterPrices();
        const p = prices.get(model) ?? prices.get(model.replace(DATED, ''));
        return p ? { price: p, source: 'list' } : null;
      } catch {
        return null;
      }
    },
    async costOf(usage) {
      const reported = usage.reportedCostMicros;
      if (typeof reported === 'number' && Number.isFinite(reported) && reported >= 0)
        return Math.round(reported);
      if (!usage.provider) return null;
      const found = await book.price(usage.provider, usage.model);
      return found ? costMicros(found.price, usage) : null;
    },
  };
  return book;
}
