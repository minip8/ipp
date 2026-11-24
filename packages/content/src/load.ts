/**
 * Loads and validates everything under packages/content. Layout:
 *
 *   problems/<slug>/problem.yaml    slug, title, difficulty, tags, signature, limits?, source?
 *                   statement.md    shown to the candidate
 *                   notes.md        interviewer notes (server-only)
 *                   tests.json      TestCase[]
 *                   solution.cpp, solution.py, solution.java (optional)
 *   quiz/topics.yaml                QuizTopic[]
 *   quiz/<topic>/<anything>.yaml    QuizQuestion[] (topic must equal the directory name)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Language, ProblemContent, QuizQuestion, QuizTopic, TestCase } from '@ipp/contracts';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const CONTENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOLUTION_FILES: Record<Language, string> = {
  cpp: 'solution.cpp',
  python: 'solution.py',
  java: 'solution.java',
};

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
  const referenceSolutions: Partial<Record<Language, string>> = {};
  for (const [language, file] of Object.entries(SOLUTION_FILES) as [Language, string][]) {
    if (existsSync(join(dir, file))) referenceSolutions[language] = read(join(dir, file));
  }
  const parsed = ProblemContent.safeParse({
    ...meta,
    statement: read(join(dir, 'statement.md')),
    interviewerNotes: read(join(dir, 'notes.md')),
    tests: JSON.parse(read(join(dir, 'tests.json'))),
    referenceSolutions,
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

export function loadProblems(root = CONTENT_ROOT): ProblemContent[] {
  return listProblemSlugs(root).map((slug) => loadProblem(slug, root));
}

export function loadQuizTopics(root = CONTENT_ROOT): QuizTopic[] {
  const file = join(root, 'quiz', 'topics.yaml');
  if (!existsSync(file)) return [];
  const parsed = z.array(QuizTopic).safeParse(parseYaml(read(file)));
  return parsed.success ? parsed.data : fail('quiz/topics.yaml', parsed.error);
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
