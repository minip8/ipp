import type { Message, TimelineEvent } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { buildTranscript } from './transcript';

const T = '2026-01-01T12:00:00.000Z';
const message = (id: string, createdAt = T): Message => ({
  id,
  padId: 'p',
  role: 'candidate',
  userId: 'u',
  kind: 'chat',
  intent: null,
  via: 'text',
  text: id,
  createdAt,
});
const event = (id: string, e: TimelineEvent['event'], at = T): TimelineEvent => ({
  id,
  padId: 'p',
  at,
  event: e,
});

describe('the transcript', () => {
  it('orders by time; at the same moment an event first, but a game’s after the message', () => {
    const items = buildTranscript(
      [message('quote message'), message('later', '2026-01-01T12:00:01.000Z')],
      [
        event('q', { type: 'question', index: 1, total: 4 }),
        event('g', {
          type: 'game',
          index: 1,
          entry: { kind: 'quote', at: T, bid: 9.5, ask: 11.5, size: 1 },
        }),
      ],
    );
    expect(items.map((i) => i.key)).toEqual(['q', 'quote message', 'g', 'later']);
  });
});
