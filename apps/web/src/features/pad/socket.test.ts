import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PadSocket, SocketRefused, type SocketStatus } from './socket';

class FakeWs {
  static instances: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWs.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
}

const flush = () => new Promise((r) => setImmediate(r));

describe('PadSocket', () => {
  beforeEach(() => {
    FakeWs.instances = [];
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
    });
  });
  afterEach(() => vi.useRealTimers());

  function make(over: Partial<ConstructorParameters<typeof PadSocket>[0]> = {}) {
    const statuses: SocketStatus[] = [];
    const events: unknown[] = [];
    let n = 0;
    const s = new PadSocket({
      url: (t) => `ws://x/ws/pads/p?ticket=${t}`,
      getTicket: async () => `t${++n}`,
      onEvent: (e) => events.push(e),
      onStatus: (st) => statuses.push(st),
      WebSocketImpl: FakeWs,
      random: () => 1,
      ...over,
    });
    return { s, statuses, events };
  }

  it('connects with a fresh ticket and parses events', async () => {
    const { s, statuses, events } = make();
    s.connect();
    await flush();
    const ws = FakeWs.instances[0];
    expect(ws?.url).toBe('ws://x/ws/pads/p?ticket=t1');
    ws?.open();
    ws?.onmessage?.({ data: JSON.stringify({ type: 'interviewer.thinking', active: true }) });
    ws?.onmessage?.({ data: JSON.stringify({ type: 'nonsense' }) });
    expect(events).toEqual([{ type: 'interviewer.thinking', active: true }]);
    expect(statuses).toEqual(['connecting', 'open']);
    s.close();
  });

  it('reconnects with backoff and a new ticket, flushing queued chat', async () => {
    const { s, statuses } = make();
    s.connect();
    await flush();
    FakeWs.instances[0]?.open();
    FakeWs.instances[0]?.close(1006);
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(s.send({ type: 'chat.send', text: 'hello', via: 'text' })).toBe('queued');
    expect(s.send({ type: 'telemetry', kind: 'blur', ms: 3000 })).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    const ws2 = FakeWs.instances[1];
    expect(ws2?.url).toContain('ticket=t2');
    ws2?.open();
    expect(ws2?.sent.map((d) => JSON.parse(d).type)).toEqual(['chat.send']);
    s.close();
  });

  it('grows the delay exponentially up to the cap', async () => {
    const delays: number[] = [];
    const { s } = make({
      onStatus: (_st, d) => d?.retryInMs && delays.push(d.retryInMs),
      getTicket: async () => Promise.reject(new Error('down')),
      maxDelayMs: 4000,
    });
    s.connect();
    for (let i = 0; i < 5; i++) {
      await flush();
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(delays.slice(0, 5)).toEqual([500, 1000, 2000, 4000, 4000]);
    s.close();
  });

  it('stops for good on a fatal ticket error', async () => {
    const fatal = vi.fn();
    const { s, statuses } = make({
      getTicket: async () => Promise.reject(new Error('403')),
      isFatal: () => true,
      onFatal: fatal,
    });
    s.connect();
    await flush();
    expect(statuses.at(-1)).toBe('offline');
    expect(fatal).toHaveBeenCalled();
  });

  it('stops for good when the server refuses the pad (4404: deleted)', async () => {
    const fatal = vi.fn();
    const { s, statuses } = make({ onFatal: fatal });
    s.connect();
    await flush();
    FakeWs.instances[0]?.open();
    FakeWs.instances[0]?.close(4404);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statuses.at(-1)).toBe('offline');
    expect(FakeWs.instances).toHaveLength(1);
    expect(fatal).toHaveBeenCalledWith(expect.any(SocketRefused));
    expect(fatal.mock.calls[0]?.[0].code).toBe(4404);
  });

  it('pings and reconnects when the server goes silent', async () => {
    const { s } = make({ pingMs: 1000, silenceMs: 2500 });
    s.connect();
    await flush();
    const ws = FakeWs.instances[0];
    ws?.open();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ws?.sent.map((d) => JSON.parse(d).type)).toContain('ping');
    await vi.advanceTimersByTimeAsync(2000);
    expect(ws?.readyState).toBe(3);
    s.close();
  });
});
