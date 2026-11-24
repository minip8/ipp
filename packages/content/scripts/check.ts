/**
 * Validates content and checks reference solutions without the judge:
 *   - every problem and quiz file parses against the contracts
 *   - solution.py (+ harness.py) reproduces tests.json (run in a subprocess with a tiny runner);
 *     skipped for a problem without solution.py (one that does not offer Python)
 *   - solution.cpp, with harness.cpp appended as the API appends it, passes `g++ -fsyntax-only`
 *     (real execution: scripts/judge-all.ts)
 *
 *   pnpm --filter @ipp/content check              all problems
 *   pnpm --filter @ipp/content check two-sum ...  only these slugs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Json } from '@ipp/contracts';
import {
  EXTENSIONS,
  judgedReferenceSolutions,
  listProblemSlugs,
  loadProblem,
  loadQuizQuestions,
  loadQuizTopics,
  resultsEqual,
  untaxonomizedTags,
} from '../src';

const RUNNER = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("solution", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
data = json.load(open(sys.argv[2]))
out = []
for t in data["tests"]:
    obj = getattr(mod, data["className"])(*t["ctorArgs"])
    out.append([getattr(obj, c["method"])(*c["args"]) for c in t["calls"]])
json.dump(out, sys.stdout)
`;

const only = process.argv.slice(2);
const slugs = only.length ? only : listProblemSlugs();
const tmp = mkdtempSync(join(tmpdir(), 'ipp-content-'));
writeFileSync(join(tmp, 'runner.py'), RUNNER);
let failures = 0;
const bad = (msg: string) => {
  failures++;
  console.error(`FAIL ${msg}`);
};

for (const slug of slugs) {
  try {
    const p = loadProblem(slug);
    for (const t of untaxonomizedTags([p]))
      bad(`${t} is in no topic group (add it to TOPIC_GROUPS or EXCLUDED_TAGS in @ipp/contracts)`);
    // Reference solutions with the problem's harness appended, as the judge receives them.
    const judged = judgedReferenceSolutions(p);
    const withHarness = (l: 'cpp' | 'python') =>
      p.harness[l] ? ` + harness.${EXTENSIONS[l]}` : '';
    if (judged.python !== undefined) {
      const input = join(tmp, `${slug}.json`);
      writeFileSync(input, JSON.stringify({ className: p.signature.className, tests: p.tests }));
      const solution = join(tmp, `${slug}.py`);
      writeFileSync(solution, judged.python);
      const raw = execFileSync('python3', [join(tmp, 'runner.py'), solution, input], {
        maxBuffer: 256 * 1024 * 1024,
        timeout: 120_000,
      });
      const actual = JSON.parse(raw.toString()) as Json[][];
      const compare = new Map(p.signature.methods.map((m) => [m.name, m.compare]));
      p.tests.forEach((t, i) => {
        t.calls.forEach((c, j) => {
          const got = (actual[i]?.[j] ?? null) as Json;
          const want = t.expected[j] as Json;
          if (!resultsEqual(got, want, compare.get(c.method) ?? 'exact')) {
            bad(
              `${slug} test ${t.id} call ${j} (${c.method}): expected ${JSON.stringify(want)?.slice(0, 200)}, python gave ${JSON.stringify(got)?.slice(0, 200)}`,
            );
          }
        });
      });
    }
    if (judged.cpp !== undefined) {
      const solution = join(tmp, `${slug}.cpp`);
      writeFileSync(solution, judged.cpp);
      try {
        execFileSync('g++', ['-std=c++20', '-fsyntax-only', '-Wall', solution], { stdio: 'pipe' });
      } catch (e) {
        bad(
          `${slug} solution.cpp${withHarness('cpp')} does not compile:\n${(e as { stderr?: Buffer }).stderr?.toString().slice(0, 2000)}`,
        );
      }
    }
    const bytes = JSON.stringify(p.tests).length;
    if (bytes > 400_000) bad(`${slug}: tests.json is ${bytes} bytes; keep it under 400 KB`);
    console.log(
      `ok   ${slug} (${p.tests.length} tests, ${p.tests.filter((t) => t.hidden).length} hidden)`,
    );
  } catch (e) {
    bad(`${slug}: ${(e as Error).message}`);
  }
}

if (!only.length) {
  try {
    const topics = loadQuizTopics();
    const questions = loadQuizQuestions();
    const perTopic = new Map<string, number>();
    for (const q of questions) perTopic.set(q.topic, (perTopic.get(q.topic) ?? 0) + 1);
    console.log(
      `quiz: ${questions.length} questions in ${topics.length} topics`,
      Object.fromEntries(perTopic),
    );
  } catch (e) {
    bad(`quiz: ${(e as Error).message}`);
  }
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall content checks passed');
