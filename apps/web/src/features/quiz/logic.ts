/** Pure helpers for the quiz flow: drafts, responses, answer formatting, outcome. */
import type {
  AnswerFeedback,
  Language,
  OutputAnswer,
  PublicQuizQuestion,
  QuizResponse,
} from '@ipp/contracts';

export type OutputKind = OutputAnswer['kind'];

export type Draft =
  | { type: 'single'; choice: string | null }
  | { type: 'multiple'; choices: string[] }
  | { type: 'output'; kind: OutputKind | null; output: string }
  | { type: 'short'; text: string };

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
  }
}

/** The response to send, or null while the draft is incomplete. */
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
  }
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
  }
}

/** Human summary of the correct answer from feedback. */
export function formatCorrect(q: PublicQuizQuestion, f: AnswerFeedback): string {
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
  short: 'Short answer',
};

export const GRADED_BY_LABEL: Record<AnswerFeedback['gradedBy'], string> = {
  auto: 'Graded automatically',
  ai: 'Graded by the AI against key points',
  self: 'Self-graded',
};

/** First line of a markdown prompt as plain text, for compact lists. */
export function promptSummary(md: string, max = 140): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/(^|\s)[#>]+\s/g, '$1')
    .replace(/\*/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
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
  mode: 'practice' | 'exam',
): number {
  const done = (q: PublicQuizQuestion) => {
    if (mode === 'exam') return Boolean(responses[q.id]);
    const f = feedback.find((x) => x.questionId === q.id);
    return Boolean(f && !f.needsSelfGrade);
  };
  const i = questions.findIndex((q) => !done(q));
  return i === -1 ? Math.max(0, questions.length - 1) : i;
}
