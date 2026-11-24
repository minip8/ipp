/**
 * Voice is a transport on top of the chat channel (docs/ARCHITECTURE.md §7): speech in becomes a
 * `chat.send` with via "voice", interviewer messages are spoken. The browser implementation uses
 * the Web Speech API; a server-side pipeline can implement the same interface later.
 */

export type VoiceErrorCode =
  | 'unsupported'
  | 'not-allowed'
  | 'no-speech'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  | 'unknown';

export type VoiceEvents = {
  /** Partial transcript of the current utterance. */
  interim: (text: string) => void;
  /** A finished utterance. */
  final: (text: string) => void;
  /** The user started talking (used for barge-in). */
  speechStart: () => void;
  listening: (on: boolean) => void;
  speaking: (on: boolean) => void;
  error: (code: VoiceErrorCode, message: string) => void;
};

export interface VoiceTransport {
  readonly supportsRecognition: boolean;
  readonly supportsSynthesis: boolean;
  /** continuous = hands-free; otherwise a single utterance (push-to-talk). */
  startListening(opts: { continuous: boolean }): void;
  stopListening(): void;
  speak(text: string): void;
  cancelSpeech(): void;
  on<K extends keyof VoiceEvents>(event: K, cb: VoiceEvents[K]): () => void;
  dispose(): void;
}

// Minimal typings for the parts of the Web Speech API we use (not in lib.dom for all browsers).
type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
};
export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
export type SynthesisLike = Pick<SpeechSynthesis, 'speak' | 'cancel' | 'speaking' | 'getVoices'>;

type Deps = {
  Recognition?: new () => SpeechRecognitionLike;
  synthesis?: SynthesisLike;
  Utterance?: new (text: string) => SpeechSynthesisUtterance;
  lang?: string;
};

function browserDeps(): Deps {
  if (typeof window === 'undefined') return {};
  const w = window as unknown as Record<string, unknown>;
  return {
    Recognition: (w.SpeechRecognition ?? w.webkitSpeechRecognition) as Deps['Recognition'],
    synthesis: 'speechSynthesis' in window ? window.speechSynthesis : undefined,
    Utterance:
      typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : undefined,
    lang: navigator.language || 'en-US',
  };
}

/** Strip markdown so the synthesiser reads prose, not punctuation. Code blocks are summarised. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (see the code in the chat) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class WebSpeechTransport implements VoiceTransport {
  private listeners: { [K in keyof VoiceEvents]: Set<VoiceEvents[K]> } = {
    interim: new Set(),
    final: new Set(),
    speechStart: new Set(),
    listening: new Set(),
    speaking: new Set(),
    error: new Set(),
  };
  private rec: SpeechRecognitionLike | null = null;
  private wantListening = false;
  private continuous = false;
  private speakingCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deps: Deps;

  constructor(deps: Deps = browserDeps()) {
    this.deps = deps;
  }

  get supportsRecognition() {
    return Boolean(this.deps.Recognition);
  }
  get supportsSynthesis() {
    return Boolean(this.deps.synthesis && this.deps.Utterance);
  }

  on<K extends keyof VoiceEvents>(event: K, cb: VoiceEvents[K]) {
    this.listeners[event].add(cb);
    return () => {
      this.listeners[event].delete(cb);
    };
  }

  private emit<K extends keyof VoiceEvents>(event: K, ...args: Parameters<VoiceEvents[K]>) {
    for (const cb of this.listeners[event])
      (cb as (...a: Parameters<VoiceEvents[K]>) => void)(...args);
  }

  startListening({ continuous }: { continuous: boolean }) {
    if (!this.deps.Recognition) {
      this.emit('error', 'unsupported', 'Speech recognition is not supported in this browser.');
      return;
    }
    this.wantListening = true;
    this.continuous = continuous;
    if (this.rec) return;
    const rec = new this.deps.Recognition();
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.lang = this.deps.lang ?? 'en-US';
    let finalText = '';
    rec.onstart = () => this.emit('listening', true);
    rec.onspeechstart = () => this.bargeIn();
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const t = r[0].transcript;
        if (r.isFinal) {
          finalText += t;
          const text = finalText.trim();
          finalText = '';
          if (text) this.emit('final', text);
        } else {
          interim += t;
        }
      }
      if (interim.trim()) {
        // Hearing the user while we speak means they want the floor.
        this.bargeIn();
        this.emit('interim', interim.trim());
      } else {
        this.emit('interim', '');
      }
    };
    rec.onerror = (e) => {
      const code =
        (['not-allowed', 'no-speech', 'audio-capture', 'network', 'aborted'] as const).find(
          (c) => c === e.error,
        ) ?? 'unknown';
      if (code === 'no-speech' || code === 'aborted') return; // routine; onend handles restart
      if (code === 'not-allowed' || code === 'audio-capture') this.wantListening = false;
      this.emit('error', code, messageFor(code, e.message));
    };
    rec.onend = () => {
      this.rec = null;
      this.emit('interim', '');
      if (this.wantListening && this.continuous) {
        // Chrome ends continuous sessions after a pause or ~60 s; keep hands-free going.
        this.restartTimer = setTimeout(() => this.startListening({ continuous: true }), 250);
        return;
      }
      this.wantListening = false;
      this.emit('listening', false);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }

  stopListening() {
    this.wantListening = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    // stop() (not abort) lets the recogniser deliver the final result for what was said.
    this.rec?.stop();
    if (!this.rec) this.emit('listening', false);
  }

  private bargeIn() {
    this.emit('speechStart');
    if (this.speakingCount > 0) this.cancelSpeech();
  }

  speak(text: string) {
    const { synthesis, Utterance } = this.deps;
    const clean = speakableText(text);
    if (!synthesis || !Utterance || !clean) return;
    const u = new Utterance(clean);
    u.lang = this.deps.lang ?? 'en-US';
    u.rate = 1.04;
    const voice = pickVoice(synthesis.getVoices(), u.lang);
    if (voice) u.voice = voice;
    u.onstart = () => {
      this.speakingCount++;
      if (this.speakingCount === 1) this.emit('speaking', true);
    };
    const done = () => {
      this.speakingCount = Math.max(0, this.speakingCount - 1);
      if (this.speakingCount === 0) this.emit('speaking', false);
    };
    u.onend = done;
    u.onerror = done;
    synthesis.speak(u);
  }

  cancelSpeech() {
    this.deps.synthesis?.cancel();
    if (this.speakingCount > 0) {
      this.speakingCount = 0;
      this.emit('speaking', false);
    }
  }

  dispose() {
    this.wantListening = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.rec?.abort();
    this.rec = null;
    this.cancelSpeech();
    for (const set of Object.values(this.listeners)) set.clear();
  }
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: string) {
  const base = lang.split('-')[0];
  const same = voices.filter((v) => v.lang === lang || v.lang.startsWith(`${base}-`));
  return (
    same.find((v) => /natural|neural|google|samantha|daniel/i.test(v.name)) ??
    same.find((v) => v.default) ??
    same[0]
  );
}

function messageFor(code: VoiceErrorCode, fallback?: string) {
  switch (code) {
    case 'not-allowed':
      return 'Microphone access was blocked. Allow it in the browser’s site settings to talk.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'Speech recognition needs a network connection in this browser.';
    default:
      return fallback || 'Speech recognition stopped unexpectedly.';
  }
}
