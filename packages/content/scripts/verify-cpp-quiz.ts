/**
 * Machine-verifies every C++ `output` question in the quiz bank.
 *
 *   pnpm --filter @ipp/content exec tsx scripts/verify-cpp-quiz.ts [quiz/cpp/a.yaml ...] [--only id,id] [--no-cache] [--verbose]
 *
 * For each question the program is compiled with g++ and clang++ at the question's `standard`
 * with -Wall -Wextra -pedantic-errors, one compile at a time, and checked against the answer kind:
 *   output         both compilers accept it, both binaries exit 0 and print exactly the stated
 *                  output (after trimming and collapsing whitespace), and a clang
 *                  -fsanitize=undefined,address build prints the same with no sanitizer report
 *   compile_error  both compilers reject it (the first error line is shown with --verbose)
 *   undefined      both compilers accept it; it is then run under UBSan+ASan (or TSan when it
 *                  uses <thread>) with both compilers and the report says whether a sanitizer
 *                  demonstrated the UB (informational: not every UB is detectable)
 *   unspecified    both compilers accept it; outputs are shown with --verbose
 *
 * Results are cached by a hash of the program, standard, answer and compiler versions.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

type Answer =
  | { kind: 'output'; output: string }
  | { kind: 'compile_error' | 'undefined' | 'unspecified' | 'runtime_error' };
type Question = {
  id: string;
  type: string;
  language?: string;
  standard?: string;
  code?: string;
  answer?: Answer;
};

const CONTENT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(tmpdir(), 'ipp-verify-cpp-quiz');
const CACHE_FILE = join(WORK, 'cache.json');
const COMPILERS = ['g++', 'clang++'] as const;
const BASE_FLAGS = ['-Wall', '-Wextra', '-pedantic-errors', '-pthread'];
const RUN_TIMEOUT_MS = 10_000;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set((args[onlyIdx + 1] ?? '').split(',')) : null;
const files = args.filter((a, i) => !a.startsWith('--') && !(onlyIdx >= 0 && i === onlyIdx + 1));
const verbose = flag('--verbose');
const useCache = !flag('--no-cache');

const quizFiles = files.length
  ? files.map((f) => resolve(f))
  : readdirSync(join(CONTENT, 'quiz', 'cpp'))
      .filter((f) => f.endsWith('.yaml'))
      .sort()
      .map((f) => join(CONTENT, 'quiz', 'cpp', f));

mkdirSync(WORK, { recursive: true });
const cache: Record<string, string> =
  useCache && existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
const versions = COMPILERS.map(
  (c) => spawnSync(c, ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0],
).join(' | ');

const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');

function stdFlag(standard: string): string {
  const m = /^C\+\+(\d\d)$/.exec(standard.trim());
  if (!m) throw new Error(`unsupported standard "${standard}"`);
  return `-std=c++${m[1]}`;
}

function compile(compiler: string, src: string, exe: string, extra: string[]) {
  const r = spawnSync(compiler, [...extra, ...BASE_FLAGS, src, '-o', exe], { encoding: 'utf8' });
  const firstError = (r.stderr ?? '').split('\n').find((l) => /error/.test(l)) ?? '';
  return { ok: r.status === 0, stderr: r.stderr ?? '', firstError };
}

function run(exe: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(exe, [], {
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    env: { ...process.env, ...env },
  });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const SAN_ENV = {
  ASAN_OPTIONS: 'detect_leaks=1:halt_on_error=1',
  UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=0',
  TSAN_OPTIONS: 'halt_on_error=1',
};
const sanitizerFired = (stderr: string) =>
  /runtime error|AddressSanitizer|LeakSanitizer|ThreadSanitizer|UndefinedBehaviorSanitizer/.test(
    stderr,
  );

/** Returns an error message, or null when the question checks out. Notes go to `notes`. */
function verify(q: Question, notes: string[]): string | null {
  const answer = q.answer as Answer;
  const std = stdFlag(q.standard ?? '');
  const src = join(WORK, `${q.id}.cpp`);
  writeFileSync(src, q.code ?? '');
  const exe = (tag: string) => join(WORK, `${q.id}.${tag}`);

  const builds = COMPILERS.map((c) => ({ compiler: c, ...compile(c, src, exe(c), [std, '-O1']) }));
  if (answer.kind === 'compile_error') {
    const accepted = builds.filter((b) => b.ok).map((b) => b.compiler);
    if (accepted.length) return `expected compile_error but ${accepted.join(' and ')} accepted it`;
    for (const b of builds)
      notes.push(`${b.compiler}: ${b.firstError.replace(/^.*?error: /, 'error: ')}`);
    return null;
  }
  const rejected = builds.filter((b) => !b.ok);
  if (rejected.length)
    return `expected it to compile but ${rejected.map((b) => `${b.compiler}: ${b.firstError}`).join('; ')}`;

  const runs = COMPILERS.map((c) => ({ compiler: c, ...run(exe(c)) }));
  if (answer.kind === 'output') {
    for (const r of runs) {
      if (r.status !== 0)
        return `${r.compiler} build exited with ${r.status ?? r.signal}: ${r.stderr.slice(0, 300)}`;
      if (normalize(r.stdout) !== normalize(answer.output)) {
        return `${r.compiler} printed ${JSON.stringify(r.stdout)} but the answer says ${JSON.stringify(answer.output)}`;
      }
    }
    const san = compile('clang++', src, exe('san'), [
      std,
      '-O1',
      '-g',
      '-fsanitize=undefined,address',
      '-fno-sanitize-recover=all',
    ]);
    if (!san.ok) return `clang++ sanitizer build failed: ${san.firstError}`;
    // a leak is not undefined behaviour (one question is about a shared_ptr cycle), so only UB/ASan errors fail it
    const sr = run(exe('san'), { ...SAN_ENV, ASAN_OPTIONS: 'detect_leaks=0:halt_on_error=1' });
    if (sanitizerFired(sr.stderr) || sr.status !== 0)
      return `sanitizer build failed at runtime: ${sr.stderr.slice(0, 400)}`;
    if (normalize(sr.stdout) !== normalize(answer.output))
      return `sanitizer build printed ${JSON.stringify(sr.stdout)}`;
    return null;
  }
  if (answer.kind === 'undefined') {
    const threaded = /#include\s*<(thread|atomic|mutex)>/.test(q.code ?? '');
    const sanFlags = threaded
      ? ['-fsanitize=thread']
      : ['-fsanitize=undefined,address', '-fno-sanitize-recover=all'];
    const detected: string[] = [];
    for (const c of COMPILERS) {
      const b = compile(c, src, exe(`${c}.san`), [std, '-O1', '-g', ...sanFlags]);
      if (!b.ok) {
        notes.push(`${c} sanitizer build failed: ${b.firstError}`);
        continue;
      }
      const r = run(exe(`${c}.san`), SAN_ENV);
      if (sanitizerFired(r.stderr)) {
        const line =
          r.stderr
            .split('\n')
            .find((l) => /runtime error|ERROR: \w+Sanitizer|WARNING: ThreadSanitizer/.test(l)) ??
          '';
        detected.push(
          `${c}: ${line.replace(/^.*?(runtime error|ERROR|WARNING)/, '$1').slice(0, 160)}`,
        );
      }
    }
    notes.push(
      detected.length
        ? `sanitizer demonstrated UB -> ${detected.join(' || ')}`
        : 'sanitizer did not flag it (UB not detectable this way)',
    );
    return null;
  }
  if (answer.kind === 'unspecified') {
    for (const r of runs)
      notes.push(
        `${r.compiler} printed ${JSON.stringify(normalize(r.stdout))} (exit ${r.status ?? r.signal})`,
      );
    return null;
  }
  return `answer kind ${answer.kind} is not used for C++`;
}

let checked = 0;
let failed = 0;
let fromCache = 0;
const counts: Record<string, number> = {};
const sanitizerDemonstrated: string[] = [];
for (const file of quizFiles) {
  const questions = parse(readFileSync(file, 'utf8')) as Question[];
  for (const q of questions) {
    if (q.type !== 'output' || q.language !== 'cpp') continue;
    if (only && !only.has(q.id)) continue;
    const key = createHash('sha256')
      .update(JSON.stringify([q.code, q.standard, q.answer, versions, 3]))
      .digest('hex');
    const kind = (q.answer as Answer).kind;
    counts[kind] = (counts[kind] ?? 0) + 1;
    checked++;
    if (useCache && cache[q.id] === key && !verbose) {
      fromCache++;
      continue;
    }
    const notes: string[] = [];
    let error: string | null;
    try {
      error = verify(q, notes);
    } catch (e) {
      error = String(e);
    }
    if (notes.some((n) => n.startsWith('sanitizer demonstrated'))) sanitizerDemonstrated.push(q.id);
    if (error) {
      failed++;
      delete cache[q.id];
      console.error(`FAIL ${q.id} (${kind}): ${error}`);
    } else {
      cache[q.id] = key;
      console.log(`ok   ${q.id} (${kind})`);
    }
    if (verbose || kind === 'undefined') for (const n of notes) console.log(`       ${n}`);
  }
}
writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
console.log(`\n${versions}`);
console.log(
  `${checked} output questions checked (${fromCache} unchanged since last pass), ${failed} failed`,
  counts,
);
if (sanitizerDemonstrated.length)
  console.log(`UB demonstrated by a sanitizer this run: ${sanitizerDemonstrated.join(', ')}`);
process.exit(failed ? 1 : 0);
