/**
 * Everything provider-specific on the server, one table entry per provider: the fixed base URL
 * (never user-supplied), the default interviewer model, how to build a client, how to list
 * selectable models, how to verify a key, and what an HTTP error means for the key.
 *
 * Anthropic uses the native SDK client (model.ts). OpenAI, Google Gemini (through its
 * OpenAI-compatible endpoint) and OpenRouter share one fetch-based client (openai-compat.ts).
 *
 * Defaults (checked against each provider's docs on 2026-11-24, overridable by env):
 * - Anthropic `claude-opus-5-5`
 * - OpenAI `gpt-6.2-astra` ("If you're not sure where to start, use GPT-6.2 Astra",
 *   developers.openai.com/api/docs/models)
 * - Gemini `gemini-4-hydrogen` (recommended for new projects, aistudio.google.com/docs/models)
 * - OpenRouter `openai/gpt-6.2-sol` (the model the OpenRouter quickstart resolves to)
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  AI_PROVIDERS,
  type AiKeyProblem,
  AiModelId,
  type AiModelOption,
  type AiProvider,
} from '@ipp/contracts';
import {
  AnthropicModelClient,
  anthropicClient,
  type KeyFailure,
  type ModelClient,
  ModelError,
  type VerifyResult,
  verifyApiKey as verifyAnthropicKey,
} from './model';
import {
  genericHttpFailure,
  type HttpClassifier,
  type HttpFailure,
  OpenAICompatModelClient,
  type OpenAICompatOptions,
  type ProviderError,
  providerError,
} from './openai-compat';
import type { InterviewerConfig } from './types';

export interface ListOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface ProviderSpec {
  id: AiProvider;
  /** Fixed. Nothing a user sends can change where their key is sent. */
  baseURL: string;
  defaultModel: string;
  /** Env variable overriding `defaultModel`. */
  modelEnv: string;
  /** Curated ordering (most capable first) and the list shown when live listing fails. */
  curated: { id: string; label: string }[];
  createClient(apiKey: string, model: string, opts?: { fetch?: typeof fetch }): ModelClient;
  /** Chat-capable models the key can use, as the provider lists them. */
  listModels(apiKey: string, opts?: ListOptions): Promise<{ id: string; label: string }[]>;
  /** One cheap check that the key works (and, where the API allows, can pay for the model). */
  verify(apiKey: string, model: string, opts?: ListOptions): Promise<VerifyResult>;
}

// ---------------------------------------------------------------- error classification

const msg = (e: ProviderError) => `${e.message}`.slice(0, 300);

/** OpenAI: developers.openai.com/api/docs/guides/error-codes. */
export const classifyOpenAI: HttpClassifier = (status, e) => {
  const codes = `${e.code ?? ''} ${e.type ?? ''}`;
  switch (status) {
    case 401:
      return { kind: 'permanent', keyFailure: 'invalid', message: 'invalid key' };
    case 403:
      return { kind: 'permanent', keyFailure: 'permission', message: `forbidden: ${msg(e)}` };
    case 404:
      return {
        kind: 'permanent',
        keyFailure: 'permission',
        modelUnavailable: true,
        message: `model not found: ${msg(e)}`,
      };
    case 402:
      return { kind: 'permanent', keyFailure: 'billing', message: 'payment required' };
    case 429:
      if (/spend_limit|usage_limit/.test(codes))
        return { kind: 'permanent', keyFailure: 'spend_limit', message: 'spend limit' };
      if (/insufficient_quota|credit_balance|billing/.test(codes))
        return { kind: 'permanent', keyFailure: 'billing', message: 'no credit' };
      return { kind: 'transient', keyFailure: 'rate_limited', message: 'rate limited' };
    default:
      if (status === 400 && e.code === 'model_not_found')
        return {
          kind: 'permanent',
          keyFailure: 'permission',
          modelUnavailable: true,
          message: 'model not found',
        };
      return genericHttpFailure(status, e);
  }
};

/** Google Gemini: aistudio.google.com/docs/api-errors (array or object bodies). */
export const classifyGemini: HttpClassifier = (status, e) => {
  const tags = `${e.status ?? ''} ${e.reasons.join(' ')} ${e.message}`;
  if (
    status === 401 ||
    /API_KEY_INVALID|API key not valid|ACCESS_TOKEN_TYPE_UNSUPPORTED|API_KEY_EXPIRED/i.test(tags)
  )
    return { kind: 'permanent', keyFailure: 'invalid', message: 'invalid key' };
  switch (status) {
    case 402:
      return { kind: 'permanent', keyFailure: 'billing', message: 'prepaid credit used up' };
    case 403:
      return { kind: 'permanent', keyFailure: 'permission', message: `forbidden: ${msg(e)}` };
    case 404:
      return {
        kind: 'permanent',
        keyFailure: 'permission',
        modelUnavailable: true,
        message: `model not found: ${msg(e)}`,
      };
    case 429:
      // Per-minute and per-day quotas both reset: transient for the key, never a rejection.
      return { kind: 'transient', keyFailure: 'rate_limited', message: 'rate limited' };
    default:
      if (status === 400 && /FAILED_PRECONDITION/.test(tags))
        return { kind: 'permanent', keyFailure: 'permission', message: `precondition: ${msg(e)}` };
      return genericHttpFailure(status, e);
  }
};

/** OpenRouter: openrouter.ai/docs/api-reference/errors. */
export const classifyOpenRouter: HttpClassifier = (status, e) => {
  switch (status) {
    case 401:
      return { kind: 'permanent', keyFailure: 'invalid', message: 'invalid key' };
    case 402:
      return /limit/i.test(e.message)
        ? { kind: 'permanent', keyFailure: 'spend_limit', message: 'key limit reached' }
        : { kind: 'permanent', keyFailure: 'billing', message: 'insufficient credits' };
    case 403:
      // A moderation / guardrail block of this request, not a problem with the key.
      return { kind: 'permanent', message: `blocked by moderation: ${msg(e)}` };
    case 404:
      // No endpoint serves this model (with these parameters): the model, not the key.
      return { kind: 'permanent', modelUnavailable: true, message: `no endpoint: ${msg(e)}` };
    case 429:
      return { kind: 'transient', keyFailure: 'rate_limited', message: 'rate limited' };
    default:
      if (status === 400 && /not a valid model|model.*not found|unknown model/i.test(e.message))
        return { kind: 'permanent', modelUnavailable: true, message: `invalid model: ${msg(e)}` };
      return genericHttpFailure(status, e);
  }
};

// ---------------------------------------------------------------- shared HTTP helpers

async function getJson(
  url: string,
  headers: Record<string, string>,
  opts: ListOptions,
): Promise<{ status: number; body: unknown }> {
  const res = await (opts.fetch ?? globalThis.fetch)(url, {
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: { message: text.slice(0, 200) } };
  }
  return { status: res.status, body };
}

/** A listing failure as a ModelError (classified, key never in the message). */
function listError(classify: HttpClassifier, status: number, body: unknown): ModelError {
  const f: HttpFailure = classify(status, providerError(body));
  return new ModelError(f.kind, `listing models failed (${status})`, status, f.keyFailure);
}

/** Verify through a one-token-ish chat completion (OpenAI, Gemini). */
async function verifyByCompletion(
  spec: {
    baseURL: string;
    classify: HttpClassifier;
    tokenParam: 'max_completion_tokens' | 'max_tokens';
  },
  apiKey: string,
  model: string,
  opts: ListOptions,
): Promise<VerifyResult> {
  try {
    const res = await (opts.fetch ?? globalThis.fetch)(`${spec.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        [spec.tokenParam]: 64,
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    if (res.ok) return { ok: true };
    let body: unknown = null;
    try {
      body = JSON.parse(await res.text());
    } catch {
      body = null;
    }
    return verdictOf(spec.classify(res.status, providerError(body)));
  } catch {
    return { ok: false, problem: 'unverifiable' };
  }
}

function verdictOf(f: HttpFailure): VerifyResult {
  const failure: KeyFailure | undefined = f.keyFailure;
  if (failure && failure !== 'rate_limited') return { ok: false, problem: failure as AiKeyProblem };
  return { ok: false, problem: 'unverifiable' };
}

// ---------------------------------------------------------------- listing filters

/** OpenAI's list has no capability fields: keep general chat/reasoning text models by id. */
export function openAIChatModel(id: string): boolean {
  if (!/^(gpt-|o\d|chatgpt-)/.test(id)) return false;
  if (
    /(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct|dall-e|whisper|codex|computer-use|deep-research|oss)/i.test(
      id,
    )
  )
    return false;
  // Dated snapshots duplicate their alias and make the list unusable.
  return !/-\d{4}-\d{2}-\d{2}$/.test(id);
}

/** Gemini native list entries that can chat (generateContent) and are general text models. */
export function geminiChatModel(m: {
  name?: string;
  supportedGenerationMethods?: string[];
}): boolean {
  const id = (m.name ?? '').replace(/^models\//, '');
  if (!id.startsWith('gemini-')) return false;
  if (!m.supportedGenerationMethods?.includes('generateContent')) return false;
  return !/(embedding|image|tts|audio|live|robotics|computer-use|aqa|native)/i.test(id);
}

const validId = (id: string) => AiModelId.safeParse(id).success;

// ---------------------------------------------------------------- the table

const OPENAI_BASE = 'https://api.openai.com/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GEMINI_NATIVE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

const compat =
  (base: Omit<OpenAICompatOptions, 'fetch'>): ProviderSpec['createClient'] =>
  (apiKey, model, opts = {}) =>
    new OpenAICompatModelClient(apiKey, model, {
      ...base,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });

export const PROVIDERS: Record<AiProvider, ProviderSpec> = {
  anthropic: {
    id: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5-5',
    modelEnv: 'INTERVIEWER_MODEL',
    curated: [
      { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ],
    createClient: (apiKey, model, opts = {}) =>
      new AnthropicModelClient(apiKey, model, opts.fetch ? { fetch: opts.fetch } : {}),
    async listModels(apiKey, opts = {}) {
      const client = anthropicClient(apiKey, {
        maxRetries: 0,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      });
      const out: { id: string; label: string }[] = [];
      try {
        for await (const m of client.models.list(
          { limit: 100 },
          { timeout: opts.timeoutMs ?? 15_000 },
        )) {
          if (out.length >= 200) break;
          if (m.lifecycle === 'retired') continue;
          const c = m.capabilities;
          // The interviewer needs adaptive thinking, effort and structured outputs.
          const usable = c
            ? c.thinking?.types?.adaptive?.supported &&
              c.effort?.supported &&
              c.structured_outputs?.supported
            : PROVIDERS.anthropic.curated.some((x) => x.id === m.id);
          if (usable) out.push({ id: m.id, label: m.display_name || m.id });
        }
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          const status = typeof err.status === 'number' ? err.status : 0;
          throw new ModelError(
            status === 401 || status === 403 ? 'permanent' : 'transient',
            `listing models failed (${status})`,
            status,
            status === 401 ? 'invalid' : undefined,
          );
        }
        throw new ModelError('transient', 'listing models failed');
      }
      return out;
    },
    verify: (apiKey, model, opts = {}) => verifyAnthropicKey(apiKey, model, opts),
  },

  openai: {
    id: 'openai',
    baseURL: OPENAI_BASE,
    defaultModel: 'gpt-6.2-astra',
    modelEnv: 'INTERVIEWER_MODEL_OPENAI',
    curated: [],
    createClient: compat({
      baseURL: OPENAI_BASE,
      classify: classifyOpenAI,
      effortParam: 'reasoning_effort',
      systemRole: 'developer',
      tokenParam: 'max_completion_tokens',
      extraBody: { stream_options: { include_usage: true, include_obfuscation: false } },
    }),
    async listModels(apiKey, opts = {}) {
      const { status, body } = await getJson(
        `${OPENAI_BASE}/models`,
        { authorization: `Bearer ${apiKey}` },
        opts,
      );
      if (status !== 200) throw listError(classifyOpenAI, status, body);
      const data = ((body as { data?: unknown[] })?.data ?? []) as {
        id?: string;
        created?: number;
      }[];
      return data
        .filter((m): m is { id: string; created?: number } => typeof m.id === 'string')
        .filter((m) => openAIChatModel(m.id) && validId(m.id))
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => ({ id: m.id, label: m.id }));
    },
    verify: (apiKey, model, opts = {}) =>
      verifyByCompletion(
        { baseURL: OPENAI_BASE, classify: classifyOpenAI, tokenParam: 'max_completion_tokens' },
        apiKey,
        model,
        opts,
      ),
  },

  gemini: {
    id: 'gemini',
    baseURL: GEMINI_BASE,
    defaultModel: 'gemini-4-hydrogen',
    modelEnv: 'INTERVIEWER_MODEL_GEMINI',
    curated: [],
    createClient: compat({
      baseURL: GEMINI_BASE,
      classify: classifyGemini,
      effortParam: 'reasoning_effort',
    }),
    async listModels(apiKey, opts = {}) {
      // The native list says which models can chat (`supportedGenerationMethods`); the
      // OpenAI-compatible one does not. Same fixed host.
      const out: { id: string; label: string }[] = [];
      let pageToken = '';
      for (let page = 0; page < 5; page++) {
        const { status, body } = await getJson(
          `${GEMINI_NATIVE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
          { 'x-goog-api-key': apiKey },
          opts,
        );
        if (status !== 200) throw listError(classifyGemini, status, body);
        const b = body as {
          models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
          nextPageToken?: string;
        };
        for (const m of b.models ?? []) {
          const id = (m.name ?? '').replace(/^models\//, '');
          if (geminiChatModel(m) && validId(id)) out.push({ id, label: m.displayName || id });
        }
        if (!b.nextPageToken) break;
        pageToken = b.nextPageToken;
      }
      return out;
    },
    verify: (apiKey, model, opts = {}) =>
      verifyByCompletion(
        { baseURL: GEMINI_BASE, classify: classifyGemini, tokenParam: 'max_tokens' },
        apiKey,
        model,
        opts,
      ),
  },

  openrouter: {
    id: 'openrouter',
    baseURL: OPENROUTER_BASE,
    defaultModel: 'openai/gpt-6.2-sol',
    modelEnv: 'INTERVIEWER_MODEL_OPENROUTER',
    curated: [],
    createClient: compat({
      baseURL: OPENROUTER_BASE,
      classify: classifyOpenRouter,
      effortParam: 'reasoning',
    }),
    async listModels(_apiKey, opts = {}) {
      // The catalogue is public: the key is not sent anywhere for this.
      const { status, body } = await getJson(
        `${OPENROUTER_BASE}/models?supported_parameters=structured_outputs`,
        {},
        opts,
      );
      if (status !== 200) throw listError(classifyOpenRouter, status, body);
      const data = ((body as { data?: unknown[] })?.data ?? []) as {
        id?: string;
        name?: string;
        architecture?: { output_modalities?: string[] };
        supported_parameters?: string[];
      }[];
      return data
        .filter((m) => typeof m.id === 'string' && validId(m.id))
        .filter((m) => {
          const out = m.architecture?.output_modalities;
          const params = m.supported_parameters ?? [];
          return (
            (!out || (out.includes('text') && !out.includes('image'))) &&
            (params.includes('structured_outputs') || params.includes('response_format'))
          );
        })
        .slice(0, 500)
        .map((m) => ({ id: m.id as string, label: m.name || (m.id as string) }));
    },
    async verify(apiKey, _model, opts = {}) {
      // GET /key describes the key without generating anything.
      try {
        const { status, body } = await getJson(
          `${OPENROUTER_BASE}/key`,
          { authorization: `Bearer ${apiKey}` },
          opts,
        );
        if (status === 200) {
          const left = (body as { data?: { limit_remaining?: unknown } })?.data?.limit_remaining;
          if (typeof left === 'number' && left <= 0) return { ok: false, problem: 'spend_limit' };
          return { ok: true };
        }
        return verdictOf(classifyOpenRouter(status, providerError(body)));
      } catch {
        return { ok: false, problem: 'unverifiable' };
      }
    },
  },
};

// ---------------------------------------------------------------- entry points

/** Default model per provider: env overrides (config) win over the built-in defaults. */
export function defaultModelFor(config: InterviewerConfig, provider: AiProvider): string {
  if (provider === 'anthropic') return config.model || PROVIDERS.anthropic.defaultModel;
  return config.models?.[provider] || PROVIDERS[provider].defaultModel;
}

/** The only place model clients are built (the key is always passed explicitly). */
export function createModelClient(
  provider: AiProvider,
  apiKey: string,
  model: string,
  opts: { fetch?: typeof fetch } = {},
): ModelClient {
  return PROVIDERS[provider].createClient(apiKey, model, opts);
}

/** One cheap call to check a key before it is stored, on the provider's default model. */
export function verifyProviderKey(
  provider: AiProvider,
  apiKey: string,
  model: string,
  opts: ListOptions = {},
): Promise<VerifyResult> {
  return PROVIDERS[provider].verify(apiKey, model, opts);
}

/**
 * Selectable models for a key: the live list, curated models first (Anthropic), the default
 * always present and marked. Throws a ModelError when the provider cannot be asked.
 */
export async function listProviderModels(
  provider: AiProvider,
  apiKey: string,
  defaultModel: string,
  opts: ListOptions = {},
): Promise<AiModelOption[]> {
  const spec = PROVIDERS[provider];
  const live = await spec.listModels(apiKey, opts);
  return arrange(spec, live, defaultModel);
}

/** The built-in list when live listing fails (Anthropic only; others just get the default). */
export function fallbackModels(provider: AiProvider, defaultModel: string): AiModelOption[] {
  return arrange(PROVIDERS[provider], PROVIDERS[provider].curated, defaultModel);
}

function arrange(
  spec: ProviderSpec,
  models: { id: string; label: string }[],
  defaultModel: string,
): AiModelOption[] {
  const byId = new Map<string, { id: string; label: string }>();
  for (const m of models) if (!byId.has(m.id)) byId.set(m.id, m);
  const order = spec.curated.map((c) => c.id);
  const sorted = [...byId.values()].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    return 0;
  });
  if (!byId.has(defaultModel)) {
    const curated = spec.curated.find((c) => c.id === defaultModel);
    sorted.unshift(curated ?? { id: defaultModel, label: defaultModel });
  }
  return sorted.map((m) => ({ id: m.id, label: m.label, default: m.id === defaultModel }));
}

export const providerLabel = (p: AiProvider) => AI_PROVIDERS[p].label;
