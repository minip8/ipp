import { CreateRunRequest } from '@ipp/contracts';
import { padMembers, runs } from '@ipp/db';
import { and, eq } from '@ipp/db/orm';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireUser } from '../http/app';
import { conflict, notFound } from '../http/errors';
import { padForMember } from '../pads/service';
import { toPublicRun } from '../runs/redact';
import { storedRun } from '../views';

export function runRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.post('/pads/:id/runs', async (c) => {
    const user = requireUser(c);
    const { pad } = await padForMember(ctx, c.req.param('id'), user.id);
    if (pad.status !== 'active') throw conflict('pad_ended', 'This pad has ended');
    const body = await parseBody(c, CreateRunRequest);
    const run = await ctx.runs.create({
      userId: user.id,
      ip: c.get('ip'),
      padId: pad.id,
      problemSlug: pad.problemSlug,
      body,
    });
    return c.json(run, 201);
  });

  r.get('/runs/:id', async (c) => {
    const user = requireUser(c);
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Run');
    const [row] = await ctx.db
      .select({ run: runs })
      .from(runs)
      .innerJoin(padMembers, and(eq(padMembers.padId, runs.padId), eq(padMembers.userId, user.id)))
      .where(eq(runs.id, id));
    if (!row) throw notFound('Run');
    return c.json(toPublicRun(storedRun(row.run)));
  });

  return r;
}
