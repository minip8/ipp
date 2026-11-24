/** Validates individual quiz files:  pnpm --filter @ipp/content exec tsx scripts/check-quiz.ts quiz/cpp/a.yaml ... */
import { readFileSync } from 'node:fs';
import { QuizQuestion } from '@ipp/contracts';
import { parse } from 'yaml';
import { z } from 'zod';

let failed = false;
for (const file of process.argv.slice(2)) {
  const parsed = z.array(QuizQuestion).safeParse(parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    failed = true;
    console.error(`FAIL ${file}\n${z.prettifyError(parsed.error)}`);
    continue;
  }
  const ids = new Set<string>();
  for (const q of parsed.data) {
    if (ids.has(q.id)) {
      failed = true;
      console.error(`FAIL ${file}: duplicate id ${q.id}`);
    }
    ids.add(q.id);
    if (q.type === 'single' || q.type === 'multiple') {
      const choices = new Set(q.choices.map((c) => c.id));
      for (const a of q.type === 'single' ? [q.answer] : q.answer) {
        if (!choices.has(a)) {
          failed = true;
          console.error(`FAIL ${file} ${q.id}: answer "${a}" is not a choice id`);
        }
      }
    }
  }
  const byType: Record<string, number> = {};
  for (const q of parsed.data) byType[q.type] = (byType[q.type] ?? 0) + 1;
  console.log(`ok   ${file}: ${parsed.data.length} questions`, byType);
}
process.exit(failed ? 1 : 0);
