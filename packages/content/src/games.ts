/**
 * Content checks of market-making games beyond their schema (ARCHITECTURE §8.3). Run by `check`
 * and the content tests; the seed does not run them, so a game whose figures are off still loads
 * (as a quiz question with a wrong answer would) but cannot pass CI.
 */
import { gameStats, numericToNumber, parseNumeric, type QuantGame } from '@ipp/contracts';

/** `fair`, `min` and `max` are authored exactly; they must agree with the engine to this. */
const EXACT_REL = 1e-9;
/** `sd` is authored to at least four significant figures. */
const SD_REL = 5e-4;

const agrees = (authored: number, computed: number, rel: number) =>
  Math.abs(authored - computed) <= rel * Math.max(Math.abs(computed), 1e-12);

/**
 * Where the authored `expect` disagrees with what the engine computes from the game's own
 * components and payoff (`gameStats`), as "game-id: message" strings (empty: nothing wrong).
 */
export function quantGameErrors(game: QuantGame): string[] {
  const stats = gameStats(game);
  const errors: string[] = [];
  for (const key of ['fair', 'min', 'max'] as const) {
    const text = game.expect[key];
    const v = parseNumeric(text);
    if (!v) {
      errors.push(`${game.id}: expect.${key} "${text}" is not a number`);
      continue;
    }
    if (!agrees(numericToNumber(v), stats[key], EXACT_REL))
      errors.push(`${game.id}: expect.${key} is ${text}, the engine computes ${stats[key]}`);
  }
  if (!agrees(game.expect.sd, stats.sd, SD_REL))
    errors.push(
      `${game.id}: expect.sd is ${game.expect.sd}, the engine computes ${stats.sd} (give at least four significant figures)`,
    );
  return errors;
}

/** Game ids that are also quiz question ids: a round names either by `questionId`, so none may. */
export function gameIdCollisions(
  games: readonly Pick<QuantGame, 'id'>[],
  questions: readonly { id: string }[],
): string[] {
  const ids = new Set(questions.map((q) => q.id));
  return games.filter((g) => ids.has(g.id)).map((g) => g.id);
}
