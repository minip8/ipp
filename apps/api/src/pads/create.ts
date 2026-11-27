/**
 * What every way of creating a pad shares: one allowance per user, and the insert of a pad with
 * its owner's membership (and a quant pad's round) in the caller's transaction. The routes of
 * `POST /api/pads`, `POST /api/pads/quant` and a staged interview's stages all go through here.
 */
import { randomBytes } from 'node:crypto';
import type { QuantRoundState } from '@ipp/contracts';
import { padMembers, pads, quantRounds } from '@ipp/db';
import type { Ctx } from '../context';
import { rateLimited } from '../http/errors';
import type { PadRow } from './service';

export type Tx = Parameters<Parameters<Ctx['db']['transaction']>[0]>[0];

/** Every way of creating a pad (a staged interview included) shares one allowance per user. */
export async function padCreateLimit(ctx: Ctx, userId: string): Promise<void> {
  const l = ctx.config.limits.padCreate;
  const wait = await ctx.limiter.hit([
    { key: `pads:u:${userId}:burst`, ...l.userBurst },
    { key: `pads:u:${userId}:day`, ...l.userDaily },
  ]);
  if (wait > 0) throw rateLimited(wait);
}

export type NewPad = Omit<typeof pads.$inferInsert, 'shareToken'>;

/** Inserts the pad (with a fresh share token) and its owner's membership. */
export async function insertPad(tx: Tx, values: NewPad): Promise<PadRow> {
  const [pad] = await tx
    .insert(pads)
    .values({ ...values, shareToken: randomBytes(18).toString('base64url') })
    .returning();
  if (!pad) throw new Error('pad insert failed');
  await tx.insert(padMembers).values({ padId: pad.id, userId: values.ownerId, role: 'owner' });
  return pad;
}

/**
 * A quant pad and its round: no problem and no language (the column is required, so `python` is
 * stored), the round's state as given at version 0.
 */
export async function insertQuantPad(
  tx: Tx,
  values: Omit<NewPad, 'format' | 'problemSlug' | 'language'>,
  state: QuantRoundState,
): Promise<PadRow> {
  const pad = await insertPad(tx, {
    ...values,
    format: 'quant',
    problemSlug: null,
    // Stored because the column is required; a quant pad has no language.
    language: 'python',
  });
  await tx.insert(quantRounds).values({ padId: pad.id, state, version: 0 });
  return pad;
}
