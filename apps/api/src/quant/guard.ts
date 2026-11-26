/**
 * Answers are not a tab away (ARCHITECTURE §8.4): while a user is a candidate in an active quant
 * room, the quiz endpoints that reveal answers or explanations refuse them, so the question the
 * host just posed cannot be looked up in the question bank mid-interview.
 *
 * This is a deterrent, not a control. A second account, a guest session in one browser and an
 * account in another, or someone else's device defeats it; the real control is the host, who is
 * watching. It never affects the host (the owner of the room), and it lifts as soon as the room
 * ends or the candidate leaves it (`DELETE /api/pads/:id` removes their membership), and in any
 * case `QUANT_INTERVIEW_GUARD_HOURS` after the room started: a host who never ends a room must
 * not keep a candidate out of their own quizzes for good. A guest cannot reach the quiz at all
 * (`requireAccount`), so this matters for candidates signed in with an account.
 */
import { padMembers, pads } from '@ipp/db';
import { and, eq, gt, ne } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { conflict } from '../http/errors';

/** A room older than this no longer holds its candidates out of the quiz, ended or not. */
export const QUANT_INTERVIEW_GUARD_HOURS = 8;

/** The error code a client can recognise. */
export const IN_QUANT_INTERVIEW = 'in_quant_interview';

/** Whether `userId` is a candidate (not the host) in a quant room that is still going. */
export async function inQuantInterview(ctx: Ctx, userId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: pads.id })
    .from(padMembers)
    .innerJoin(pads, eq(pads.id, padMembers.padId))
    .where(
      and(
        eq(padMembers.userId, userId),
        ne(padMembers.role, 'owner'),
        eq(pads.kind, 'room'),
        eq(pads.format, 'quant'),
        eq(pads.status, 'active'),
        gt(pads.startedAt, new Date(Date.now() - QUANT_INTERVIEW_GUARD_HOURS * 3_600_000)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** 409 `in_quant_interview` for a candidate in an active quant room; nothing for anyone else. */
export async function refuseDuringQuantInterview(ctx: Ctx, userId: string): Promise<void> {
  if (await inQuantInterview(ctx, userId))
    throw conflict(
      IN_QUANT_INTERVIEW,
      'You are a candidate in a quant interview that is still going: answers and explanations are unavailable until it ends or you leave it.',
    );
}
