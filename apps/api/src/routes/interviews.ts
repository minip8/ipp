/**
 * Staged interviews (@ipp/contracts `interview.ts` has the route table): accounts only, and only
 * the owner (anyone else's is 404). The work is in `interviews/service.ts`.
 */
import {
  AdvanceInterviewRequest,
  CreateInterviewRequest,
  type DeleteInterviewResponse,
} from '@ipp/contracts';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireAccount } from '../http/app';
import {
  advanceInterview,
  createInterview,
  deleteInterview,
  endInterview,
  interviewOf,
  interviewsOf,
  ownInterview,
} from '../interviews/service';

export function interviewRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.post('/interviews', async (c) => {
    const user = requireAccount(c);
    const body = await parseBody(c, CreateInterviewRequest);
    return c.json(await createInterview(ctx, user, body));
  });

  r.get('/interviews', async (c) => {
    const user = requireAccount(c);
    return c.json(await interviewsOf(ctx, user.id));
  });

  r.get('/interviews/:id', async (c) => {
    const user = requireAccount(c);
    const row = await ownInterview(ctx, user.id, c.req.param('id'));
    return c.json(await interviewOf(ctx, row));
  });

  r.post('/interviews/:id/next', async (c) => {
    const user = requireAccount(c);
    const { from } = await parseBody(c, AdvanceInterviewRequest);
    return c.json(await advanceInterview(ctx, user.id, c.req.param('id'), from));
  });

  r.post('/interviews/:id/end', async (c) => {
    const user = requireAccount(c);
    return c.json(await endInterview(ctx, user.id, c.req.param('id')));
  });

  r.delete('/interviews/:id', async (c) => {
    const user = requireAccount(c);
    const id = c.req.param('id');
    await deleteInterview(ctx, user.id, id);
    const res: DeleteInterviewResponse = { interviewId: id };
    return c.json(res);
  });

  return r;
}
