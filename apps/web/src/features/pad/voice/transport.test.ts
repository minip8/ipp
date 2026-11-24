import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type SpeechRecognitionLike, speakableText, WebSpeechTransport } from './transport';

class FakeRec implements SpeechRecognitionLike {
  static last: FakeRec | null = null;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: SpeechRecognitionLike['onresult'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  onstart: SpeechRecognitionLike['onstart'] = null;
  onspeechstart: SpeechRecognitionLike['onspeechstart'] = null;
  started = 0;
  constructor() {
    FakeRec.last = this;
  }
  start() {
    this.started++;
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  result(text: string, isFinal: boolean) {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal, length: 1, 0: { transcript: text } } },
    });
  }
}

class FakeUtterance {
  lang = '';
  rate = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

function make() {
  const spoken: FakeUtterance[] = [];
  const synthesis = {
    speaking: false,
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
      u.onstart?.();
    }),
    cancel: vi.fn(),
    getVoices: () => [],
  };
  const t = new WebSpeechTransport({
    Recognition: FakeRec,
    synthesis: synthesis as never,
    Utterance: FakeUtterance as never,
    lang: 'en-US',
  });
  return { t, synthesis, spoken };
}

describe('WebSpeechTransport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits interim text then a final utterance', () => {
    const { t } = make();
    const interim: string[] = [];
    const finals: string[] = [];
    t.on('interim', (s) => interim.push(s));
    t.on('final', (s) => finals.push(s));
    t.startListening({ continuous: false });
    FakeRec.last?.result('what is the', false);
    FakeRec.last?.result('what is the complexity', true);
    expect(interim).toContain('what is the');
    expect(finals).toEqual(['what is the complexity']);
  });

  it('barges in: user speech cancels the interviewer', () => {
    const { t, synthesis } = make();
    const speaking: boolean[] = [];
    t.on('speaking', (s) => speaking.push(s));
    t.speak('Let me ask you about **edge cases**.');
    expect(speaking).toEqual([true]);
    t.startListening({ continuous: true });
    FakeRec.last?.result('wait', false);
    expect(synthesis.cancel).toHaveBeenCalled();
    expect(speaking).toEqual([true, false]);
  });

  it('restarts hands-free recognition when the browser ends the session', () => {
    const { t } = make();
    t.startListening({ continuous: true });
    const first = FakeRec.last;
    first?.onend?.();
    vi.advanceTimersByTime(300);
    expect(FakeRec.last).not.toBe(first);
    expect(FakeRec.last?.continuous).toBe(true);
    t.stopListening();
  });

  it('reports blocked microphones and stops trying', () => {
    const { t } = make();
    const errors: string[] = [];
    const listening: boolean[] = [];
    t.on('error', (c) => errors.push(c));
    t.on('listening', (l) => listening.push(l));
    t.startListening({ continuous: true });
    FakeRec.last?.onerror?.({ error: 'not-allowed' });
    FakeRec.last?.onend?.();
    expect(errors).toEqual(['not-allowed']);
    expect(listening.at(-1)).toBe(false);
  });

  it('degrades gracefully without the API', () => {
    const t = new WebSpeechTransport({});
    const errors: string[] = [];
    t.on('error', (c) => errors.push(c));
    expect(t.supportsRecognition).toBe(false);
    expect(t.supportsSynthesis).toBe(false);
    t.startListening({ continuous: false });
    t.speak('hello');
    expect(errors).toEqual(['unsupported']);
  });
});

describe('speakableText', () => {
  it('strips markdown and summarises code', () => {
    expect(speakableText('Try **this**:\n```cpp\nint x;\n```\nand `map`.')).toBe(
      'Try this: (see the code in the chat) and map.',
    );
  });
});
