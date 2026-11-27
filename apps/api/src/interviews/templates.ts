/**
 * Saved interview plans (@ipp/contracts `interview.ts`, `InterviewTemplate`): a plan under a
 * name, to start interviews from. Only a named plan: starting an interview from one sends its
 * stages to `POST /api/interviews`, which checks them against the content then; here a plan is
 * checked for its shape only (the contract). Changing or deleting a template does nothing to
 * interviews started from it.
 *
 * - A name is unique per owner and track, whatever its case: the unique index on
 *   (owner_id, track, lower(name)) decides, and its violation is 409 `template_name_taken`, so
 *   two saves of one name at once cannot both win.
 * - At most `INTERVIEW_TEMPLATES_MAX` per owner (409 `template_limit`): a save counts and
 *   inserts in one transaction holding the owner's `user` row (`for no key update`), so saves
 *   of one owner are taken one at a time and two at once cannot both pass the count.
 */
import {
  INTERVIEW_TEMPLATES_MAX,
  type InterviewTemplate,
  type SaveInterviewTemplateRequest,
  type UpdateInterviewTemplateRequest,
} from '@ipp/contracts';
import { interviewTemplates, user } from '@ipp/db';
import { and, asc, count, eq, sql } from '@ipp/db/orm';
import type { Ctx } from '../context';
import { conflict, notFound, rateLimited } from '../http/errors';
import { isUniqueViolation } from '../pg';
import { templateView } from '../views';

/** A canonical uuid; anything else is 404 before Postgres sees it (it would refuse it: a 500). */
const isId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const nameTaken = () =>
  conflict('template_name_taken', 'You already have a plan of that name in this track');

/** Saving, renaming or deleting one: a per-user burst and daily allowance. */
export async function templateWriteLimit(ctx: Ctx, userId: string): Promise<void> {
  const l = ctx.config.limits.templateWrites;
  const wait = await ctx.limiter.hit([
    { key: `tpl:u:${userId}:burst`, ...l.userBurst },
    { key: `tpl:u:${userId}:day`, ...l.userDaily },
  ]);
  if (wait > 0) throw rateLimited(wait);
}

/** The user's templates in every track, by name whatever its case, then id. */
export async function templatesOf(ctx: Ctx, userId: string): Promise<InterviewTemplate[]> {
  const rows = await ctx.db
    .select()
    .from(interviewTemplates)
    .where(eq(interviewTemplates.ownerId, userId))
    .orderBy(asc(sql`lower(${interviewTemplates.name})`), asc(interviewTemplates.id));
  return rows.map(templateView);
}

export async function saveTemplate(
  ctx: Ctx,
  userId: string,
  body: SaveInterviewTemplateRequest,
): Promise<InterviewTemplate> {
  try {
    const row = await ctx.db.transaction(async (tx) => {
      // Saves of one owner wait here for each other, so the count below stays true until the
      // insert. `no key update` does not block the row's other readers or its FK references.
      await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('no key update');
      const [held] = await tx
        .select({ n: count() })
        .from(interviewTemplates)
        .where(eq(interviewTemplates.ownerId, userId));
      if ((held?.n ?? 0) >= INTERVIEW_TEMPLATES_MAX)
        throw conflict(
          'template_limit',
          `You can keep at most ${INTERVIEW_TEMPLATES_MAX} saved plans; delete one first`,
        );
      const [inserted] = await tx
        .insert(interviewTemplates)
        .values({ ownerId: userId, track: body.track, name: body.name, stages: body.stages })
        .returning();
      if (!inserted) throw new Error('template insert returned nothing');
      return inserted;
    });
    return templateView(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

/** Renames it and/or replaces its plan; someone else's or an unknown id is 404. */
export async function updateTemplate(
  ctx: Ctx,
  userId: string,
  id: string,
  body: UpdateInterviewTemplateRequest,
): Promise<InterviewTemplate> {
  if (!isId(id)) throw notFound('Template');
  let row: typeof interviewTemplates.$inferSelect | undefined;
  try {
    [row] = await ctx.db
      .update(interviewTemplates)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.stages !== undefined ? { stages: body.stages } : {}),
        updatedAt: sql`now()`,
      })
      .where(and(eq(interviewTemplates.id, id), eq(interviewTemplates.ownerId, userId)))
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
  if (!row) throw notFound('Template');
  return templateView(row);
}

/** Deletes it; someone else's, an unknown id or one already deleted is 404. */
export async function deleteTemplate(ctx: Ctx, userId: string, id: string): Promise<void> {
  if (!isId(id)) throw notFound('Template');
  const [row] = await ctx.db
    .delete(interviewTemplates)
    .where(and(eq(interviewTemplates.id, id), eq(interviewTemplates.ownerId, userId)))
    .returning({ id: interviewTemplates.id });
  if (!row) throw notFound('Template');
}
