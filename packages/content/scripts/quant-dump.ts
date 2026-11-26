/**
 * Prints the quiz questions of the given topics as JSON for scripts/verify-quant-quiz.py, read
 * with the same schema the app uses. Numeric answers come out as exact rationals.
 *
 *   tsx scripts/quant-dump.ts probability statistics
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNumeric, QuizQuestion } from '@ipp/contracts';
import { parse } from 'yaml';
import { z } from 'zod';

const QUIZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'quiz');
const out: unknown[] = [];
let failed = false;

for (const topic of process.argv.slice(2)) {
  const dir = join(QUIZ, topic);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()) {
    const where = `quiz/${topic}/${file}`;
    const parsed = z.array(QuizQuestion).safeParse(parse(readFileSync(join(dir, file), 'utf8')));
    if (!parsed.success) {
      failed = true;
      console.error(`FAIL ${where}\n${z.prettifyError(parsed.error)}`);
      continue;
    }
    for (const q of parsed.data) {
      if (q.topic !== topic) {
        failed = true;
        console.error(`FAIL ${where} ${q.id}: topic is "${q.topic}", expected "${topic}"`);
      }
      const item: Record<string, unknown> = { id: q.id, topic, file: where, type: q.type };
      if (q.type === 'numeric') {
        const v = parseNumeric(q.answer);
        if (!v) throw new Error(`${q.id}: unreadable answer`);
        item.answer = { num: v.num.toString(), den: v.den.toString(), text: q.answer };
        item.tolerance = q.tolerance ?? null;
      } else if (q.type === 'single') {
        item.answer = q.answer;
      } else if (q.type === 'multiple') {
        item.answer = [...q.answer].sort();
      }
      out.push(item);
    }
  }
}

// No process.exit: it can cut a long write to a pipe short.
process.stdout.write(JSON.stringify(out));
process.exitCode = failed ? 1 : 0;
