/**
 * A `ModelClient` for OpenAI-compatible Chat Completions APIs (OpenAI itself, Google Gemini's
 * OpenAI-compatible endpoint, OpenRouter), on plain `fetch`: no SDK, so nothing can read a key or
 * a base URL from the environment. The base URL is fixed per provider (providers.ts) and never
 * comes from a user.
 *
 * Same contract as the Anthropic client: every call streams, one overall deadline bounds the whole
 * response, the caller's signal aborts it, structured output is a strict JSON schema, and the
 * result carries usage in the same shape (cached prompt tokens as cache reads).
 */
import { z } from 'zod';
import {
  type KeyFailure,
  type ModelClient,
  ModelError,
  type ModelRequest,
  type ModelResponse,
  scrubSecrets,
} from './model';

/** What an HTTP error from a provider means. */
export interface HttpFailure {
  kind: 'transient' | 'permanent';
  /** The key (not the request) is the problem. */
  keyFailure?: KeyFailure;
  /** The model id is unknown, not available to this key, or cannot serve this request. */
  modelUnavailable?: boolean;
  /** Safe to log: no key, no request content. */
  message: string;
}

export interface ProviderError {
  message: string;
  code: string | null;
  type: string | null;
  /** Google's `status` (e.g. `RESOURCE_EXHAUSTED`) or a provider-specific reason. */
  status: string | null;
  reasons: string[];
  param: string | null;
}

/**
 * The error object of a JSON error body: `{error: {...}}` (OpenAI, OpenRouter), or the same
 * wrapped in an array (Google sometimes returns `[{error: {...}}]`).
 */
export function providerError(body: unknown): ProviderError {
  const root = Array.isArray(body) ? body[0] : body;
  const e = (root && typeof root === 'object' ? (root as { error?: unknown }).error : null) as
    | Record<string, unknown>
    | string
    | null
    | undefined;
  if (typeof e === 'string')
    return { message: e, code: null, type: null, status: null, reasons: [], param: null };
  const str = (v: unknown) =>
    typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
  const details = Array.isArray(e?.details) ? (e.details as Record<string, unknown>[]) : [];
  return {
    message: str(e?.message) ?? '',
    code: str(e?.code),
    type: str(e?.type),
    status: str(e?.status),
    reasons: details.map((d) => str(d?.reason)).filter((x): x is string => !!x),
    param: str(e?.param),
  };
}

export type HttpClassifier = (status: number, error: ProviderError) => HttpFailure;

/** Shared defaults: 408/409/5xx are worth retrying; other 4xx are not. */
export function genericHttpFailure(status: number, error: ProviderError): HttpFailure {
  const text = `${error.message}`.slice(0, 300);
  if (status === 408 || status === 409 || status >= 500)
    return { kind: 'transient', message: `server error ${status}` };
  // A parameter this model does not take (e.g. reasoning effort, JSON schema output): the
  // request is fine for other models, so a chosen model falls back to the default.
  if (status === 400 && /unsupported|not supported|does not support|invalid model/i.test(text))
    return { kind: 'permanent', modelUnavailable: true, message: `api error 400: ${text}` };
  return { kind: 'permanent', message: `api error ${status}: ${text}` };
}

export interface OpenAICompatOptions {
  baseURL: string;
  classify: HttpClassifier;
  /** How reasoning effort is sent: OpenAI/Gemini `reasoning_effort`, OpenRouter `reasoning`. */
  effortParam: 'reasoning_effort' | 'reasoning' | 'none';
  fetch?: typeof fetch;
  /** Retries for transient failures before any output arrived. */
  maxRetries?: number;
  extraHeaders?: Record<string, string>;
  /** Role for operator text: OpenAI's reasoning models take `developer` in place of `system`. */
  systemRole?: 'system' | 'developer';
  /** Provider-specific body fields (merged last). */
  extraBody?: Record<string, unknown>;
  /**
   * The output-token cap's name: OpenAI wants `max_completion_tokens` (its `max_tokens` is
   * deprecated and refused by reasoning models); others document `max_tokens`.
   */
  tokenParam?: 'max_completion_tokens' | 'max_tokens';
}

type ChatMessage = { role: 'system' | 'developer' | 'user' | 'assistant'; content: string };

/** Anthropic-shaped request content (strings or text blocks) as plain text. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((b) =>
        b && typeof b === 'object' && (b as { type?: string }).type === 'text'
          ? String((b as { text?: unknown }).text ?? '')
          : '',
      )
      .join('');
  return '';
}

/**
 * The prompt as Chat Completions messages: the system blocks become one leading system message;
 * mid-conversation system messages (the operator channel) stay system messages in place.
 */
export function toChatMessages(
  req: Pick<ModelRequest, 'system' | 'messages'>,
  systemRole: 'system' | 'developer' = 'system',
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const system = req.system
    .map((b) => b.text)
    .filter(Boolean)
    .join('\n\n');
  if (system) out.push({ role: systemRole, content: system });
  for (const m of req.messages) {
    const role = (m as { role: string }).role;
    const content = textOf(m.content);
    if (role === 'system') out.push({ role: systemRole, content });
    else if (role === 'user' || role === 'assistant') out.push({ role, content });
  }
  return out;
}

/**
 * A strict-mode JSON schema from a Zod schema: every object closed and every property required
 * (what OpenAI's strict structured outputs demand), no `$schema`, no integer range noise.
 */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$schema') continue;
      if ((k === 'minimum' || k === 'maximum') && Math.abs(Number(v)) >= Number.MAX_SAFE_INTEGER)
        continue;
      out[k] = walk(v);
    }
    if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as object);
    }
    return out;
  };
  return walk(raw) as Record<string, unknown>;
}

interface Chunk {
  model?: string;
  choices?: {
    delta?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  } | null;
  error?: unknown;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export class OpenAICompatModelClient implements ModelClient {
  private readonly fetch: typeof fetch;
  /** Set when this model refused the effort parameter once; later calls leave it out. */
  private effortUnsupported = false;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly opts: OpenAICompatOptions,
  ) {
    if (typeof apiKey !== 'string' || apiKey.trim() === '')
      throw new ModelError('permanent', 'no API key given', undefined, 'invalid');
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  /** The request body (exported shape for tests through `call`). */
  private body(req: ModelRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toChatMessages(req, this.opts.systemRole),
      stream: true,
      stream_options: { include_usage: true },
      [this.opts.tokenParam ?? 'max_tokens']: req.maxTokens,
    };
    if (!this.effortUnsupported) {
      if (this.opts.effortParam === 'reasoning_effort') body.reasoning_effort = req.effort;
      else if (this.opts.effortParam === 'reasoning') body.reasoning = { effort: req.effort };
    }
    if (req.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: `${req.purpose}_output`,
          strict: true,
          schema: strictJsonSchema(req.schema),
        },
      };
    }
    return { ...body, ...this.opts.extraBody };
  }

  async call(req: ModelRequest): Promise<ModelResponse> {
    const started = performance.now();
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
      return await this.attempt(req, controller.signal, started);
    } catch (err) {
      if (err instanceof ModelError && err.kind !== 'aborted') throw err;
      if (timedOut) throw new ModelError('transient', `timed out after ${req.timeoutMs} ms`);
      if (req.signal?.aborted) throw new ModelError('aborted', 'aborted');
      if (err instanceof ModelError) throw err;
      throw new ModelError(
        'transient',
        `connection error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(deadline);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async attempt(
    req: ModelRequest,
    signal: AbortSignal,
    started: number,
  ): Promise<ModelResponse> {
    const maxRetries = this.opts.maxRetries ?? 2;
    let effortRetried = false;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetch(`${this.opts.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            authorization: `Bearer ${this.apiKey}`,
            ...this.opts.extraHeaders,
          },
          body: JSON.stringify(this.body(req)),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw err;
        if (attempt < maxRetries) {
          await sleep(500 * 2 ** attempt, signal);
          continue;
        }
        throw err;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { error: { message: text.slice(0, 300) } };
        }
        const pe = providerError(parsed);
        // A model that takes no reasoning effort (older chat models): drop it and try again.
        if (
          res.status === 400 &&
          !effortRetried &&
          this.opts.effortParam !== 'none' &&
          !this.effortUnsupported &&
          /reasoning/i.test(`${pe.param ?? ''} ${pe.message}`)
        ) {
          this.effortUnsupported = true;
          effortRetried = true;
          attempt--;
          continue;
        }
        const f = this.opts.classify(res.status, pe);
        if (f.kind === 'transient' && !f.keyFailure && attempt < maxRetries) {
          await sleep(500 * 2 ** attempt, signal);
          continue;
        }
        throw new ModelError(
          f.kind,
          f.keyFailure && f.keyFailure !== 'rate_limited'
            ? `key refused (${f.keyFailure}, ${res.status})`
            : f.message,
          res.status,
          f.keyFailure,
          f.modelUnavailable,
        );
      }
      return this.read(res, req, started);
    }
  }

  private async read(res: Response, req: ModelRequest, started: number): Promise<ModelResponse> {
    if (!res.body) throw new ModelError('transient', 'empty response');
    let ttft: number | null = null;
    let text = '';
    let refusal = '';
    let stopReason: string | null = null;
    let model = this.model;
    let usage: Chunk['usage'] = null;
    const decoder = new TextDecoder();
    let buffer = '';
    const handle = (data: string) => {
      if (data === '[DONE]') return;
      let chunk: Chunk;
      try {
        chunk = JSON.parse(data) as Chunk;
      } catch {
        return;
      }
      if (chunk.error) {
        const pe = providerError(chunk);
        throw new ModelError(
          'transient',
          scrubSecrets(`stream error: ${pe.message.slice(0, 300)}`),
        );
      }
      if (chunk.model) model = chunk.model;
      if (chunk.usage) usage = chunk.usage;
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta?.content;
        if (delta) {
          if (ttft === null) ttft = performance.now() - started;
          text += delta;
          req.onText?.(delta);
        }
        if (choice.delta?.refusal) refusal += choice.delta.refusal;
        if (choice.finish_reason) stopReason = choice.finish_reason;
      }
    };
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) handle(line.slice(5).trim());
        nl = buffer.indexOf('\n');
      }
    }
    if (buffer.startsWith('data:')) handle(buffer.slice(5).trim());
    const u = usage as Chunk['usage'];
    const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
    const refused = refusal.length > 0 || stopReason === 'content_filter';
    return {
      text,
      stopReason: refused ? 'refusal' : stopReason,
      refused,
      model,
      usage: {
        inputTokens: Math.max(0, (u?.prompt_tokens ?? 0) - cached),
        outputTokens: u?.completion_tokens ?? 0,
        cacheReadInputTokens: cached,
        cacheCreationInputTokens: 0,
      },
      latencyMs: performance.now() - started,
      ttftMs: ttft,
      fallback: false,
    };
  }
}
