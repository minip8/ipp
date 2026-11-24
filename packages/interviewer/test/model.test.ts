import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicModelClient, ModelError } from '../src/model';

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function serve(
  handler: (req: IncomingMessage, body: string, res: ServerResponse) => void,
): Promise<string> {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  const address = server?.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function sse(res: ServerResponse, text: string, stopReason = 'end_turn') {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type: string, data: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', {
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 11,
        output_tokens: 1,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 30,
      },
    },
  });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  for (const part of text.match(/.{1,5}/gs) ?? [])
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: part } });
  ev('content_block_stop', { index: 0 });
  ev('message_delta', {
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 7 },
  });
  ev('message_stop', {});
  res.end();
}

const request = (extra: Partial<Parameters<AnthropicModelClient['call']>[0]> = {}) => ({
  purpose: 'decision' as const,
  system: [{ type: 'text' as const, text: 'sys', cache_control: { type: 'ephemeral' as const } }],
  messages: [
    { role: 'user' as const, content: 'data' },
    { role: 'system' as const, content: 'task' },
  ],
  effort: 'low' as const,
  maxTokens: 1000,
  timeoutMs: 5000,
  ...extra,
});

describe('AnthropicModelClient', () => {
  it('sends adaptive thinking, explicit effort, fallbacks, structured output; streams text and reads usage', async () => {
    let seen: { headers: IncomingMessage['headers']; body: Record<string, unknown> } | null = null;
    const url = await serve((req, body, res) => {
      seen = { headers: req.headers, body: JSON.parse(body) };
      sse(res, '{"ok":true}');
    });
    const client = new AnthropicModelClient('test-key', 'claude-opus-5-5', {
      baseURL: url,
      maxRetries: 0,
    });
    const deltas: string[] = [];
    const res = await client.call(
      request({ schema: z.object({ ok: z.boolean() }), onText: (d) => deltas.push(d) }),
    );
    expect(res.text).toBe('{"ok":true}');
    expect(deltas.join('')).toBe('{"ok":true}');
    expect(res.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadInputTokens: 2000,
      cacheCreationInputTokens: 30,
    });
    expect(res.refused).toBe(false);
    const body = (seen as unknown as { body: Record<string, unknown> }).body;
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.fallbacks).toBe('default');
    expect(body.stream).toBe(true);
    expect((body.output_config as { effort: string }).effort).toBe('low');
    expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect((body.messages as { role: string }[]).map((m) => m.role)).toEqual(['user', 'system']);
    expect(
      String(
        (seen as unknown as { headers: IncomingMessage['headers'] }).headers['anthropic-beta'],
      ),
    ).toContain('server-side-fallback-2026-07-01');
  });

  it('reports refusals', async () => {
    const url = await serve((_r, _b, res) => sse(res, '', 'refusal'));
    const client = new AnthropicModelClient('k', 'm', { baseURL: url, maxRetries: 0 });
    expect((await client.call(request())).refused).toBe(true);
  });

  it('classifies 429 as transient and 400 as permanent', async () => {
    let status = 429;
    const url = await serve((_r, _b, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: {
            type: status === 429 ? 'rate_limit_error' : 'invalid_request_error',
            message: 'nope',
          },
        }),
      );
    });
    const client = new AnthropicModelClient('k', 'm', { baseURL: url, maxRetries: 0 });
    await expect(client.call(request())).rejects.toMatchObject({ kind: 'transient', status: 429 });
    status = 400;
    await expect(client.call(request())).rejects.toMatchObject({ kind: 'permanent', status: 400 });
  });

  it('enforces an overall deadline on a stalled stream', async () => {
    const url = await serve((_r, _b, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': keep-alive\n\n'); // headers sent, then nothing
    });
    const client = new AnthropicModelClient('k', 'm', { baseURL: url, maxRetries: 0 });
    const err = await client.call(request({ timeoutMs: 300 })).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.kind).toBe('transient');
  });

  it('an external abort is reported as aborted', async () => {
    const url = await serve((_r, _b, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': keep-alive\n\n');
    });
    const client = new AnthropicModelClient('k', 'm', { baseURL: url, maxRetries: 0 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const err = await client.call(request({ signal: ac.signal })).catch((e) => e);
    expect(err).toMatchObject({ kind: 'aborted' });
  });
});
