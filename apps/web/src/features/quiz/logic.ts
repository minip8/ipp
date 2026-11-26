/** Pure helpers for the quiz flow: drafts, responses, answer formatting, outcome, tracks. */
import {
  type AnswerFeedback,
  type Language,
  type OutputAnswer,
  type PublicQuizQuestion,
  parseNumeric,
  QUIZ_TRACK_INFO,
  QUIZ_TRACKS,
  type QuizMode,
  type QuizResponse,
  type QuizTrack,
} from '@ipp/contracts';
import { type Segment, splitMath } from '@/components/math-guard';

export type OutputKind = OutputAnswer['kind'];

export type Draft =
  | { type: 'single'; choice: string | null }
  | { type: 'multiple'; choices: string[] }
  | { type: 'output'; kind: OutputKind | null; output: string }
  | { type: 'short'; text: string }
  /** `checked`: Submit was pressed, so a value that cannot be sent says why (until it can). */
  | { type: 'numeric'; value: string; checked?: boolean };

export const SHORT_MAX = 4000;

export function emptyDraft(q: PublicQuizQuestion): Draft {
  switch (q.type) {
    case 'single':
      return { type: 'single', choice: null };
    case 'multiple':
      return { type: 'multiple', choices: [] };
    case 'output':
      return { type: 'output', kind: null, output: '' };
    case 'short':
      return { type: 'short', text: '' };
    case 'numeric':
      return { type: 'numeric', value: '' };
  }
}

export function draftFromResponse(q: PublicQuizQuestion, r: QuizResponse | undefined): Draft {
  if (!r || r.type !== q.type) return emptyDraft(q);
  switch (r.type) {
    case 'single':
      return { type: 'single', choice: r.choice };
    case 'multiple':
      return { type: 'multiple', choices: [...r.choices] };
    case 'output':
      return {
        type: 'output',
        kind: r.answer.kind,
        output: r.answer.kind === 'output' ? r.answer.output : '',
      };
    case 'short':
      return { type: 'short', text: r.text };
    case 'numeric':
      return { type: 'numeric', value: r.value };
  }
}

/**
 * The response to send, or null while the draft is incomplete or, for a numeric answer, not a
 * number (`numericProblem` says why).
 */
export function toResponse(d: Draft): QuizResponse | null {
  switch (d.type) {
    case 'single':
      return d.choice ? { type: 'single', choice: d.choice } : null;
    case 'multiple':
      return d.choices.length ? { type: 'multiple', choices: [...d.choices].sort() } : null;
    case 'output':
      if (!d.kind) return null;
      if (d.kind === 'output')
        return d.output.trim()
          ? { type: 'output', answer: { kind: 'output', output: d.output } }
          : null;
      return { type: 'output', answer: { kind: d.kind } };
    case 'short': {
      const text = d.text.trim();
      return text ? { type: 'short', text: text.slice(0, SHORT_MAX) } : null;
    }
    case 'numeric': {
      const value = d.value.trim();
      return value && !numericProblem(value) ? { type: 'numeric', value } : null;
    }
  }
}

// ---------------------------------------------------------------- numeric answers

/** The accepted forms, under the input. */
export const NUMERIC_HINT = 'A fraction, a decimal to 3 significant figures, or a percentage.';
export const NUMERIC_PLACEHOLDER = 'e.g. 5/36 or 0.139';

/**
 * Why a typed numeric answer cannot be sent, or null when it can (or nothing is typed yet).
 * Checked here so the user hears it at once rather than from the server.
 */
export function numericProblem(value: string): string | null {
  const v = value.trim();
  if (!v || parseNumeric(v) !== null) return null;
  return 'Enter a number, like 5/36, 0.139 or 13.9%.';
}

/** Something is typed that Submit cannot send: it shows `numericProblem` instead. */
export const isUnsendable = (d: Draft) => d.type === 'numeric' && numericProblem(d.value) !== null;

/** A value with the question's unit (always a word, never `%`) after it: `6 rolls`. */
export const withUnit = (value: string, unit: string | null) => (unit ? `${value} ${unit}` : value);

/**
 * The correct answer of a numeric question, as Markdown. The API sends the question's
 * `answerText` when it has one (which says the unit itself if it needs to), else the bare
 * number, which gets the unit here.
 */
export function numericCorrect(q: PublicQuizQuestion, f: AnswerFeedback): string {
  const a = typeof f.correctAnswer === 'string' ? f.correctAnswer : '';
  return parseNumeric(a) !== null ? withUnit(a, q.unit) : a;
}

/** Answer kinds offered for an output-prediction question, cppquiz style. */
export function outputKindsFor(
  language: Language,
): { kind: OutputKind; label: string; hint: string }[] {
  const prints = {
    kind: 'output' as const,
    label: 'Prints exactly',
    hint: 'Type the output. Whitespace is collapsed when comparing.',
  };
  if (language === 'cpp') {
    return [
      prints,
      { kind: 'compile_error', label: 'Compile error', hint: 'The program is ill-formed.' },
      {
        kind: 'undefined',
        label: 'Undefined behaviour',
        hint: 'The standard places no requirements on the result.',
      },
      {
        kind: 'unspecified',
        label: 'Unspecified / implementation-defined',
        hint: 'Valid, but the output depends on the implementation.',
      },
    ];
  }
  return [
    prints,
    {
      kind: 'runtime_error',
      label: language === 'python' ? 'Raises an exception' : 'Throws an exception',
      hint:
        language === 'python'
          ? 'An uncaught exception ends the program.'
          : 'An uncaught exception or error ends the program.',
    },
  ];
}

export const OUTPUT_KIND_LABEL: Record<OutputKind, string> = {
  output: 'Prints',
  compile_error: 'Compile error',
  undefined: 'Undefined behaviour',
  unspecified: 'Unspecified / implementation-defined',
  runtime_error: 'Runtime error',
};

export function formatOutputAnswer(a: OutputAnswer): string {
  return a.kind === 'output' ? a.output : OUTPUT_KIND_LABEL[a.kind];
}

export const choiceLetter = (i: number) => String.fromCharCode(65 + i);

function choiceLabel(q: PublicQuizQuestion, id: string): string {
  const i = q.choices?.findIndex((c) => c.id === id) ?? -1;
  const c = i >= 0 ? q.choices?.[i] : undefined;
  return c ? `${choiceLetter(i)}. ${c.text}` : id;
}

/** Human summary of what the user answered. */
export function formatResponse(q: PublicQuizQuestion, r: QuizResponse | undefined): string | null {
  if (!r) return null;
  switch (r.type) {
    case 'single':
      return choiceLabel(q, r.choice);
    case 'multiple':
      return r.choices.map((id) => choiceLabel(q, id)).join('\n');
    case 'output':
      return r.answer.kind === 'output' ? r.answer.output : OUTPUT_KIND_LABEL[r.answer.kind];
    case 'short':
      return r.text;
    case 'numeric':
      return withUnit(r.value, q.unit);
  }
}

/** Human summary of the correct answer from feedback (Markdown for numeric and short ones). */
export function formatCorrect(q: PublicQuizQuestion, f: AnswerFeedback): string {
  if (q.type === 'numeric') return numericCorrect(q, f);
  const a = f.correctAnswer;
  if (typeof a === 'string') return q.type === 'single' ? choiceLabel(q, a) : a;
  if (Array.isArray(a)) return a.map((id) => choiceLabel(q, id)).join('\n');
  return formatOutputAnswer(a);
}

/** Correct choice ids from feedback (single/multiple), else empty. */
export function correctChoiceIds(f: AnswerFeedback | undefined): string[] {
  if (!f) return [];
  if (typeof f.correctAnswer === 'string') return [f.correctAnswer];
  if (Array.isArray(f.correctAnswer)) return f.correctAnswer;
  return [];
}

export type Outcome = 'correct' | 'partial' | 'incorrect' | 'pending';

export function outcomeOf(f: AnswerFeedback | undefined): Outcome | null {
  if (!f) return null;
  if (f.needsSelfGrade) return 'pending';
  if (f.correct) return 'correct';
  return f.score > 0 ? 'partial' : 'incorrect';
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  correct: 'Correct',
  partial: 'Partly correct',
  incorrect: 'Incorrect',
  pending: 'Grade yourself',
};

export const TYPE_LABEL: Record<PublicQuizQuestion['type'], string> = {
  single: 'Single choice',
  multiple: 'Select all that apply',
  output: 'What does this program do?',
  short: 'Open question',
  numeric: 'Numeric answer',
};

export const GRADED_BY_LABEL: Record<AnswerFeedback['gradedBy'], string> = {
  auto: 'Graded automatically',
  ai: 'Graded by the AI against key points',
  self: 'Self-graded',
};

/** Markdown emphasis, headings, quotes and links as their text. */
const stripMarkdown = (md: string) =>
  md
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/(^|\s)[#>]+\s/g, '$1')
    .replace(/\*/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/**
 * A markdown prompt as one line of plain text and inline math, for compact lists: code blocks
 * dropped, code spans and emphasis as their text, cut to `max` characters but never inside a
 * formula. The dollars of a code span stay text: a math segment is only ever real math.
 */
export function summarySegments(md: string, max = 140): Segment[] {
  const parts: Segment[] = [];
  const push = (kind: Segment['kind'], text: string) => {
    const last = parts.at(-1);
    if (kind === 'text' && last?.kind === 'text') last.text += text;
    else parts.push({ kind, text });
  };
  for (const s of splitMath(md.replace(/```[\s\S]*?```/g, ' '))) {
    if (s.kind === 'math') {
      // Display math becomes inline: a summary is one line.
      const tex = s.text.startsWith('$$') ? s.text.slice(2, -2) : s.text.slice(1, -1);
      push('math', `$${tex.replace(/\s+/g, ' ').trim()}$`);
    } else if (s.kind === 'code') push('text', s.text.replace(/^(`+)([\s\S]*)\1$/, '$2'));
    else push('text', stripMarkdown(s.text));
  }
  for (const p of parts) if (p.kind === 'text') p.text = p.text.replace(/\s+/g, ' ');
  const first = parts[0];
  if (first?.kind === 'text') first.text = first.text.trimStart();
  const last = parts.at(-1);
  if (last?.kind === 'text') last.text = last.text.trimEnd();

  const length = parts.reduce((n, p) => n + p.text.length, 0);
  if (length <= max) return parts.filter((p) => p.text);
  // max - 1 characters and an ellipsis; a formula that does not fit is left out whole.
  const out: Segment[] = [];
  let room = max - 1;
  for (const p of parts) {
    if (p.text.length <= room) {
      out.push(p);
      room -= p.text.length;
      continue;
    }
    if (p.kind === 'text') out.push({ kind: 'text', text: p.text.slice(0, room) });
    break;
  }
  const end = out.at(-1);
  if (end?.kind === 'text') end.text = `${end.text.trimEnd()}…`;
  else out.push({ kind: 'text', text: '…' });
  return out.filter((p) => p.text);
}

/** First line of a markdown prompt as plain text, for compact lists (math left as `$…$`). */
export function promptSummary(md: string, max = 140): string {
  return summarySegments(md, max)
    .map((s) => s.text)
    .join('');
}

/** Map a key press to a choice index: 1-9 or A-Z (case-insensitive). */
export function choiceIndexForKey(key: string, count: number): number | null {
  let i: number | null = null;
  if (/^[1-9]$/.test(key)) i = Number(key) - 1;
  else if (/^[a-z]$/i.test(key)) i = key.toUpperCase().charCodeAt(0) - 65;
  return i !== null && i < count ? i : null;
}

/**
 * The draft after a choice shortcut: 1-9 / A-Z pick a choice (toggle for multiple), 1-9 pick an
 * output kind. Null when the key does nothing for this question.
 */
export function draftForKey(q: PublicQuizQuestion, draft: Draft, key: string): Draft | null {
  if ((draft.type === 'single' || draft.type === 'multiple') && q.choices) {
    const i = choiceIndexForKey(key, q.choices.length);
    const c = i === null ? undefined : q.choices[i];
    if (!c) return null;
    if (draft.type === 'single') return { type: 'single', choice: c.id };
    return {
      type: 'multiple',
      choices: draft.choices.includes(c.id)
        ? draft.choices.filter((x) => x !== c.id)
        : [...draft.choices, c.id],
    };
  }
  if (draft.type === 'output' && /^[1-9]$/.test(key)) {
    const k = outputKindsFor(q.code?.language ?? 'cpp')[Number(key) - 1];
    return k ? { ...draft, kind: k.kind } : null;
  }
  return null;
}

/** Where to resume: the first question without a response (practice: without settled feedback). */
export function resumeIndex(
  questions: PublicQuizQuestion[],
  responses: Record<string, QuizResponse>,
  feedback: AnswerFeedback[],
  mode: QuizMode,
): number {
  const done = (q: PublicQuizQuestion) => {
    if (mode === 'exam') return Boolean(responses[q.id]);
    const f = feedback.find((x) => x.questionId === q.id);
    return Boolean(f && !f.needsSelfGrade);
  };
  const i = questions.findIndex((q) => !done(q));
  return i === -1 ? Math.max(0, questions.length - 1) : i;
}

// ---------------------------------------------------------------- quiz setup (the hub's choices)

export const MODE_LABEL: Record<QuizMode, string> = {
  practice: 'Practice',
  exam: 'Exam',
  discussion: 'Discussion',
};

export const MODE_HINT: Record<QuizMode, string> = {
  practice:
    'Multiple choice, numeric answers and "what does this print". You see the answer after each question.',
  exam: 'The same kind of questions, with the answers held back until you finish.',
  discussion:
    'Open questions, talked through with an AI interviewer who asks follow-ups and then grades you.',
};

export const QUIZ_COUNTS = ['5', '10', '20', '30'] as const;
/** A discussion question takes a few minutes, so fewer of them. */
export const DISCUSSION_COUNTS = ['3', '5', '10'] as const;

/** Rounds started in one click (a roadmap area, a topic on the Quant page): how many questions. */
export const PRACTICE_ROUND = 10;
export const DISCUSSION_ROUND = 5;

/** What the hub remembers between visits (kept in this browser). */
export interface QuizSetup {
  topics: string[];
  mode: QuizMode;
  difficulty: 'any' | 'easy' | 'medium' | 'hard';
  count: (typeof QUIZ_COUNTS)[number];
  discussionCount: (typeof DISCUSSION_COUNTS)[number];
  focusWeak: boolean;
}

export const DEFAULT_SETUP: QuizSetup = {
  topics: [],
  mode: 'practice',
  difficulty: 'any',
  count: '10',
  discussionCount: '5',
  focusWeak: true,
};

export const SETUP_STORAGE_KEY = 'ipp.quiz.setup';

/** A stored setup, field by field: anything missing or no longer valid falls back to the default. */
export function parseSetup(raw: unknown): QuizSetup {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    topics: Array.isArray(r.topics)
      ? [...new Set(r.topics.filter((t): t is string => typeof t === 'string'))]
      : [],
    mode: pick(r.mode, ['practice', 'exam', 'discussion'], DEFAULT_SETUP.mode),
    difficulty: pick(r.difficulty, ['any', 'easy', 'medium', 'hard'], DEFAULT_SETUP.difficulty),
    count: pick(r.count, QUIZ_COUNTS, DEFAULT_SETUP.count),
    discussionCount: pick(r.discussionCount, DISCUSSION_COUNTS, DEFAULT_SETUP.discussionCount),
    focusWeak: typeof r.focusWeak === 'boolean' ? r.focusWeak : DEFAULT_SETUP.focusWeak,
  };
}

/** How many questions a topic has for a mode: open ones for a discussion, the rest otherwise. */
export function questionsFor(
  t: { questionCount: number; shortCount: number },
  mode: QuizMode,
): number {
  return mode === 'discussion' ? t.shortCount : t.questionCount - t.shortCount;
}

// ---------------------------------------------------------------- tracks

export interface TrackGroup<T> {
  track: QuizTrack;
  label: string;
  description: string;
  items: T[];
}

/**
 * Topics by track, in `QUIZ_TRACKS` order, each keeping the order it was given in (the server's
 * study order). A track with no topic is left out, so one group means there is nothing to head.
 */
export function groupByTrack<T extends { track: QuizTrack }>(items: T[]): TrackGroup<T>[] {
  return QUIZ_TRACKS.map((track) => ({
    track,
    ...QUIZ_TRACK_INFO[track],
    items: items.filter((t) => t.track === track),
  })).filter((g) => g.items.length > 0);
}
