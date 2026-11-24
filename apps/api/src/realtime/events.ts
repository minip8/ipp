/**
 * Pad event channel: /ws/pads/:padId?ticket=  (ServerEvent / ClientEvent, JSON text frames).
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { CAPS, ClientEvent, type Language, type ServerEvent } from '@ipp/contracts';
import { messages, padMembers, pads, timelineEvents } from '@ipp/db';
import { and, eq, isNull } from '@ipp/db/orm';
import { WebSocket, WebSocketServer } from 'ws';
import type { Ctx } from '../context';
import { changeLanguage } from '../pads/service';
import { messageView } from '../views';
import type { RoomClient } from './rooms';

const MAX_FRAME_BYTES = 64 * 1024;

export class EventsGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private heartbeat: NodeJS.Timeout;

  constructor(private readonly ctx: Ctx) {
    // Drop sockets that stop answering protocol-level pings.
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        const w = ws as WebSocket & { alive?: boolean };
        if (w.alive === false) {
          w.terminate();
          continue;
        }
        w.alive = false;
        w.ping();
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  async handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    padId: string,
    ticket: string | null,
  ) {
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    const claims = await this.ctx.tickets.redeem(ticket);
    if (!claims || claims.padId !== padId) return reject(401, 'Unauthorized');
    const [member] = await this.ctx.db
      .select({ role: padMembers.role })
      .from(padMembers)
      .where(and(eq(padMembers.padId, padId), eq(padMembers.userId, claims.userId)));
    if (!member) return reject(403, 'Forbidden');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, padId, claims.userId));
  }

  private onConnection(ws: WebSocket, padId: string, userId: string): void {
    const { ctx } = this;
    const client: RoomClient = {
      userId,
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      },
      close: (code, reason) => ws.close(code, reason),
    };
    const w = ws as WebSocket & { alive?: boolean };
    w.alive = true;
    ws.on('pong', () => {
      w.alive = true;
    });
    ctx.rooms.join(padId, client);
    ws.on('close', () => {
      ctx.rooms.leave(padId, client);
      if (ctx.rooms.count(padId) === 0 && ctx.collab.connectionCount(padId) === 0)
        ctx.ai.release(padId);
    });
    ws.on('error', () => {});
    // Serialize this socket's events so chat order is preserved.
    let chain = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      chain = chain.then(() =>
        this.onMessage(client, padId, userId, isBinary ? null : data.toString()).catch((err) => {
          ctx.log.error({ err, padId }, 'event handling failed');
          send(client, { type: 'error', code: 'internal', message: 'Something went wrong' });
        }),
      );
    });
    void this.maybeStartSession(padId);
  }

  /** session_started is sent once per pad, the first time anyone opens its event channel. */
  private async maybeStartSession(padId: string): Promise<void> {
    const updated = await this.ctx.db
      .update(pads)
      .set({ sessionStartedAt: new Date() })
      .where(and(eq(pads.id, padId), isNull(pads.sessionStartedAt), eq(pads.status, 'active')))
      .returning({ id: pads.id });
    if (updated.length) this.ctx.ai.trigger(padId, { type: 'session_started' });
  }

  private async onMessage(
    client: RoomClient,
    padId: string,
    userId: string,
    raw: string | null,
  ): Promise<void> {
    const { ctx } = this;
    if (raw === null)
      return send(client, { type: 'error', code: 'bad_event', message: 'Text frames only' });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return send(client, { type: 'error', code: 'bad_event', message: 'Invalid JSON' });
    }
    const parsed = ClientEvent.safeParse(json);
    if (!parsed.success)
      return send(client, {
        type: 'error',
        code: 'bad_event',
        message: 'Unknown or invalid event',
      });
    const ev = parsed.data;
    if (ev.type === 'ping') return send(client, { type: 'pong' });

    const [pad] = await ctx.db.select({ status: pads.status }).from(pads).where(eq(pads.id, padId));
    if (pad?.status !== 'active') {
      return send(client, { type: 'error', code: 'pad_ended', message: 'This pad has ended' });
    }
    if (ev.type === 'telemetry' || ev.type === 'language') {
      // Each one writes a timeline row (playback, interviewer context) and raises a trigger.
      const wait = await ctx.limiter.hit([
        { key: `padev:u:${userId}:${padId}`, ...ctx.config.limits.padEvents.userBurst },
      ]);
      if (wait > 0) {
        return send(client, {
          type: 'error',
          code: 'rate_limited',
          message: `Slow down; try again in ${wait}s`,
        });
      }
    }
    switch (ev.type) {
      case 'chat.send': {
        const text = ev.text.trim();
        if (!text) return;
        if (text.length > CAPS.chatChars) {
          return send(client, {
            type: 'error',
            code: 'too_long',
            message: `Messages are limited to ${CAPS.chatChars} characters`,
          });
        }
        const l = ctx.config.limits.chat;
        const wait = await ctx.limiter.hit([
          { key: `chat:u:${userId}:burst`, ...l.userBurst },
          { key: `chat:u:${userId}:day`, ...l.userDaily },
        ]);
        if (wait > 0) {
          return send(client, {
            type: 'error',
            code: 'rate_limited',
            message: `Slow down; try again in ${wait}s`,
          });
        }
        const [row] = await ctx.db
          .insert(messages)
          .values({
            padId,
            role: 'candidate',
            kind: 'chat',
            intent: null,
            text,
            via: ev.via,
            userId,
          })
          .returning();
        if (!row) return;
        ctx.rooms.broadcast(padId, { type: 'message.created', message: messageView(row) });
        ctx.ai.trigger(padId, { type: 'candidate_message', text, via: ev.via, userId });
        return;
      }
      case 'telemetry': {
        const chars = clampInt(ev.chars);
        const ms = clampInt(ev.ms);
        await ctx.db.insert(timelineEvents).values({
          padId,
          event:
            ev.kind === 'paste'
              ? { type: 'paste', chars: chars ?? 0 }
              : { type: 'blur', ms: ms ?? 0 },
        });
        ctx.ai.trigger(padId, {
          type: 'telemetry',
          kind: ev.kind,
          ...(chars !== undefined ? { chars } : {}),
          ...(ms !== undefined ? { ms } : {}),
        });
        return;
      }
      case 'language': {
        await changeLanguage(ctx, padId, ev.language as Language);
        return;
      }
    }
  }

  stop(): void {
    clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }
}

function send(client: RoomClient, event: ServerEvent): void {
  client.send(JSON.stringify(event));
}

function clampInt(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  return Math.max(0, Math.min(v, 10_000_000));
}
