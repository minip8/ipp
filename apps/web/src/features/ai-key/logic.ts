/** Pure helpers for the API key UI (unit-tested). */
import { AI_KEY_MAX_CHARS, AI_KEY_PATTERN, type AiKeyProblem } from '@ipp/contracts';

export const CONSOLE_KEYS_URL = 'https://console.anthropic.com/settings/keys';
export const CONSOLE_LIMITS_URL = 'https://console.anthropic.com/settings/limits';

/** What the user pasted, cleaned the way the server will clean it (surrounding whitespace). */
export function normalizeKey(raw: string): string {
  return raw.trim();
}

/** A message for a key that cannot be right, or null when it looks like an Anthropic key. */
export function keyFormatError(raw: string): string | null {
  const key = normalizeKey(raw);
  if (!key) return 'Paste your API key.';
  if (key.length > AI_KEY_MAX_CHARS) return 'That is too long to be an Anthropic API key.';
  if (/\s/.test(key)) return 'The key cannot contain spaces or line breaks.';
  if (!key.startsWith('sk-ant-'))
    return key.startsWith('sk-')
      ? 'That looks like a key from another provider. Anthropic keys start with “sk-ant-”.'
      : 'Anthropic API keys start with “sk-ant-”.';
  if (!AI_KEY_PATTERN.test(key))
    return 'That key looks incomplete. Copy the whole key and try again.';
  return null;
}

export const PROBLEM_TEXT: Record<AiKeyProblem, string> = {
  invalid: 'Anthropic no longer accepts it (it may have been revoked).',
  permission: 'It cannot use the model the interviewer runs on.',
  billing: 'Its account ran out of credit.',
  spend_limit: 'Its account reached its monthly spend limit.',
};

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
export const maskedKey = (last4: string | null) => (last4 ? `sk-ant-…${last4}` : 'your key');
