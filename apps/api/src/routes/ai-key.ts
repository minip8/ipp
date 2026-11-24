/**
 * The signed-in user's own AI provider API key. No endpoint ever returns the key; status shows at
 * most its last four characters. Saving checks the key with one real call to its provider first.
 * Listing models uses the key against the provider's fixed endpoint and returns only model ids.
 */
import {
  AI_KEY_ERROR_CODES,
  AI_PROVIDERS,
  type AiKeyProblem,
  type AiKeyStatus,
  type AiModelList,
  type AiModelOption,
  type AiProvider,
  SaveAiKeyRequest,
} from '@ipp/contracts';
import { fallbackModels } from '@ipp/interviewer';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireAccount } from '../http/app';
import { conflict, HttpError, rateLimited, unavailable } from '../http/errors';
import { defaultModel } from '../interviewer/wiring';

/** What to tell the user when `provider` refuses a key (on save). */
export function rejectedMessage(
  provider: AiProvider,
  problem: AiKeyProblem,
  model: string,
): string {
  const { label, consoleName } = AI_PROVIDERS[provider];
  switch (problem) {
    case 'invalid':
      return `${label} did not accept this key. Check that you copied all of it and that it has not been revoked.`;
    case 'permission':
      return `This key cannot use ${model}, the model the interviewer runs on by default. Check the key’s project or workspace and its model access in the ${consoleName}.`;
    case 'billing':
      return `${label} accepted the key but its account has no credit. Add credit or billing in the ${consoleName}, then save the key again.`;
    case 'spend_limit':
      return `This key’s account has reached its spend limit. Raise the limit in the ${consoleName}, then save the key again.`;
  }
}

/** Kept for callers that only know Anthropic. */
export const REJECTED_MESSAGES: Record<AiKeyProblem, string> = {
  invalid: rejectedMessage('anthropic', 'invalid', 'claude-opus-5-5'),
  permission: rejectedMessage('anthropic', 'permission', 'claude-opus-5-5'),
  billing: rejectedMessage('anthropic', 'billing', 'claude-opus-5-5'),
  spend_limit: rejectedMessage('anthropic', 'spend_limit', 'claude-opus-5-5'),
};

const MODELS_TTL_MS = 10 * 60_000;
const MODELS_FAILED_TTL_MS = 30_000;
const MODELS_CACHE_MAX = 500;

export function aiKeyRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  /** Model lists per stored key id (a new or replaced key has a new id). Never holds the key. */
  const modelCache = new Map<string, { at: number; ttl: number; list: AiModelList }>();

  const status = async (userId: string): Promise<AiKeyStatus> => {
    const s = await ctx.aiKeys.status(userId);
    return {
      ...s,
      model: defaultModel(ctx.config, s.provider ?? 'anthropic'),
      ttlHours: ctx.config.aiKeyTtlHours,
    };
  };

  r.get('/ai-key', async (c) => {
    const user = requireAccount(c);
    return c.json(await status(user.id));
  });

  r.put('/ai-key', async (c) => {
    const user = requireAccount(c);
    // Malformed input, or a key that does not fit the chosen provider, is refused without
    // calling anyone, so it does not use up an attempt.
    const { provider, apiKey } = await parseBody(c, SaveAiKeyRequest);
    const l = ctx.config.limits.aiKeySave;
    const ip = c.get('ip');
    const wait = await ctx.limiter.hit([
      { key: `aikey:u:${user.id}:burst`, ...l.userBurst },
      { key: `aikey:u:${user.id}:day`, ...l.userDaily },
      { key: `aikey:ip:${ip}:burst`, ...l.ipBurst },
      { key: `aikey:ip:${ip}:day`, ...l.ipDaily },
    ]);
    if (wait > 0)
      throw rateLimited(wait, 'rate_limited', 'Too many attempts to save a key. Try again later.');

    let verdict: Awaited<ReturnType<Ctx['verifyAiKey']>>;
    try {
      verdict = await ctx.verifyAiKey(apiKey, provider);
    } catch {
      verdict = { ok: false, problem: 'unverifiable' };
    }
    if (!verdict.ok) {
      ctx.log.info({ userId: user.id, provider, problem: verdict.problem }, 'AI key not saved');
      if (verdict.problem === 'unverifiable')
        throw unavailable(
          AI_KEY_ERROR_CODES.unverifiable,
          `${AI_PROVIDERS[provider].label} could not be reached to check the key, so nothing was saved. Try again in a minute.`,
        );
      throw new HttpError(
        422,
        AI_KEY_ERROR_CODES.rejected,
        rejectedMessage(provider, verdict.problem, defaultModel(ctx.config, provider)),
      );
    }
    await ctx.aiKeys.save(user.id, provider, apiKey);
    ctx.log.info({ userId: user.id, provider }, 'AI key saved');
    await ctx.ai
      .keyChanged(user.id)
      .catch((err) => ctx.log.warn({ err: String(err) }, 'key change broadcast failed'));
    return c.json(await status(user.id));
  });

  r.delete('/ai-key', async (c) => {
    const user = requireAccount(c);
    if (await ctx.aiKeys.delete(user.id)) {
      ctx.log.info({ userId: user.id }, 'AI key deleted');
      await ctx.ai
        .keyChanged(user.id)
        .catch((err) => ctx.log.warn({ err: String(err) }, 'key change broadcast failed'));
    }
    return c.json(await status(user.id));
  });

  /**
   * The models the user's key can choose from, live from the provider (cached per key for a few
   * minutes). When the provider cannot list them, a built-in list (Anthropic) or just the
   * default comes back with `source: "fallback"`: choosing a model is optional, so this never
   * blocks anything. Listing is not "use" of the key (its expiry is not refreshed).
   */
  r.get('/ai-key/models', async (c) => {
    const user = requireAccount(c);
    const key = await ctx.aiKeys.resolve(user.id, { touch: false });
    if (!key.ok)
      throw conflict(
        AI_KEY_ERROR_CODES.missing,
        key.state === 'rejected'
          ? 'Your API key was rejected. Save a working key to choose a model.'
          : 'Add an API key to choose a model.',
      );
    const now = Date.now();
    const hit = modelCache.get(key.keyId);
    if (hit && now - hit.at < hit.ttl) return c.json(hit.list);

    const wait = await ctx.limiter.hit([
      { key: `aimodels:u:${user.id}`, ...ctx.config.limits.aiModels.userBurst },
    ]);
    if (wait > 0) throw rateLimited(wait);

    const provider = key.provider;
    const fallback = defaultModel(ctx.config, provider);
    let list: AiModelList;
    let ttl = MODELS_TTL_MS;
    try {
      const models: AiModelOption[] = await ctx.listAiModels(key.apiKey, provider);
      list = { provider, defaultModel: fallback, models, source: 'live' };
    } catch (err) {
      const e = err as { status?: number; kind?: string };
      ctx.log.warn(
        { userId: user.id, provider, status: e?.status, kind: e?.kind },
        'listing models failed; offering the built-in list',
      );
      list = {
        provider,
        defaultModel: fallback,
        models: fallbackModels(provider, fallback),
        source: 'fallback',
      };
      ttl = MODELS_FAILED_TTL_MS;
    }
    if (modelCache.size >= MODELS_CACHE_MAX) modelCache.clear();
    modelCache.set(key.keyId, { at: now, ttl, list });
    return c.json(list);
  });

  return r;
}
