import type { Language } from './common';
import type { JudgeLimits } from './judge';
import type { ProblemLimits } from './problem';

/** Slower runtimes get proportionally more time and memory, as on most judges. */
const TIME_FACTOR: Record<Language, number> = { cpp: 1, java: 2, python: 4 };
const MEMORY_EXTRA_MB: Record<Language, number> = { cpp: 0, java: 256, python: 64 };
const COMPILE_MS: Record<Language, number> = { cpp: 20_000, java: 20_000, python: 5_000 };

export const FILE_RUN_MS = 10_000;
export const FILE_RUN_MEMORY_MB = 256;
export const OUTPUT_BYTES = 64 * 1024;
export const TOTAL_MS = 60_000;

export function limitsForTests(language: Language, problem: ProblemLimits): JudgeLimits {
  return {
    compileMs: COMPILE_MS[language],
    runMs: problem.timeMs * TIME_FACTOR[language],
    totalMs: TOTAL_MS,
    memoryMb: problem.memoryMb + MEMORY_EXTRA_MB[language],
    outputBytes: OUTPUT_BYTES,
  };
}

export function limitsForFile(language: Language): JudgeLimits {
  return {
    compileMs: COMPILE_MS[language],
    runMs: FILE_RUN_MS,
    totalMs: TOTAL_MS,
    memoryMb: FILE_RUN_MEMORY_MB + MEMORY_EXTRA_MB[language],
    outputBytes: OUTPUT_BYTES,
  };
}
