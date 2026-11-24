/** Pure helpers for the API key and model UI (unit-tested). */
import {
  AI_PROVIDERS,
  type AiKeyProblem,
  type AiModelChoice,
  type AiModelList,
  type AiProvider,
  aiKeyShapeError,
  inferAiProvider,
} from '@ipp/contracts';

export const PROVIDER_ORDER: AiProvider[] = ['anthropic', 'openai', 'gemini', 'openrouter'];

export const providerLabel = (p: AiProvider | null | undefined) =>
  p ? AI_PROVIDERS[p].label : 'your AI provider';

/** Where to create a key for `provider`. */
export const consoleUrl = (p: AiProvider) => AI_PROVIDERS[p].consoleKeysUrl;

/** What the user pasted, cleaned the way the server will clean it (surrounding whitespace). */
export function normalizeKey(raw: string): string {
  return raw.trim();
}

/** A message for a key that cannot be right for `provider`, or null when it looks right. */
export function keyFormatError(raw: string, provider: AiProvider = 'anthropic'): string | null {
  return aiKeyShapeError(provider, normalizeKey(raw));
}

/** The provider a pasted key clearly belongs to, when that is not the selected one. */
export function otherProvider(raw: string, selected: AiProvider): AiProvider | null {
  const p = inferAiProvider(normalizeKey(raw));
  return p && p !== selected ? p : null;
}

export const keyPlaceholder = (p: AiProvider) => `${AI_PROVIDERS[p].keyPrefix}…`;

export function problemText(problem: AiKeyProblem, provider: AiProvider | null): string {
  switch (problem) {
    case 'invalid':
      return `${providerLabel(provider)} no longer accepts it (it may have been revoked).`;
    case 'permission':
      return 'It cannot use the model the interviewer runs on.';
    case 'billing':
      return 'Its account ran out of credit.';
    case 'spend_limit':
      return 'Its account reached its spend limit.';
  }
}

/** "in 23 hours", "in 40 minutes", "in less than a minute" (expiry of an unused key). */
export function expiresIn(expiresAt: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms < 60_000) return 'in less than a minute';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.round(min / 60);
  return `in ${h} hour${h === 1 ? '' : 's'}`;
}

/** "sk-ant-…AB12": the only part of a saved key the UI ever shows. */
export const maskedKey = (last4: string | null, provider: AiProvider | null = 'anthropic') =>
  last4 ? `${AI_PROVIDERS[provider ?? 'anthropic'].keyPrefix}…${last4}` : 'your key';

/** "OpenAI rejected your API key" / "The AI provider rejected your API key". */
export const rejectedTitle = (provider: AiProvider | null | undefined, whose = 'your') =>
  `${provider ? AI_PROVIDERS[provider].label : 'The AI provider'} rejected ${whose} API key`;

/** Value of the "provider default" option in the model picker. */
export const DEFAULT_MODEL_VALUE = '__default__';

/**
 * What the model picker shows for a stored choice: the chosen id when it belongs to the key's
 * provider, else the default. `stale` = a choice for another provider (it will not be used).
 */
export function pickerValue(
  choice: AiModelChoice | null | undefined,
  provider: AiProvider | null | undefined,
): { value: string; stale: AiModelChoice | null } {
  if (!choice) return { value: DEFAULT_MODEL_VALUE, stale: null };
  if (!provider || choice.provider !== provider)
    return { value: DEFAULT_MODEL_VALUE, stale: choice };
  return { value: choice.id, stale: null };
}

/** The choice to store for a picker value (null = provider default). */
export function choiceFor(value: string, provider: AiProvider): AiModelChoice | null {
  return value === DEFAULT_MODEL_VALUE ? null : { provider, id: value };
}

/**
 * The options for the picker: "Default (id)" first, then every listed model except the
 * default; a chosen id the list does not contain (anymore) is kept so the select can show it.
 */
export function pickerOptions(
  list: AiModelList | undefined,
  defaultModel: string,
  chosen: string | null,
): { value: string; label: string; hint?: string }[] {
  const def = list?.defaultModel ?? defaultModel;
  const defLabel = list?.models.find((m) => m.id === def)?.label ?? def;
  const out: { value: string; label: string; hint?: string }[] = [
    { value: DEFAULT_MODEL_VALUE, label: `Default: ${defLabel}`, hint: def },
  ];
  for (const m of list?.models ?? []) {
    if (m.id === def) continue;
    out.push({ value: m.id, label: m.label, hint: m.label !== m.id ? m.id : undefined });
  }
  if (chosen && chosen !== def && !out.some((o) => o.value === chosen))
    out.push({ value: chosen, label: chosen, hint: 'not in the list' });
  return out;
}
