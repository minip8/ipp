/**
 * The signed-in user's own Anthropic API key. No endpoint ever returns the key; status shows at
 * most its last four characters. Saving checks the key with one real call to Anthropic first.
 */
import {
  AI_KEY_ERROR_CODES,
  type AiKeyProblem,
  type AiKeyStatus,
  SaveAiKeyRequest,
} from '@ipp/contracts';
import { Hono } from 'hono';
import type { Ctx } from '../context';
import { type Env, parseBody, requireUser } from '../http/app';
import { HttpError, rateLimited, unavailable } from '../http/errors';

export const REJECTED_MESSAGES: Record<AiKeyProblem, string> = {
  invalid:
    'Anthropic did not accept this key. Check that you copied all of it and that it has not been revoked.',
  permission:
    'This key cannot use the model the interviewer runs on. Check the key’s workspace and model access in the Anthropic Console.',
  billing:
    'Anthropic accepted the key but its account has no credit. Add credit in the Anthropic Console, then save the key again.',
  spend_limit:
    'This key’s account has reached its monthly spend limit. Raise the limit in the Anthropic Console, then save the key again.',
};

export function aiKeyRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  const status = async (userId: string): Promise<AiKeyStatus> => ({
    ...(await ctx.aiKeys.status(userId)),
    model: ctx.config.interviewerModel,
    ttlHours: ctx.config.aiKeyTtlHours,
  });

  r.get('/ai-key', async (c) => {
    const user = requireUser(c);
    return c.json(await status(user.id));
  });

  r.put('/ai-key', async (c) => {
    const user = requireUser(c);
    // Malformed input is refused without calling Anthropic, so it does not use up an attempt.
    const { apiKey } = await parseBody(c, SaveAiKeyRequest);
    const l = ctx.config.limits.aiKeySave;
    const ip = c.get('ip');
    const wait = await ctx.limiter.hit([
      { key: `aikey:u:${user.id}:burst`, ...l.userBurst },
      { key: `aikey:u:${user.id}:day`, ...l.userDaily },
      { key: `aikey:ip:${ip}:burst`, ...l.ipBurst },
      { key: `aikey:ip:${ip}:day`, ...l.ipDaily },
    ]);
    if (wait > 0)
      throw rateLimited(wait, 'rate_limited', 'Too many attempts to save a key. Try again later.');

    let verdict: Awaited<ReturnType<Ctx['verifyAiKey']>>;
    try {
      verdict = await ctx.verifyAiKey(apiKey);
    } catch {
      verdict = { ok: false, problem: 'unverifiable' };
    }
    if (!verdict.ok) {
      ctx.log.info({ userId: user.id, problem: verdict.problem }, 'AI key not saved');
      if (verdict.problem === 'unverifiable')
        throw unavailable(
          AI_KEY_ERROR_CODES.unverifiable,
          'Anthropic could not be reached to check the key, so nothing was saved. Try again in a minute.',
        );
      throw new HttpError(422, AI_KEY_ERROR_CODES.rejected, REJECTED_MESSAGES[verdict.problem]);
    }
    await ctx.aiKeys.save(user.id, apiKey);
    ctx.log.info({ userId: user.id }, 'AI key saved');
    await ctx.ai
      .keyChanged(user.id)
      .catch((err) => ctx.log.warn({ err: String(err) }, 'key change broadcast failed'));
    return c.json(await status(user.id));
  });

  r.delete('/ai-key', async (c) => {
    const user = requireUser(c);
    if (await ctx.aiKeys.delete(user.id)) {
      ctx.log.info({ userId: user.id }, 'AI key deleted');
      await ctx.ai
        .keyChanged(user.id)
        .catch((err) => ctx.log.warn({ err: String(err) }, 'key change broadcast failed'));
    }
    return c.json(await status(user.id));
  });

  return r;
}
