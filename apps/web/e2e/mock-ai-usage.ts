/**
 * Mock of the daily AI usage and limit endpoints, kept apart from mock-api.ts (which delegates
 * here):
 *   GET    /api/ai-usage    AiUsageStatus
 *   PUT    /api/ai-limits   SetAiLimitsRequest -> AiUsageStatus
 *   DELETE /api/ai-limits   AiUsageStatus (back to the defaults)
 */
import {
  type AiCostTracking,
  type AiDailyLimits,
  type AiKeyStatus,
  AiUsageStatus,
  type AiUsageToday,
  SetAiLimitsRequest,
} from '@ipp/contracts';
import { DEFAULT_MODELS } from './fixtures';

/** List prices the API would report for each provider's default model (fixtures only). */
const PRICES: Partial<Record<string, AiCostTracking['price']>> = {
  anthropic: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  openai: { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10 },
  gemini: { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 1.5 },
  openrouter: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

export class MockAiUsage {
  usage: AiUsageToday = {
    day: new Date().toISOString().slice(0, 10),
    messages: 42,
    inputTokens: 1_250_000,
    outputTokens: 38_000,
    totalTokens: 1_288_000,
    costMicros: 1_870_000,
    unpricedTokens: 0,
  };
  /** The user's own caps (null: the defaults apply). */
  limits: AiDailyLimits | null = null;
  defaults = { messages: 1500, inputTokens: 5_000_000, outputTokens: 500_000 };
  /** false: the key's default model has no known price (the "untracked" wording). */
  priced = true;
  /** Bodies of PUT /api/ai-limits, in order; `null` for each DELETE. */
  saves: (AiDailyLimits | null)[] = [];

  private status(key: AiKeyStatus): AiUsageStatus {
    const provider = key.state === 'active' ? key.provider : null;
    const costTracking: AiCostTracking | null = provider
      ? {
          provider,
          model: DEFAULT_MODELS[provider],
          tracked: provider === 'openrouter' || this.priced,
          source: provider === 'openrouter' ? 'reported' : this.priced ? 'list' : null,
          price: this.priced ? (PRICES[provider] ?? null) : null,
        }
      : null;
    const next = new Date();
    next.setUTCHours(24, 0, 0, 0);
    return AiUsageStatus.parse({
      usage: this.usage,
      limits: this.limits,
      defaults: this.defaults,
      costTracking,
      resetsAt: next.toISOString(),
    });
  }

  /** The response for these routes, or undefined when the path is not one of them. */
  handle(
    method: string,
    path: string,
    body: unknown,
    key: AiKeyStatus,
    guest: boolean,
  ): unknown | undefined {
    if (path !== '/api/ai-usage' && path !== '/api/ai-limits') return undefined;
    if (guest)
      return json(403, {
        error: { code: 'account_required', message: 'Sign in with an account to do this' },
      });
    if (path === '/api/ai-usage' && method === 'GET') return this.status(key);
    if (path === '/api/ai-limits' && method === 'PUT') {
      const parsed = SetAiLimitsRequest.safeParse(body);
      if (!parsed.success)
        return json(400, {
          error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Invalid' },
        });
      this.limits = parsed.data;
      this.saves.push(parsed.data);
      return this.status(key);
    }
    if (path === '/api/ai-limits' && method === 'DELETE') {
      this.limits = null;
      this.saves.push(null);
      return this.status(key);
    }
    return json(405, { error: { code: 'method_not_allowed', message: 'Method not allowed' } });
  }
}
