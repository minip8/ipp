/** Randomness shared by the quiz selection and the quant round's assembly. */

/** A source of numbers in [0, 1), like `Math.random`. */
export type Rand = () => number;

/** Fisher-Yates on a copy. `rand` defaults to `Math.random`; tests pass a seeded one. */
export function shuffle<T>(xs: readonly T[], rand: Rand = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** A small seeded generator (mulberry32), so a selection can be replayed from its seed. */
export function seededRand(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
