/**
 * Prints the quiz questions of the given topics, and the market-making games (games/) of those
 * topics, as JSON for scripts/verify-quant-quiz.py, read with the same schemas the app uses.
 * Numeric answers and a game's exact `expect` figures come out as exact rationals.
 *
 *   tsx scripts/quant-dump.ts probability statistics
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNumeric, QuantGame, QuizQuestion } from '@ipp/contracts';
import { parse } from 'yaml';
import { z } from 'zod';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIZ = join(ROOT, 'quiz');
const GAMES = join(ROOT, 'games');
const out: unknown[] = [];
let failed = false;

const rational = (text: string, where: string) => {
  const v = parseNumeric(text);
  if (!v) throw new Error(`${where}: unreadable number ${text}`);
  return { num: v.num.toString(), den: v.den.toString(), text };
};

const topics = process.argv.slice(2);
for (const topic of topics) {
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
        item.answer = rational(q.answer, q.id);
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

// Games of the same topics, as items of type `game`.
const files = existsSync(GAMES)
  ? readdirSync(GAMES)
      .filter((f) => f.endsWith('.yaml'))
      .sort()
  : [];
for (const file of files) {
  const where = `games/${file}`;
  const parsed = QuantGame.safeParse(parse(readFileSync(join(GAMES, file), 'utf8')));
  if (!parsed.success) {
    failed = true;
    console.error(`FAIL ${where}\n${z.prettifyError(parsed.error)}`);
    continue;
  }
  const g = parsed.data;
  if (!topics.includes(g.topic)) continue;
  out.push({
    id: g.id,
    topic: g.topic,
    file: where,
    type: 'game',
    expect: {
      fair: rational(g.expect.fair, g.id),
      sd: g.expect.sd,
      min: rational(g.expect.min, g.id),
      max: rational(g.expect.max, g.id),
    },
  });
}

// No process.exit: it can cut a long write to a pipe short.
process.stdout.write(JSON.stringify(out));
process.exitCode = failed ? 1 : 0;
