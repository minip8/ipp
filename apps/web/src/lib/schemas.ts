/**
 * Response shapes for the few endpoints that have no schema in @ipp/contracts
 * (docs/ARCHITECTURE.md §4). Everything else is imported from the contracts.
 */
import { z } from 'zod';

export const MeResponse = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable().optional(),
  }),
});
export type Me = z.infer<typeof MeResponse>['user'];

/**
 * Server facts. The AI features run only on each user's own Anthropic key, so whether they work
 * is per user (`GET /api/ai-key`) or per pad (`PadDetail.interviewerAvailable`), not here.
 */
export const ConfigResponse = z.object({
  githubAuth: z.boolean(),
  googleAuth: z.boolean(),
  ai: z.object({
    requiresUserKey: z.literal(true),
    model: z.string(),
    keyTtlHours: z.int(),
  }),
});
export type AppConfig = z.infer<typeof ConfigResponse>;

export const JoinResponse = z.object({ padId: z.string() });

export const RecordedResponse = z.object({ recorded: z.literal(true) });
