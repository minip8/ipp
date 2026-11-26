/**
 * A round's message streamed before its step is taken: the step names the id the deltas went out
 * under, and the posted message takes it (`QuantStep.messageId`, `QuantEffects.say.messageId`).
 */
import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  createQuantRound,
  type QuantRoundState,
  type QuantRoundStep,
  quantRoundEndsAt,
  ServerEvent,
} from '../src';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const STREAMED = '22222222-2222-4222-8222-222222222222';

function round() {
  let state: QuantRoundState = createQuantRound(
    'trader',
    20,
    [0, 1, 2].map((i) => ({
      questionId: `q-${i}`,
      topic: 'probability',
      topicTitle: 'Probability',
      difficulty: 'easy' as const,
      prompt: `PROMPT-${i}`,
      unit: null,
      hintsAvailable: 1,
    })),
  );
  let version = 0;
  let ids = 0;
  return (step: QuantRoundStep) => {
    const out = advanceRound(state, step, {
      version,
      now: new Date(T0 + 60_000 * (version + 1)),
      roundEndsAt: quantRoundEndsAt(new Date(T0), 20),
      newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    });
    if (!out.ok) throw new Error(out.reason);
    state = out.state;
    version = out.version;
    return { effects: out.effects, version };
  };
}

describe('a streamed message in a round', () => {
  it('is posted under the id it was streamed under, for start, turn and close', () => {
    const step = round();
    const start = step({ type: 'start', version: 0, say: 'Hello.', messageId: STREAMED });
    expect(start.effects.say).toEqual({
      text: 'Hello.',
      kind: 'proactive',
      intent: 'greeting',
      messageId: STREAMED,
    });
    // The revealed question still gets its own id.
    expect(start.effects.reveal?.messageId).not.toBe(STREAMED);
    const base = { version: 1, index: 0, kind: 'chat' as const };
    const turn = step({
      ...base,
      type: 'turn',
      action: 'stay',
      say: 'Go on.',
      messageId: STREAMED,
    });
    expect(turn.effects.say?.messageId).toBe(STREAMED);
    const close = step({
      ...base,
      version: 2,
      type: 'close',
      by: 'interviewer',
      verdict: null,
      say: 'Right.',
      messageId: STREAMED,
    });
    expect(close.effects.say?.messageId).toBe(STREAMED);
  });

  it('has no id of its own when it was not streamed, or says nothing', () => {
    const step = round();
    expect(step({ type: 'start', version: 0, say: 'Hello.' }).effects.say).not.toHaveProperty(
      'messageId',
    );
    const silent = step({
      type: 'turn',
      version: 1,
      index: 0,
      kind: 'chat',
      action: 'stay',
      say: null,
      messageId: STREAMED,
    });
    expect(silent.effects.say).toBeNull();
  });

  it('is dropped from every client with message.discarded when it is not posted', () => {
    expect(ServerEvent.parse({ type: 'message.discarded', messageId: STREAMED })).toEqual({
      type: 'message.discarded',
      messageId: STREAMED,
    });
    expect(ServerEvent.safeParse({ type: 'message.discarded', messageId: 'x' }).success).toBe(
      false,
    );
  });
});
