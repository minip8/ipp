/**
 * Thin seam between the orchestrator and the Claude API so tests can use a fake.
 * Every call streams (time-to-first-token is measurable, no HTTP timeouts on long thinking),
 * uses adaptive thinking with an explicit effort, server-side refusal fallbacks, and
 * structured outputs when a schema is given.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { AiKeyProblem } from '@ipp/contracts';
import type { z } from 'zod';
import type { ModelUsage } from './types';

export type Purpose = ModelUsage['purpose'];
export type Effort = 'low' | 'medium' | 'high';

export interface ModelRequest {
  purpose: Purpose;
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  effort: Effort;
  maxTokens: number;
  /** Structured output; the response text is JSON matching it. */
  schema?: z.ZodType;
  timeoutMs: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}

export interface ModelResponse {
  text: string;
  stopReason: string | null;
  refused: boolean;
  model: string;
  usage: Omit<ModelUsage, 'purpose' | 'model'>;
  latencyMs: number;
  ttftMs: number | null;
  /** A fallback model served (part of) the response after a policy decline. */
  fallback: boolean;
}

export type ModelErrorKind = 'aborted' | 'transient' | 'permanent';

/**
 * A failure caused by the user's key rather than by the request: either Anthropic refuses the key
 * (an `AiKeyProblem`; retrying with the same key cannot help) or the key's account is being
 * rate limited (transient, but it affects every pad on that key).
 */
export type KeyFailure = AiKeyProblem | 'rate_limited';

/** Anthropic error messages never contain the key, but make sure nothing that looks like one is logged. */
export function scrubSecrets(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]*/g, 'sk-ant-[redacted]');
}

export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
    readonly status?: number,
    readonly keyFailure?: KeyFailure,
  ) {
    super(scrubSecrets(message));
    this.name = 'ModelError';
  }
}

export interface ModelClient {
  readonly model: string;
  call(req: ModelRequest): Promise<ModelResponse>;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** The `error` object of an Anthropic error body, when the SDK parsed one. */
function errorBody(err: InstanceType<typeof Anthropic.APIError>): {
  type?: string;
  message?: string;
  details?: { error_code?: string };
} {
  const body = (err as { error?: unknown }).error as { error?: unknown } | undefined;
  const inner = body && typeof body === 'object' ? body.error : undefined;
  return inner && typeof inner === 'object' ? (inner as never) : {};
}

/** Which key problem (if any) an API error means. Exported for tests. */
export function keyFailureOf(err: unknown): KeyFailure | undefined {
  if (!(err instanceof Anthropic.APIError)) return undefined;
  const body = errorBody(err);
  const message = `${body.message ?? ''} ${err.message}`;
  switch (err.status) {
    case 401:
      return 'invalid';
    case 402:
      return 'billing';
    case 403:
      return 'permission';
    case 404:
      // A model the key's organization cannot use is a 404 naming the model.
      return /\bmodel\b/i.test(message) ? 'permission' : undefined;
    case 400:
      return body.type === 'billing_error' || /credit balance/i.test(message)
        ? 'billing'
        : undefined;
    case 429:
      return body.details?.error_code === 'enforced_spend_limit_reached' ||
        /spend limit/i.test(message)
        ? 'spend_limit'
        : 'rate_limited';
    default:
      return undefined;
  }
}

export function classifyError(err: unknown): ModelError {
  if (err instanceof ModelError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ModelError('aborted', 'aborted');
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new ModelError('transient', 'timeout');
  if (err instanceof Anthropic.APIConnectionError)
    return new ModelError('transient', 'connection error');
  const keyFailure = keyFailureOf(err);
  if (keyFailure && keyFailure !== 'rate_limited') {
    const status = (err as { status?: number }).status;
    return new ModelError(
      'permanent',
      `key refused (${keyFailure}, ${status})`,
      status,
      keyFailure,
    );
  }
  if (err instanceof Anthropic.RateLimitError)
    return new ModelError('transient', 'rate limited', 429, 'rate_limited');
  if (err instanceof Anthropic.InternalServerError)
    return new ModelError('transient', `server error ${err.status}`, err.status);
  if (err instanceof Anthropic.APIError) {
    // 400/401/403/404/413: retrying the same request will not help.
    const status = typeof err.status === 'number' ? err.status : undefined;
    return new ModelError(
      status === 408 || status === 409 ? 'transient' : 'permanent',
      `api error ${status ?? '?'}: ${err.message}`,
      status,
    );
  }
  if (err instanceof Error && err.name === 'AbortError')
    return new ModelError('aborted', 'aborted');
  return new ModelError('transient', err instanceof Error ? err.message : String(err));
}

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    opts: { maxRetries?: number; baseURL?: string; fetch?: typeof fetch } = {},
  ) {
    this.client = anthropicClient(apiKey, opts);
  }

  async call(req: ModelRequest): Promise<ModelResponse> {
    const started = performance.now();
    let ttft: number | null = null;
    const format = req.schema ? betaZodOutputFormat(req.schema as never) : undefined;
    // One overall deadline for the whole streamed response (the SDK timeout alone does not
    // bound a slow stream), combined with the caller's abort signal.
    const controller = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs);
    const onAbort = () => controller.abort();
    if (req.signal?.aborted) controller.abort();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: req.effort,
            ...(format ? { format: { type: 'json_schema' as const, schema: format.schema } } : {}),
          },
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
        },
        { signal: controller.signal, timeout: req.timeoutMs },
      );
      stream.on('text', (delta) => {
        if (ttft === null) ttft = performance.now() - started;
        req.onText?.(delta);
      });
      const msg = await stream.finalMessage();
      const text = msg.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const fallback =
        msg.content.some((b) => (b as { type: string }).type === 'fallback') ||
        (msg.usage.iterations ?? []).some(
          (it) => (it as { type: string }).type === 'fallback_message',
        );
      return {
        text,
        stopReason: msg.stop_reason,
        refused: msg.stop_reason === 'refusal',
        model: msg.model,
        usage: {
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
          cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? 0,
        },
        latencyMs: performance.now() - started,
        ttftMs: ttft,
        fallback,
      };
    } catch (err) {
      if (timedOut) throw new ModelError('transient', `timed out after ${req.timeoutMs} ms`);
      throw classifyError(err);
    } finally {
      clearTimeout(deadline);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * The only place an SDK client is constructed. The key must be passed explicitly: with an empty
 * key the SDK would fall back to ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from the environment,
 * which would make the operator pay for a user's interview.
 */
export function anthropicClient(
  apiKey: string,
  opts: { maxRetries?: number; baseURL?: string; fetch?: typeof fetch } = {},
): Anthropic {
  if (typeof apiKey !== 'string' || apiKey.trim() === '')
    throw new ModelError('permanent', 'no API key given', undefined, 'invalid');
  return new Anthropic({
    apiKey,
    maxRetries: opts.maxRetries ?? 2,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

export type VerifyResult =
  | { ok: true }
  /** Anthropic refused the key. */
  | { ok: false; problem: AiKeyProblem }
  /** Anthropic could not be asked (network, overload, rate limit): try again later. */
  | { ok: false; problem: 'unverifiable' };

/**
 * One cheap real call with the key: a one-token message to the interviewer's model. It proves
 * the key authenticates, can use that model and has credit, for a fraction of a cent.
 */
export async function verifyApiKey(
  apiKey: string,
  model: string,
  opts: { baseURL?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<VerifyResult> {
  const client = anthropicClient(apiKey, { maxRetries: 0, ...opts });
  try {
    await client.messages.create(
      {
        model,
        max_tokens: 16,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      },
      { timeout: opts.timeoutMs ?? 20_000 },
    );
    return { ok: true };
  } catch (err) {
    const failure = keyFailureOf(err);
    if (failure && failure !== 'rate_limited') return { ok: false, problem: failure };
    return { ok: false, problem: 'unverifiable' };
  }
}
