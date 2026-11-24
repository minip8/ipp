/**
 * Bring-your-own API key (docs/ARCHITECTURE.md §7). The operator pays for no model usage: the
 * interviewer, the end-of-interview assessment and AI grading of short answers run only on a key
 * the user saved, from one of the supported providers. The key itself never crosses back to the
 * browser; only these shapes do.
 *
 * What the browser may know about a provider lives here (label, key shape, help links). How the
 * server talks to it (fixed base URL, model listing, error classification) lives in
 * packages/interviewer/src/providers.ts and is never user-supplied.
 */
import { z } from 'zod';
import { IsoDate } from './common';

/** Model providers a user can bring a key for. */
export const AiProvider = z.enum(['anthropic', 'openai', 'gemini', 'openrouter']);
export type AiProvider = z.infer<typeof AiProvider>;

export interface AiProviderInfo {
  id: AiProvider;
  /** "Anthropic", "OpenAI", … */
  label: string;
  /** Where the key is created ("Anthropic Console"). */
  consoleName: string;
  consoleKeysUrl: string;
  /** Where spend limits are set, when the provider has such a page. */
  consoleLimitsUrl: string | null;
  /** Prefix shown in placeholders and masks. */
  keyPrefix: string;
  /** Every prefix a key of this provider can start with. */
  keyPrefixes: string[];
  /** The whole key (after trimming). */
  keyPattern: RegExp;
}

export const AI_KEY_MAX_CHARS = 260;

/**
 * One entry per provider. Order is the order the UI offers them in. Patterns are deliberately
 * disjoint so a pasted key names its provider (`inferAiProvider`).
 */
export const AI_PROVIDERS: Record<AiProvider, AiProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    consoleName: 'Anthropic Console',
    consoleKeysUrl: 'https://console.anthropic.com/settings/keys',
    consoleLimitsUrl: 'https://console.anthropic.com/settings/limits',
    keyPrefix: 'sk-ant-',
    keyPrefixes: ['sk-ant-'],
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{16,250}$/,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    consoleName: 'OpenAI Platform',
    consoleKeysUrl: 'https://platform.openai.com/api-keys',
    consoleLimitsUrl: 'https://platform.openai.com/settings/organization/limits',
    keyPrefix: 'sk-',
    keyPrefixes: ['sk-'],
    // Project (sk-proj-), service-account (sk-svcacct-) and legacy (sk-) keys. Admin keys
    // (sk-admin-) cannot call models; Anthropic and OpenRouter keys also start with sk-.
    keyPattern: /^sk-(?!ant-|or-|admin-)[A-Za-z0-9_-]{20,250}$/,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    consoleName: 'Google AI Studio',
    consoleKeysUrl: 'https://aistudio.google.com/app/apikey',
    consoleLimitsUrl: null,
    keyPrefix: 'AIza',
    // Classic API keys (AIza…) and the newer AI Studio auth keys (AQ.…). Google documents no
    // fixed format for the latter, so the check is loose.
    keyPrefixes: ['AIza', 'AQ.'],
    keyPattern: /^(AIza[A-Za-z0-9_-]{30,60}|AQ\.[A-Za-z0-9._-]{20,250})$/,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    consoleName: 'OpenRouter dashboard',
    consoleKeysUrl: 'https://openrouter.ai/settings/keys',
    consoleLimitsUrl: 'https://openrouter.ai/settings/keys',
    keyPrefix: 'sk-or-',
    keyPrefixes: ['sk-or-'],
    keyPattern: /^sk-or-[A-Za-z0-9_-]{16,250}$/,
  },
};

export const AI_PROVIDER_IDS = AiProvider.options;

/** "an Anthropic", "a Google Gemini". */
const an = (label: string) => `${/^[AEIOU]/i.test(label) ? 'an' : 'a'} ${label}`;

/** The provider a key belongs to, judged by its shape alone; null when it fits none. */
export function inferAiProvider(rawKey: string): AiProvider | null {
  const key = rawKey.trim();
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('AIza') || key.startsWith('AQ.')) return 'gemini';
  if (key.startsWith('sk-') && !key.startsWith('sk-admin-')) return 'openai';
  return null;
}

/** Why a key cannot be saved for `provider` (shape only), or null when it looks right. */
export function aiKeyShapeError(provider: AiProvider, rawKey: string): string | null {
  const info = AI_PROVIDERS[provider];
  const key = rawKey.trim();
  if (!key) return 'Paste your API key.';
  if (key.length > AI_KEY_MAX_CHARS) return `That is too long to be ${an(info.label)} API key.`;
  if (/\s/.test(key)) return 'The key cannot contain spaces or line breaks.';
  const inferred = inferAiProvider(key);
  if (inferred && inferred !== provider)
    return `That looks like ${an(AI_PROVIDERS[inferred].label)} key, but ${info.label} is selected. Choose ${AI_PROVIDERS[inferred].label} or paste ${an(info.label)} key.`;
  if (!info.keyPrefixes.some((p) => key.startsWith(p)))
    return `${info.label} API keys start with ${info.keyPrefixes.map((p) => `“${p}”`).join(' or ')}.`;
  if (!info.keyPattern.test(key))
    return 'That key looks incomplete. Copy the whole key and try again.';
  return null;
}

/**
 * `active` = stored and usable; `missing` = none saved (or it expired after a day unused);
 * `rejected` = the provider refused it while it was in use (revoked, out of credit, no access
 * to the model). A rejected key is discarded; only its last four characters are kept to show
 * the user.
 */
export const AiKeyState = z.enum(['active', 'missing', 'rejected']);
export type AiKeyState = z.infer<typeof AiKeyState>;

/** Why the provider refused a key (on save, or later while it was in use). */
export const AiKeyProblem = z.enum([
  /** 401: not a valid key, or revoked. */
  'invalid',
  /** 403 / 404: the key cannot use the provider's default interviewer model. */
  'permission',
  /** 402, a "credit balance too low" 400, or an exhausted quota. */
  'billing',
  /** The organization's monthly spend limit is reached. */
  'spend_limit',
]);
export type AiKeyProblem = z.infer<typeof AiKeyProblem>;

/** Model ids as providers spell them (`claude-opus-5-5`, `gpt-…`, `vendor/model:variant`). */
export const AiModelId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/, 'Not a model id');

/** A model the user picked; used only while their key is from the same provider. */
export const AiModelChoice = z.object({ provider: AiProvider, id: AiModelId });
export type AiModelChoice = z.infer<typeof AiModelChoice>;

export const AiKeyStatus = z.object({
  state: AiKeyState,
  /** Whose key it is (also for a rejected key); null without one. */
  provider: AiProvider.nullable().default(null),
  /** Last four characters of the saved (or rejected) key; never more. */
  last4: z.string().length(4).nullable(),
  /** When an active key is deleted if it is not used again (sliding expiry). */
  expiresAt: IsoDate.nullable(),
  /** Present when `state` is `rejected`. */
  problem: AiKeyProblem.nullable(),
  /**
   * The provider's default interviewer model (Anthropic's without a key), so the user knows what
   * the key is billed for unless they choose another model for an interview.
   */
  model: z.string(),
  /** Hours an unused key is kept. */
  ttlHours: z.int(),
});
export type AiKeyStatus = z.infer<typeof AiKeyStatus>;

/** Anthropic keys start with `sk-ant-` (kept for callers that only know Anthropic). */
export const AI_KEY_PATTERN = AI_PROVIDERS.anthropic.keyPattern;

/**
 * `provider` is what the user chose in the UI. Without it the provider is inferred from the
 * key's shape (older clients sent only `apiKey`). A key that does not fit the provider is refused
 * here, before anything is sent anywhere.
 */
export const SaveAiKeyRequest = z
  .object({
    provider: AiProvider.optional(),
    apiKey: z
      .string()
      .max(AI_KEY_MAX_CHARS, 'That is too long to be an API key')
      .transform((s) => s.trim()),
  })
  .transform((v, ctx) => {
    const provider = v.provider ?? inferAiProvider(v.apiKey);
    if (!provider) {
      ctx.addIssue({
        code: 'custom',
        path: ['apiKey'],
        message:
          'That does not look like an API key from a supported provider (Anthropic, OpenAI, Google Gemini or OpenRouter)',
      });
      return z.NEVER;
    }
    const error = aiKeyShapeError(provider, v.apiKey);
    if (error) {
      ctx.addIssue({ code: 'custom', path: ['apiKey'], message: error });
      return z.NEVER;
    }
    return { provider, apiKey: v.apiKey };
  });
export type SaveAiKeyRequest = z.input<typeof SaveAiKeyRequest>;

/** One selectable model for the user's key (`GET /api/ai-key/models`). */
export const AiModelOption = z.object({
  id: AiModelId,
  /** Human name when the provider gives one, else the id. */
  label: z.string(),
  /** The provider's default interviewer model. */
  default: z.boolean(),
});
export type AiModelOption = z.infer<typeof AiModelOption>;

export const AiModelList = z.object({
  provider: AiProvider,
  defaultModel: AiModelId,
  models: z.array(AiModelOption),
  /** `live` = listed by the provider for this key; `fallback` = a built-in list (listing failed). */
  source: z.enum(['live', 'fallback']),
});
export type AiModelList = z.infer<typeof AiModelList>;

/** The model the interviewer of a pad actually runs on (the owner's key provider). */
export const InterviewerModel = z.object({
  provider: AiProvider,
  id: AiModelId,
  /** true when it is the pad's chosen model, false for the provider default. */
  chosen: z.boolean(),
  /** The provider's default, so a client can recompute this when the pad's choice changes. */
  defaultModel: AiModelId,
});
export type InterviewerModel = z.infer<typeof InterviewerModel>;

/**
 * The model for a call on a `provider` key: the pad's choice when it is for that provider,
 * otherwise the provider default.
 */
export function effectiveModel(
  choice: AiModelChoice | null | undefined,
  provider: AiProvider,
  defaultModel: string,
): InterviewerModel {
  return choice && choice.provider === provider
    ? { provider, id: choice.id, chosen: choice.id !== defaultModel, defaultModel }
    : { provider, id: defaultModel, chosen: false, defaultModel };
}

/**
 * Error codes of a refused save (status 422 for a key the provider refused, 503 when the
 * provider could not be reached, 429 for the save rate limit). The message is safe to show.
 */
export const AI_KEY_ERROR_CODES = {
  rejected: 'ai_key_rejected',
  unverifiable: 'ai_key_unverifiable',
  /** GET /api/ai-key/models without a usable key. */
  missing: 'ai_key_missing',
} as const;
