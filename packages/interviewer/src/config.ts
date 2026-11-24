import type { InterviewerConfig } from './types';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * Reads the interviewer config from an env object (`process.env` or a parsed .env). There is no
 * key here on purpose: every model call runs on the key of the user it serves
 * (`InterviewerDeps.resolveKey`), never on an operator key from the environment.
 */
export function interviewerConfigFromEnv(
  env: Record<string, string | undefined>,
): InterviewerConfig {
  return { model: (env.INTERVIEWER_MODEL || '').trim() || DEFAULT_MODEL };
}
