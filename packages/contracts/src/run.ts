/** Client-facing view of a code run. Hidden-test detail is stripped by the API, never by the browser. */
import { z } from 'zod';
import { Id, IsoDate, Json, Language, Slug } from './common';
import { CompileOutcome, FileOutcome, JudgeTestResult, RunVerdict, TestVerdict } from './judge';
import { Call } from './problem';

/**
 *  file     run the editor contents as an ordinary program (optional stdin)
 *  samples  extract the class and run the visible sample tests
 *  custom   extract the class and run candidate-written inputs (output only, no verdict)
 *  submit   extract the class and run every test, including hidden ones
 */
export const RunMode = z.enum(['file', 'samples', 'custom', 'submit']);
export type RunMode = z.infer<typeof RunMode>;

export const CustomTest = z.object({
  ctorArgs: z.array(Json).default([]),
  calls: z.array(Call).min(1),
});
export type CustomTest = z.infer<typeof CustomTest>;

export const CreateRunRequest = z.object({
  mode: RunMode,
  language: Language,
  source: z.string(),
  stdin: z.string().default(''),
  customTests: z.array(CustomTest).default([]),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export const PublicTestResult = z.discriminatedUnion('hidden', [
  JudgeTestResult.extend({ hidden: z.literal(false) }),
  /** Hidden tests reveal only the verdict and time. */
  z.object({ hidden: z.literal(true), id: z.string(), verdict: TestVerdict, timeMs: z.number() }),
]);
export type PublicTestResult = z.infer<typeof PublicTestResult>;

export const Run = z.object({
  id: Id,
  padId: Id,
  userId: z.string(),
  /** The pad's problem when the run was made (null: a blank room, or a run from before rooms). */
  problemSlug: Slug.nullable().optional(),
  mode: RunMode,
  language: Language,
  status: z.enum(['queued', 'running', 'finished']),
  verdict: RunVerdict.nullable(),
  compile: CompileOutcome.nullable(),
  file: FileOutcome.nullable(),
  tests: z.array(PublicTestResult),
  passed: z.int(),
  total: z.int(),
  message: z.string().nullable(),
  createdAt: IsoDate,
  finishedAt: IsoDate.nullable(),
});
export type Run = z.infer<typeof Run>;
