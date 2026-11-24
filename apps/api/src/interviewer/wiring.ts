/**
 * The one module that knows where the interviewer implementation comes from. Tests pass their
 * own factory, key verifier and model lister to createApi instead.
 *
 * There is no operator key: the interviewer is built without one and resolves the key of the
 * user it serves for every model call (InterviewerHost.resolveKey). Provider base URLs are fixed
 * inside @ipp/interviewer (providers.ts); nothing here or in a request can change them.
 */
import type { AiModelOption, AiProvider } from '@ipp/contracts';
import {
  createInterviewer,
  defaultModelFor,
  listProviderModels,
  type VerifyResult,
  verifyProviderKey,
} from '@ipp/interviewer';
import type { Config } from '../config';
import type { InterviewerFactory } from './host';

/** The interviewer config (default model per provider) from the API config. */
export const interviewerConfig = (config: Config) => ({
  model: config.interviewerModel,
  models: config.interviewerModels,
});

/** The provider's default interviewer model (env overrides included). */
export const defaultModel = (config: Config, provider: AiProvider) =>
  defaultModelFor(interviewerConfig(config), provider);

export function defaultInterviewerFactory(config: Config): InterviewerFactory {
  return (deps) => createInterviewer(interviewerConfig(config), deps);
}

export type KeyVerifier = (apiKey: string, provider: AiProvider) => Promise<VerifyResult>;

/** One cheap real call to the provider with the key the user is saving, on its default model. */
export function defaultKeyVerifier(config: Config): KeyVerifier {
  return (apiKey, provider) => verifyProviderKey(provider, apiKey, defaultModel(config, provider));
}

/** Chat models the user's key can use, live from the provider (throws a ModelError on failure). */
export type ModelLister = (apiKey: string, provider: AiProvider) => Promise<AiModelOption[]>;

export function defaultModelLister(config: Config): ModelLister {
  return (apiKey, provider) => listProviderModels(provider, apiKey, defaultModel(config, provider));
}
