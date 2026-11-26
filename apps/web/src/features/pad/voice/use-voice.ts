'use client';
import type { Message } from '@ipp/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '@/lib/storage';
import { spokenText } from '../questions';
import { type VoiceErrorCode, type VoiceTransport, WebSpeechTransport } from './transport';

export type VoiceMode = 'push' | 'handsfree';

/**
 * Voice on top of chat: final transcripts are sent as chat messages (via "voice"), and interviewer
 * messages that arrive while voice is on are spoken (a quant round's posed question is pointed to,
 * not read: see `spokenText`). Speaking over the interviewer interrupts it.
 */
export function useVoice({
  enabled,
  messages,
  onUtterance,
  transportFactory = () => new WebSpeechTransport(),
}: {
  enabled: boolean;
  messages: Message[];
  onUtterance: (text: string) => void;
  transportFactory?: () => VoiceTransport;
}) {
  const [transport, setTransport] = useState<VoiceTransport | null>(null);
  const [mode, setModeState] = useState<VoiceMode>(() =>
    storage.get<VoiceMode>('ipp:voice-mode', 'push'),
  );
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<{ code: VoiceErrorCode; message: string } | null>(null);
  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;
  // Everything already in the transcript when the pad opens is history, never read aloud.
  const spoken = useRef<Set<string>>(null as unknown as Set<string>);
  spoken.current ??= new Set(messages.map((m) => m.id));

  // biome-ignore lint/correctness/useExhaustiveDependencies: the transport is created once per mount
  useEffect(() => {
    const t = transportFactory();
    setTransport(t);
    const offs = [
      t.on('interim', setInterim),
      t.on('final', (text) => {
        setInterim('');
        onUtteranceRef.current(text);
      }),
      t.on('listening', setListening),
      t.on('speaking', setSpeaking),
      t.on('error', (code, message) => setError({ code, message })),
    ];
    return () => {
      for (const off of offs) off();
      t.dispose();
    };
  }, []);

  // Messages that exist when voice is switched on are history; only new ones are spoken.
  useEffect(() => {
    if (!enabled) {
      spoken.current = new Set(messages.map((m) => m.id));
      transport?.cancelSpeech();
      transport?.stopListening();
      return;
    }
    for (const m of messages) {
      if (spoken.current.has(m.id)) continue;
      spoken.current.add(m.id);
      if (m.role === 'interviewer') transport?.speak(spokenText(m, messages));
    }
  }, [enabled, messages, transport]);

  const setMode = useCallback(
    (m: VoiceMode) => {
      setModeState(m);
      storage.set('ipp:voice-mode', m);
      transport?.stopListening();
    },
    [transport],
  );

  const start = useCallback(() => {
    setError(null);
    transport?.startListening({ continuous: mode === 'handsfree' });
  }, [transport, mode]);
  const stop = useCallback(() => transport?.stopListening(), [transport]);
  const toggle = useCallback(() => (listening ? stop() : start()), [listening, start, stop]);

  return {
    supported: {
      recognition: transport?.supportsRecognition ?? true,
      synthesis: transport?.supportsSynthesis ?? true,
    },
    mode,
    setMode,
    listening,
    speaking,
    interim,
    error,
    start,
    stop,
    toggle,
    stopSpeaking: () => transport?.cancelSpeech(),
  };
}
