/**
 * Runs every reference solution through the real judge (sandbox images must be built):
 *
 *   cargo build --release -j 4
 *   pnpm --filter @ipp/content exec tsx scripts/judge-all.ts [slug ...] [--lang cpp,python,java]
 *
 * Exits 1 if any solution is not accepted. Problems are run one at a time.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTENT_ROOT, judgedReferenceSolutions, listProblemSlugs, loadProblem } from '../src';

const args = process.argv.slice(2);
const langAt = args.indexOf('--lang');
const lang = langAt >= 0 ? args[langAt + 1] : undefined;
const only = args.filter((a, i) => !a.startsWith('--') && (langAt < 0 || i !== langAt + 1));
const slugs = only.length ? only : listProblemSlugs();
const judge = join(CONTENT_ROOT, '..', '..', 'target', 'release', 'judge');
const tmp = mkdtempSync(join(tmpdir(), 'ipp-judge-all-'));

const failed: string[] = [];
for (const slug of slugs) {
  const file = join(tmp, `${slug}.json`);
  // The judge gets each solution with the problem's harness appended, exactly as the API sends
  // a candidate's source (composeJudgedSource); the harness itself never travels separately.
  const problem = loadProblem(slug);
  writeFileSync(
    file,
    JSON.stringify({ ...problem, referenceSolutions: judgedReferenceSolutions(problem) }),
  );
  const started = Date.now();
  const res = spawnSync(judge, ['run-problem', file, ...(lang ? ['--lang', lang] : [])], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SANDBOX_RUNTIME: process.env.SANDBOX_RUNTIME ?? 'runc',
      JUDGE_ALLOW_INSECURE_RUNTIME: '1',
      RUST_LOG: 'error',
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0) {
    console.log(`ok   ${slug} (${secs}s)`);
  } else {
    failed.push(slug);
    console.log(`FAIL ${slug} (${secs}s)\n${(res.stdout + res.stderr).slice(0, 3000)}`);
  }
}
console.log(
  `\n${slugs.length - failed.length}/${slugs.length} problems accepted in every provided language`,
);
if (failed.length) {
  console.log(`failed: ${failed.join(' ')}`);
  process.exit(1);
}
