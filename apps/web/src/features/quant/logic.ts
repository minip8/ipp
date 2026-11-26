/**
 * Pure helpers for the Quant track's paths (in `?path=`) and its live round's setup: its lengths,
 * saved choices, and why it could not start. A path's steps are the Roadmap's (features/roadmap).
 */
import {
  InterviewerSettings,
  QUANT_PATHS,
  QUANT_ROUND_DURATIONS,
  QuantPath,
  QuantRoundDuration,
  quantQuestionCount,
} from '@ipp/contracts';
import { z } from 'zod';
import { ApiRequestError, errorMessage, formatRetry } from '@/lib/api';
import { storage } from '@/lib/storage';

/** Where the chosen path lives in the URL; the first path is the default and leaves it out. */
export const PATH_PARAM = 'path';

/** The paths in tab order (the first is the default). */
export const PATHS: readonly [QuantPath, ...QuantPath[]] = QUANT_PATHS;

// ---------------------------------------------------------------- the live round

/** The round lengths offered, each with the number of questions it asks. */
export const ROUND_OPTIONS = QUANT_ROUND_DURATIONS.map((min) => ({
  durationMin: min,
  questions: quantQuestionCount(min),
}));

/** "4 questions, about 8 minutes each" */
export function roundShape(durationMin: number): string {
  const n = quantQuestionCount(durationMin);
  return `${n} questions, about ${Math.round(durationMin / n)} minutes each`;
}

/**
 * The round's last setup in this browser (duration, interviewer, and per path whether to include
 * a market-making game), as the coding setup keeps its own.
 */
export const RoundPrefs = z.object({
  durationMin: QuantRoundDuration.catch(30),
  interviewer: InterviewerSettings.omit({ enabled: true }).catch({
    style: 'neutral',
    proactivity: 'normal',
    voice: false,
  }),
  /** Set only once the candidate turns the game on or off on that path. */
  games: z.partialRecord(QuantPath, z.boolean()).catch({}),
});
export type RoundPrefs = z.infer<typeof RoundPrefs>;

const ROUND_PREFS_KEY = 'ipp:quant-round';

/**
 * Whether a round on `path` includes a market-making game (`includeGame`): the candidate's own
 * choice on that path, else what the path decides on the server (a trader round has one, a
 * researcher round none).
 */
export const includesGame = (prefs: Pick<RoundPrefs, 'games'>, path: QuantPath): boolean =>
  prefs.games[path] ?? path === 'trader';

/** Saved round prefs, else the interviewer the coding setup last used, at 30 minutes. */
export function loadRoundPrefs(fallback: RoundPrefs['interviewer']): RoundPrefs {
  return RoundPrefs.parse(storage.get<unknown>(ROUND_PREFS_KEY, null) ?? { interviewer: fallback });
}
export const saveRoundPrefs = (p: RoundPrefs) => storage.set(ROUND_PREFS_KEY, p);

/**
 * Why a round could not start, in words: the key it needs, a path short of questions for this
 * length, or the start allowance used up. Anything else is the server's own message.
 */
export function roundStartError(e: unknown, durationMin: number): string {
  if (!(e instanceof ApiRequestError)) return errorMessage(e);
  if (e.code === 'ai_key_missing')
    return 'The interviewer runs the round on your own AI API key. Add a working key, then start again.';
  if (e.code === 'quant_unavailable')
    return `This path does not have enough questions for a ${quantQuestionCount(durationMin)}-question round yet. Try a shorter round.`;
  if (e.isRateLimited)
    return e.retryAfter
      ? `You have started a lot of interviews in a short time. You can start another in ${formatRetry(e.retryAfter)}.`
      : 'You have started a lot of interviews in a short time. Try again in a few minutes.';
  if (e.code === 'account_required') return 'Sign in with an account to start a round.';
  return errorMessage(e);
}
