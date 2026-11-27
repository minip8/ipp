/**
 * Saved interview plans (@ipp/contracts `interview.ts` has the route table): accounts only, and
 * only the owner (anyone else's is 404). The work is in `interviews/templates.ts`.
 */
import {
  type DeleteInterviewTemplateResponse,
  SaveInterviewTemplateRequest,
  UpdateInterviewTemplateRequest,
} from '@ipp/contracts';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireAccount } from '../http/app';
import {
  deleteTemplate,
  saveTemplate,
  templatesOf,
  templateWriteLimit,
  updateTemplate,
} from '../interviews/templates';

export function interviewTemplateRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.get('/interview-templates', async (c) => {
    const user = requireAccount(c);
    return c.json(await templatesOf(ctx, user.id));
  });

  r.post('/interview-templates', async (c) => {
    const user = requireAccount(c);
    await templateWriteLimit(ctx, user.id);
    const body = await parseBody(c, SaveInterviewTemplateRequest);
    return c.json(await saveTemplate(ctx, user.id, body));
  });

  r.put('/interview-templates/:id', async (c) => {
    const user = requireAccount(c);
    await templateWriteLimit(ctx, user.id);
    const body = await parseBody(c, UpdateInterviewTemplateRequest);
    return c.json(await updateTemplate(ctx, user.id, c.req.param('id'), body));
  });

  r.delete('/interview-templates/:id', async (c) => {
    const user = requireAccount(c);
    await templateWriteLimit(ctx, user.id);
    const id = c.req.param('id');
    await deleteTemplate(ctx, user.id, id);
    const res: DeleteInterviewTemplateResponse = { templateId: id };
    return c.json(res);
  });

  return r;
}
