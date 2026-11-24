import type { AiProvider } from '@ipp/contracts';
import { PROVIDERS } from './providers';
import type { InterviewerConfig } from './types';

/** The Anthropic default (INTERVIEWER_MODEL). */
export const DEFAULT_MODEL = PROVIDERS.anthropic.defaultModel;

/**
 * Reads the interviewer config from an env object (`process.env` or a parsed .env): the default
 * model of each provider (INTERVIEWER_MODEL for Anthropic, INTERVIEWER_MODEL_OPENAI,
 * INTERVIEWER_MODEL_GEMINI, INTERVIEWER_MODEL_OPENROUTER). There is no key here on purpose:
 * every model call runs on the key of the user it serves (`InterviewerDeps.resolveKey`), never
 * on an operator key from the environment.
 */
export function interviewerConfigFromEnv(
  env: Record<string, string | undefined>,
): InterviewerConfig {
  const models: Partial<Record<AiProvider, string>> = {};
  for (const p of ['openai', 'gemini', 'openrouter'] as const) {
    const v = (env[PROVIDERS[p].modelEnv] || '').trim();
    if (v) models[p] = v;
  }
  return {
    model: (env.INTERVIEWER_MODEL || '').trim() || DEFAULT_MODEL,
    ...(Object.keys(models).length ? { models } : {}),
  };
}
