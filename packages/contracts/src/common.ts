import { z } from 'zod';

export const LANGUAGES = ['cpp', 'python', 'java'] as const;
export const Language = z.enum(LANGUAGES);
export type Language = z.infer<typeof Language>;

export const LANGUAGE_LABELS: Record<Language, string> = {
  cpp: 'C++',
  python: 'Python',
  java: 'Java',
};

export const Id = z.uuid();
export const IsoDate = z.iso.datetime({ offset: true });
export const Identifier = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(64);
export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);

/** Any JSON value. Used for test-case arguments and results. */
export const Json = z.json();
export type Json = z.infer<typeof Json>;

/** Hard input caps enforced by the API before anything is queued or sent to a model. */
export const CAPS = {
  sourceBytes: 64 * 1024,
  stdinBytes: 64 * 1024,
  chatChars: 4000,
  customTests: 5,
  notesChars: 20_000,
} as const;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Seconds until retry is allowed, for rate_limited. */
    retryAfter: z.number().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
