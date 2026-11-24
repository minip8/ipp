import { InterviewerSettings, Language } from '@ipp/contracts';
import { z } from 'zod';
import { storage } from './storage';

/**
 * The last choices on the "new interview" form, so quick-start uses them too (the interviewer
 * model included; it is used only while the saved key is from the same provider).
 */
export const StartPrefs = z.object({
  language: Language.catch('cpp'),
  durationMin: z.int().min(5).max(180).catch(45),
  interviewer: InterviewerSettings.catch({
    enabled: true,
    style: 'neutral',
    proactivity: 'normal',
    voice: false,
  }),
});
export type StartPrefs = z.infer<typeof StartPrefs>;

const KEY = 'ipp:start-prefs';
export const loadStartPrefs = (): StartPrefs =>
  StartPrefs.parse(storage.get<unknown>(KEY, {}) ?? {});
export const saveStartPrefs = (p: StartPrefs) => storage.set(KEY, p);
