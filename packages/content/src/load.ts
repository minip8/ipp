/**
 * Loads and validates everything under packages/content. Layout:
 *
 *   problems/<slug>/problem.yaml    slug, title, difficulty, category, tags, signature, limits?,
 *                                   source?, languages? (absent = all)
 *                   statement.md    shown to the candidate
 *                   notes.md        interviewer notes (server-only)
 *                   tests.json      TestCase[]
 *                   solution.cpp, solution.py, solution.java   reference solutions (C++ and Python
 *                                   required when offered; candidate-side code only)
 *                   starter.<ext>   optional editor starter code (instead of the generated scaffold)
 *                   harness.<ext>   optional test harness appended to the candidate's code for
 *                                   judged runs; defines the signature's class (server-only)
 *   Starter, harness and solution files may exist only for the problem's languages.
 *   quiz/topics.yaml                QuizTopic[] in study order; `track` (fundamentals | quant)
 *                                   is the home, fundamentals by default, and decides the content
 *                                   rules; `also` (software | quant, none by default) lists the
 *                                   other site tracks the topic shows in, never its home's own
 *   quiz/<topic>/<anything>.yaml    QuizQuestion[] (topic must equal the directory name)
 *   games/<id>.yaml                 QuantGame, one market-making game per file (the id is the
 *                                   file name; its topic a quant topic of quiz/topics.yaml)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeJudgedSource,
  EXCLUDED_TAGS,
  groupOfTag,
  homeTrack,
  type Language,
  ProblemContent,
  QuantGame,
  QuizQuestion,
  QuizTopic,
  TestCase,
} from '@ipp/contracts';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const CONTENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** File extension per language: solution.<ext>, starter.<ext>, harness.<ext>. */
export const EXTENSIONS: Record<Language, string> = { cpp: 'cpp', python: 'py', java: 'java' };

const read = (path: string) => readFileSync(path, 'utf8');
const fail = (where: string, error: z.ZodError): never => {
  throw new Error(`${where}:\n${z.prettifyError(error)}`);
};

export function listProblemSlugs(root = CONTENT_ROOT): string[] {
  const dir = join(root, 'problems');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'problem.yaml')))
    .map((d) => d.name)
    .sort();
}

export function loadProblem(slug: string, root = CONTENT_ROOT): ProblemContent {
  const dir = join(root, 'problems', slug);
  const meta = parseYaml(read(join(dir, 'problem.yaml')));
  const perLanguage = (stem: string) => {
    const out: Partial<Record<Language, string>> = {};
    for (const [language, ext] of Object.entries(EXTENSIONS) as [Language, string][]) {
      const file = join(dir, `${stem}.${ext}`);
      if (existsSync(file)) out[language] = read(file);
    }
    return out;
  };
  const parsed = ProblemContent.safeParse({
    ...meta,
    statement: read(join(dir, 'statement.md')),
    interviewerNotes: read(join(dir, 'notes.md')),
    tests: JSON.parse(read(join(dir, 'tests.json'))),
    referenceSolutions: perLanguage('solution'),
    starterCode: perLanguage('starter'),
    harness: perLanguage('harness'),
  });
  if (!parsed.success) return fail(`problems/${slug}`, parsed.error);
  const problem = parsed.data;
  if (problem.slug !== slug)
    throw new Error(`problems/${slug}: slug "${problem.slug}" must match the directory name`);
  validateTests(problem);
  return problem;
}

/** Structural checks the schema cannot express: methods exist, arity matches, ids unique, samples present. */
function validateTests(problem: ProblemContent): void {
  const where = `problems/${problem.slug}`;
  const methods = new Map(problem.signature.methods.map((m) => [m.name, m]));
  const ids = new Set<string>();
  for (const test of problem.tests) {
    if (ids.has(test.id)) throw new Error(`${where}: duplicate test id "${test.id}"`);
    ids.add(test.id);
    if (test.ctorArgs.length !== problem.signature.ctorParams.length) {
      throw new Error(
        `${where} test ${test.id}: expected ${problem.signature.ctorParams.length} constructor arguments`,
      );
    }
    if (test.expected.length !== test.calls.length) {
      throw new Error(
        `${where} test ${test.id}: expected has ${test.expected.length} entries for ${test.calls.length} calls`,
      );
    }
    for (const call of test.calls) {
      const method = methods.get(call.method);
      if (!method) throw new Error(`${where} test ${test.id}: unknown method "${call.method}"`);
      if (call.args.length !== method.params.length) {
        throw new Error(
          `${where} test ${test.id}: ${call.method} takes ${method.params.length} arguments`,
        );
      }
    }
  }
  if (!problem.tests.some((t) => !t.hidden))
    throw new Error(`${where}: needs at least one visible sample test`);
  if (!problem.tests.some((t) => t.hidden)) throw new Error(`${where}: needs hidden tests`);
}

/**
 * The reference solutions as the judge must receive them: each with the problem's harness for
 * that language appended exactly as the API appends it to a candidate's source.
 */
export function judgedReferenceSolutions(
  problem: ProblemContent,
): Partial<Record<Language, string>> {
  const out: Partial<Record<Language, string>> = {};
  for (const [language, source] of Object.entries(problem.referenceSolutions) as [
    Language,
    string,
  ][])
    out[language] = composeJudgedSource(language, source, problem.harness[language]);
  return out;
}

export function loadProblems(root = CONTENT_ROOT): ProblemContent[] {
  return listProblemSlugs(root).map((slug) => loadProblem(slug, root));
}

/**
 * Tags that are neither in a topic group nor deliberately excluded (see @ipp/contracts taxonomy),
 * as "slug: tag" strings. Not part of loadProblem: the seed must not hide a problem over a new tag,
 * but `check` and the tests fail on any.
 */
export function untaxonomizedTags(problems: readonly ProblemContent[]): string[] {
  return problems.flatMap((p) =>
    p.tags.filter((t) => !groupOfTag(t) && !(t in EXCLUDED_TAGS)).map((t) => `${p.slug}: ${t}`),
  );
}

export function loadQuizTopics(root = CONTENT_ROOT): QuizTopic[] {
  const file = join(root, 'quiz', 'topics.yaml');
  if (!existsSync(file)) return [];
  const parsed = z.array(QuizTopic).safeParse(parseYaml(read(file)));
  if (!parsed.success) return fail('quiz/topics.yaml', parsed.error);
  for (const t of parsed.data) {
    const home = homeTrack(t.track);
    if (t.also.includes(home))
      throw new Error(
        `quiz/topics.yaml ${t.slug}: also lists "${home}", the site track of its home (${t.track}); list only other tracks`,
      );
    if (new Set(t.also).size !== t.also.length)
      throw new Error(`quiz/topics.yaml ${t.slug}: also repeats a track`);
  }
  return parsed.data;
}

export function loadQuizQuestions(root = CONTENT_ROOT): QuizQuestion[] {
  const dir = join(root, 'quiz');
  if (!existsSync(dir)) return [];
  const topics = new Set(loadQuizTopics(root).map((t) => t.slug));
  const seen = new Map<string, string>();
  const all: QuizQuestion[] = [];
  for (const topicDir of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    if (!topics.has(topicDir.name))
      throw new Error(`quiz/${topicDir.name}: not listed in quiz/topics.yaml`);
    for (const file of readdirSync(join(dir, topicDir.name))
      .filter((f) => f.endsWith('.yaml'))
      .sort()) {
      const where = `quiz/${topicDir.name}/${file}`;
      const parsed = z
        .array(QuizQuestion)
        .safeParse(parseYaml(read(join(dir, topicDir.name, file))));
      if (!parsed.success) return fail(where, parsed.error);
      for (const q of parsed.data) {
        if (q.topic !== topicDir.name)
          throw new Error(`${where} ${q.id}: topic must be "${topicDir.name}"`);
        const dup = seen.get(q.id);
        if (dup) throw new Error(`${where}: duplicate question id "${q.id}" (also in ${dup})`);
        seen.set(q.id, where);
        if (q.type === 'single' || q.type === 'multiple') {
          const choiceIds = new Set(q.choices.map((c) => c.id));
          if (choiceIds.size !== q.choices.length)
            throw new Error(`${where} ${q.id}: duplicate choice ids`);
          for (const a of q.type === 'single' ? [q.answer] : q.answer) {
            if (!choiceIds.has(a))
              throw new Error(`${where} ${q.id}: answer "${a}" is not a choice id`);
          }
        }
        all.push(q);
      }
    }
  }
  return all;
}

export { TestCase };

/** The game files under games/, sorted: `<id>.yaml`. */
export function listQuantGameFiles(root = CONTENT_ROOT): string[] {
  const dir = join(root, 'games');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
}

/**
 * One game file, parsed and checked against the rules the schema cannot see: its id is its file
 * name, and its topic is a quant topic of `quantTopics` (slugs of quiz/topics.yaml's topics whose
 * home is `quant`; `also: [quant]` does not make a topic one).
 * Whether `expect` matches the engine is `quantGameErrors` (`check` and the tests), not this.
 */
export function loadQuantGame(file: string, quantTopics: ReadonlySet<string>, root = CONTENT_ROOT) {
  const where = `games/${file}`;
  const parsed = QuantGame.safeParse(parseYaml(read(join(root, 'games', file))));
  if (!parsed.success) return fail(where, parsed.error);
  const game = parsed.data;
  if (`${game.id}.yaml` !== file)
    throw new Error(`${where}: id "${game.id}" must match the file name`);
  if (!quantTopics.has(game.topic))
    throw new Error(`${where}: topic "${game.topic}" is not a quant topic of quiz/topics.yaml`);
  return game;
}

/** Every market-making game under games/ (ARCHITECTURE §8.3). */
export function loadQuantGames(root = CONTENT_ROOT): QuantGame[] {
  const quant = new Set(
    loadQuizTopics(root)
      .filter((t) => t.track === 'quant')
      .map((t) => t.slug),
  );
  return listQuantGameFiles(root).map((f) => loadQuantGame(f, quant, root));
}
