/**
 * Just enough of the Hocuspocus / y-protocols wire format to police incoming messages before
 * Hocuspocus handles them: every message starts with the document name (varString) and a message
 * type (varUint); sync messages carry a sub-type, awareness messages a list of client states.
 */

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  varUint(): number {
    let n = 0;
    let mult = 1;
    for (let i = 0; i < 8; i++) {
      if (this.pos >= this.buf.length) throw new RangeError('truncated');
      const b = this.buf[this.pos++] as number;
      n += (b & 0x7f) * mult;
      if (b < 0x80) return n;
      mult *= 128;
    }
    throw new RangeError('varUint too long');
  }
  bytes(): Uint8Array {
    const len = this.varUint();
    if (this.pos + len > this.buf.length) throw new RangeError('truncated');
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  string(): string {
    return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes());
  }
}

export interface MessageHead {
  documentName: string;
  type: number;
  /** Sync sub-type, when type is MSG_SYNC. */
  syncType: number | null;
}

/** Null when the message is malformed. */
export function readHead(data: Uint8Array): MessageHead | null {
  try {
    const r = new Reader(data);
    const documentName = r.string();
    const type = r.varUint();
    const syncType = type === MSG_SYNC ? r.varUint() : null;
    return { documentName, type, syncType };
  } catch {
    return null;
  }
}

/** Does this message write to the document? (SyncStep2 or Update.) */
export function isDocWrite(h: MessageHead): boolean {
  return h.type === MSG_SYNC && (h.syncType === SYNC_STEP2 || h.syncType === SYNC_UPDATE);
}

export interface AwarenessEntry {
  clientID: number;
  clock: number;
  /** Parsed JSON; null is a removal. */
  state: unknown;
}

/** The client states in an awareness message. Null when malformed. */
export function readAwarenessStates(data: Uint8Array): AwarenessEntry[] | null {
  try {
    const r = new Reader(data);
    r.string();
    if (r.varUint() !== MSG_AWARENESS) return null;
    const update = new Reader(r.bytes());
    const n = update.varUint();
    const states: AwarenessEntry[] = [];
    for (let i = 0; i < n; i++) {
      const clientID = update.varUint();
      const clock = update.varUint();
      states.push({ clientID, clock, state: JSON.parse(update.string()) });
    }
    return states;
  } catch {
    return null;
  }
}

/** Raw ws message data as one Uint8Array. */
export function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}
