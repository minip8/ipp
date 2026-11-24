/**
 * Bring-your-own Anthropic API key (docs/ARCHITECTURE.md §7). The operator pays for no model
 * usage: the interviewer, the end-of-interview assessment and AI grading of short answers run
 * only on a key the user saved. The key itself never crosses back to the browser; only these
 * shapes do.
 */
import { z } from 'zod';
import { IsoDate } from './common';

/**
 * `active` = stored and usable; `missing` = none saved (or it expired after a day unused);
 * `rejected` = Anthropic refused it while it was in use (revoked, out of credit, no access to the
 * model). A rejected key is discarded; only its last four characters are kept to show the user.
 */
export const AiKeyState = z.enum(['active', 'missing', 'rejected']);
export type AiKeyState = z.infer<typeof AiKeyState>;

/** Why Anthropic refused a key (on save, or later while it was in use). */
export const AiKeyProblem = z.enum([
  /** 401: not a valid key, or revoked. */
  'invalid',
  /** 403 / 404: the key's organization cannot use the interviewer's model. */
  'permission',
  /** 402, or a "credit balance too low" 400. */
  'billing',
  /** The organization's monthly spend limit is reached. */
  'spend_limit',
]);
export type AiKeyProblem = z.infer<typeof AiKeyProblem>;

export const AiKeyStatus = z.object({
  state: AiKeyState,
  /** Last four characters of the saved (or rejected) key; never more. */
  last4: z.string().length(4).nullable(),
  /** When an active key is deleted if it is not used again (sliding expiry). */
  expiresAt: IsoDate.nullable(),
  /** Present when `state` is `rejected`. */
  problem: AiKeyProblem.nullable(),
  /** The model interviews use, so the user knows what the key will be billed for. */
  model: z.string(),
  /** Hours an unused key is kept. */
  ttlHours: z.int(),
});
export type AiKeyStatus = z.infer<typeof AiKeyStatus>;

/** Anthropic keys start with `sk-ant-`; anything else is refused before calling Anthropic. */
export const AI_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{16,250}$/;
export const AI_KEY_MAX_CHARS = 260;

export const SaveAiKeyRequest = z.object({
  apiKey: z
    .string()
    .max(AI_KEY_MAX_CHARS, 'That is too long to be an Anthropic API key')
    .transform((s) => s.trim())
    .refine((s) => AI_KEY_PATTERN.test(s), {
      message: 'Anthropic API keys start with "sk-ant-" and contain no spaces',
    }),
});
export type SaveAiKeyRequest = z.input<typeof SaveAiKeyRequest>;

/**
 * Error codes of a refused save (status 422 for a key Anthropic refused, 503 when Anthropic
 * could not be reached, 429 for the save rate limit). The message is safe to show.
 */
export const AI_KEY_ERROR_CODES = {
  rejected: 'ai_key_rejected',
  unverifiable: 'ai_key_unverifiable',
} as const;
