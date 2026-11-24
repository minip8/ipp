/** Single-use WebSocket tickets: 30 s, stored in Redis, bound to a user and a pad. */
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

export const TICKET_TTL_SEC = 30;

export interface TicketClaims {
  userId: string;
  padId: string;
}

export class Tickets {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly ttlSec = TICKET_TTL_SEC,
  ) {}

  private key(ticket: string) {
    return `${this.prefix}wst:${ticket}`;
  }

  async issue(claims: TicketClaims): Promise<{ ticket: string; expiresInSec: number }> {
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.set(this.key(ticket), JSON.stringify(claims), 'EX', this.ttlSec);
    return { ticket, expiresInSec: this.ttlSec };
  }

  /** Atomically consumes the ticket. Null when unknown, expired or already used. */
  async redeem(ticket: string | null | undefined): Promise<TicketClaims | null> {
    if (!ticket || ticket.length > 100 || !/^[A-Za-z0-9_-]+$/.test(ticket)) return null;
    const raw = await this.redis.getdel(this.key(ticket));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TicketClaims;
    } catch {
      return null;
    }
  }
}
