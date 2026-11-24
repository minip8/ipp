/**
 * The one module that knows where the interviewer implementation comes from. Tests pass their
 * own factory and key verifier to createApi instead.
 *
 * There is no operator key: the interviewer is built without one and resolves the key of the
 * user it serves for every model call (InterviewerHost.resolveKey).
 */
import { createInterviewer, type VerifyResult, verifyApiKey } from '@ipp/interviewer';
import type { Config } from '../config';
import type { InterviewerFactory } from './host';

export function defaultInterviewerFactory(config: Config): InterviewerFactory {
  return (deps) => createInterviewer({ model: config.interviewerModel }, deps);
}

export type KeyVerifier = (apiKey: string) => Promise<VerifyResult>;

/** One cheap real call to Anthropic with the key the user is saving. */
export function defaultKeyVerifier(config: Config): KeyVerifier {
  return (apiKey) => verifyApiKey(apiKey, config.interviewerModel);
}
