/**
 * Problems with their own test harness and starter code (language-restricted problems such as a
 * C++ `UniquePtr<T>`). The candidate writes whatever the statement asks for; the problem's
 * harness, appended after their source for judged runs, defines the class in the signature and
 * drives their code. The judge sees one ordinary file and needs no special handling.
 *
 * `composeJudgedSource` is the one composition used by the API (runs) and by the content scripts
 * (reference solutions through the real judge), so the two cannot drift.
 */
import type { Language } from './common';
import type { ProblemSignature } from './problem';
import { BLANK_SCAFFOLDS, generateScaffold } from './scaffold';

/**
 * File name the C++ harness is compiled under: diagnostics in harness lines read
 * `tests.cpp:LINE:COL: ...` (the judge reports the candidate's own lines as `solution.cpp`).
 */
export const CPP_HARNESS_FILE = 'tests.cpp';

const withNewline = (s: string) => (s === '' || s.endsWith('\n') ? s : `${s}\n`);

/**
 * The source a judged run sends to the judge: the candidate's file, then the harness.
 *
 *   C++     <candidate>[\n] `#line 1 "tests.cpp"`\n <harness>[\n]
 *           The `#line` marker keeps the candidate's own line numbers unchanged (they come first)
 *           and makes errors inside the harness point at `tests.cpp`, not past the end of their file.
 *   others  <candidate>[\n] \n <harness>[\n]
 *
 * Without a harness the candidate's source is returned unchanged.
 */
export function composeJudgedSource(
  language: Language,
  candidate: string,
  harness: string | undefined,
): string {
  if (harness === undefined) return candidate;
  const head = withNewline(candidate);
  if (language === 'cpp') return `${head}#line 1 "${CPP_HARNESS_FILE}"\n${withNewline(harness)}`;
  return `${head}\n${withNewline(harness)}`;
}

/** What starter code needs to know about a problem. */
export interface StarterSource {
  signature: ProblemSignature;
  /** Absent = every language. */
  languages?: readonly Language[];
  starterCode?: Partial<Record<Language, string>>;
}

/**
 * The editor's starting code: the problem's starter code if it has one, else the scaffold
 * generated from the signature. Empty for a language the problem does not offer (its signature
 * may be a harness class the candidate never writes).
 * No problem (a blank room): a small program that runs as written.
 */
export function problemScaffold(problem: StarterSource | null, language: Language): string {
  if (!problem) return BLANK_SCAFFOLDS[language];
  if (problem.languages && !problem.languages.includes(language)) return '';
  return problem.starterCode?.[language] ?? generateScaffold(problem.signature, language);
}

export function problemScaffolds(problem: StarterSource | null): Record<Language, string> {
  return {
    cpp: problemScaffold(problem, 'cpp'),
    python: problemScaffold(problem, 'python'),
    java: problemScaffold(problem, 'java'),
  };
}
