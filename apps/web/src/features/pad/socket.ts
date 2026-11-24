/**
 * The pad event channel (docs/ARCHITECTURE.md §5): one WebSocket per open pad, authenticated by
 * a single-use ticket fetched right before each (re)connect. Reconnects with capped exponential
 * backoff, keeps the connection alive with ping/pong, and queues chat messages while offline.
 */
import { type ClientEvent, ServerEvent } from '@ipp/contracts';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'offline';

type WsLike = {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type PadSocketOptions = {
  url: (ticket: string) => string;
  getTicket: () => Promise<string>;
  onEvent: (ev: ServerEvent) => void;
  onStatus: (s: SocketStatus, detail?: { retryInMs?: number; reason?: string }) => void;
  /**
   * Called when a ticket request fails with a permanent error (401/403/404), with that error, or
   * when the server closes with 4403/4404 (e.g. the pad was deleted), with a `SocketRefused`.
   */
  onFatal?: (err: unknown) => void;
  isFatal?: (err: unknown) => boolean;
  WebSocketImpl?: new (url: string) => WsLike;
  pingMs?: number;
  /** Reconnect if nothing at all is received for this long. */
  silenceMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
};

const OPEN = 1;

/** The server closed the channel for good: 4403 no longer a member, 4404 the pad is gone. */
export class SocketRefused extends Error {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super(reason || `closed with ${code}`);
    this.name = 'SocketRefused';
  }
}

export class PadSocket {
  private ws: WsLike | null = null;
  private attempt = 0;
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private queue: ClientEvent[] = [];
  private status: SocketStatus = 'connecting';
  private readonly o: Required<Omit<PadSocketOptions, 'onFatal' | 'isFatal'>> &
    Pick<PadSocketOptions, 'onFatal' | 'isFatal'>;

  constructor(opts: PadSocketOptions) {
    this.o = {
      WebSocketImpl: globalThis.WebSocket as unknown as new (url: string) => WsLike,
      pingMs: 25_000,
      silenceMs: 65_000,
      baseDelayMs: 500,
      maxDelayMs: 15_000,
      random: Math.random,
      ...opts,
    };
  }

  get currentStatus() {
    return this.status;
  }

  connect() {
    this.closed = false;
    void this.open();
  }

  private setStatus(s: SocketStatus, detail?: { retryInMs?: number; reason?: string }) {
    this.status = s;
    this.o.onStatus(s, detail);
  }

  private async open() {
    if (this.closed) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ticket: string;
    try {
      ticket = await this.o.getTicket();
    } catch (err) {
      if (this.o.isFatal?.(err)) {
        this.closed = true;
        this.setStatus('offline', { reason: 'denied' });
        this.o.onFatal?.(err);
        return;
      }
      this.scheduleRetry();
      return;
    }
    if (this.closed) return;
    let ws: WsLike;
    try {
      ws = new this.o.WebSocketImpl(this.o.url(ticket));
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.setStatus('open');
      this.startPing();
      const queued = this.queue;
      this.queue = [];
      for (const ev of queued) this.send(ev);
    };
    ws.onmessage = (msg) => {
      this.lastMessageAt = Date.now();
      let json: unknown;
      try {
        json = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      const parsed = ServerEvent.safeParse(json);
      if (parsed.success) this.o.onEvent(parsed.data);
      else console.warn('Ignoring unknown pad event', json);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => {
      this.stopPing();
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      // 4401/4403/4404: the server refused this user or pad; do not hammer it.
      if (ev.code === 4403 || ev.code === 4404) {
        this.closed = true;
        this.setStatus('offline', { reason: 'denied' });
        this.o.onFatal?.(new SocketRefused(ev.code, ev.reason));
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.closed) return;
    const exp = Math.min(this.o.maxDelayMs, this.o.baseDelayMs * 2 ** this.attempt);
    const delay = Math.round(exp / 2 + (this.o.random() * exp) / 2);
    this.attempt++;
    this.setStatus('reconnecting', { retryInMs: delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, delay);
  }

  /** Reconnect now (e.g. the browser came back online or the user clicked retry). */
  retryNow() {
    if (this.status === 'open') return;
    this.closed = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.ws) return;
    void this.open();
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > this.o.silenceMs) {
        this.ws?.close(4000, 'silent');
        return;
      }
      this.send({ type: 'ping' });
    }, this.o.pingMs);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /**
   * Sends an event. Chat is queued while disconnected and flushed on reconnect (returns 'queued');
   * telemetry and other events are dropped (returns false).
   */
  send(ev: ClientEvent): true | 'queued' | false {
    if (this.ws && this.ws.readyState === OPEN) {
      this.ws.send(JSON.stringify(ev));
      return true;
    }
    if (ev.type === 'chat.send' && this.queue.length < 20) {
      this.queue.push(ev);
      return 'queued';
    }
    return false;
  }

  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopPing();
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }
}
