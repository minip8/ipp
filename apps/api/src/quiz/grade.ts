/** Pure quiz helpers: public projection, auto-grading, answer reveal. */
import {
  type AnswerFeedback,
  numericMatches,
  type OutputAnswer,
  type PublicQuizQuestion,
  parseNumeric,
  type QuizQuestion,
  type QuizResponse,
} from '@ipp/contracts';

/** Score at or above which a partially-credited answer counts as correct. */
export const CORRECT_THRESHOLD = 0.7;

/**
 * What the browser may see before answering: no answer, explanation, reference or key points.
 * Built field by field, so interviewer material (`hints`, `followUps`) never leaves the server.
 */
export function publicQuestion(q: QuizQuestion): PublicQuizQuestion {
  return {
    id: q.id,
    topic: q.topic,
    subtopic: q.subtopic,
    difficulty: q.difficulty,
    type: q.type,
    prompt: q.prompt,
    choices:
      q.type === 'single' || q.type === 'multiple'
        ? q.choices.map((c) => ({ id: c.id, text: c.text }))
        : null,
    code:
      q.type === 'output' ? { language: q.language, standard: q.standard, source: q.code } : null,
    unit: q.type === 'numeric' ? (q.unit ?? null) : null,
  };
}

export function correctAnswer(q: QuizQuestion): AnswerFeedback['correctAnswer'] {
  switch (q.type) {
    case 'single':
      return q.answer;
    case 'multiple':
      return q.answer;
    case 'output':
      return q.answer;
    case 'short':
      return q.reference;
    case 'numeric':
      return q.answerText ?? q.answer;
  }
}

/** Trim and collapse all whitespace runs to a single space. */
export const normalizeOutput = (s: string) => s.trim().replace(/\s+/g, ' ');

export function outputAnswersMatch(expected: OutputAnswer, given: OutputAnswer): boolean {
  if (expected.kind !== given.kind) return false;
  if (expected.kind === 'output' && given.kind === 'output') {
    return normalizeOutput(expected.output) === normalizeOutput(given.output);
  }
  return true;
}

export interface AutoGrade {
  score: number;
  correct: boolean;
}

/**
 * Grades single, multiple, output and numeric questions. Multiple choice gets partial credit:
 * (right picks - wrong picks) / number of right answers, floored at 0; correct only on an exact match.
 * Numeric is right or wrong by `numericMatches` (exact, or within the question's tolerance, or a
 * decimal to three significant figures).
 */
export function gradeAuto(q: QuizQuestion, r: QuizResponse): AutoGrade | null {
  if (q.type === 'single' && r.type === 'single') {
    const correct = r.choice === q.answer;
    return { score: correct ? 1 : 0, correct };
  }
  if (q.type === 'multiple' && r.type === 'multiple') {
    const right = new Set(q.answer);
    const picked = new Set(r.choices);
    let hits = 0;
    let misses = 0;
    for (const p of picked) right.has(p) ? hits++ : misses++;
    const correct = hits === right.size && misses === 0;
    return { score: correct ? 1 : Math.max(0, (hits - misses) / right.size), correct };
  }
  if (q.type === 'output' && r.type === 'output') {
    const correct = outputAnswersMatch(q.answer, r.answer);
    return { score: correct ? 1 : 0, correct };
  }
  if (q.type === 'numeric' && r.type === 'numeric') {
    // The seed only stores answers that parse; a value the contract let through always does.
    const expected = parseNumeric(String(q.answer));
    const given = parseNumeric(r.value);
    const correct = !!expected && !!given && numericMatches(expected, given, q.tolerance);
    return { score: correct ? 1 : 0, correct };
  }
  return null;
}
