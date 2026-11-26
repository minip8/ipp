/**
 * Quant rooms (ARCHITECTURE §8.4): a pad of kind `room` and format `quant`, in which a person
 * (the host) interviews a candidate on questions of the bank, the way a coding room interviews
 * on a library problem. The round's state is a hosted `QuantRoundState` (quant-round.ts), moved
 * only by the host's steps; this module holds what the host's routes take and return, and the
 * pure helpers both sides of a quant room use.
 *
 * Everything here except `hostedPrompt` / `hostedPick` (what the candidate is shown when a
 * question is posed) and the request bodies is HOST-ONLY: it carries answers, key points,
 * explanations, hint ladders and follow-ups, the host's verdicts and the queue.
 */
import { z } from 'zod';
import { IsoDate, LANGUAGE_LABELS, Slug } from './common';
import {
  QUANT_QUEUE_MAX,
  QuantClosedBy,
  QuantPhase,
  type QuantPick,
  QuantQuestionType,
  QuantVerdict,
} from './quant-round';
import {
  AnswerFeedback,
  NumericToleranceSpec,
  PublicQuizQuestion,
  QuizDifficulty,
  type QuizQuestion,
  QuizTrack,
} from './quiz';

// ---------------------------------------------------------------- what the candidate is shown

/** A fence longer than any run of backticks in `code`, so the program cannot close it. */
function fence(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const FENCE_LANGUAGE = { cpp: 'cpp', python: 'python', java: 'java' } as const;

/**
 * The text a hosted round posts for a bank question, and the candidate's panel shows: Markdown,
 * like every prompt. A short or numeric question is its prompt. A choice question's options and
 * an output question's program are composed into it, so the chat message, the panel, voice, the
 * transcript and the AI's material all hold the same one text and no surface needs a renderer
 * of its own. No answer, explanation or hint is ever part of it.
 */
export function hostedPrompt(q: QuizQuestion): string {
  const prompt = q.prompt.trim();
  switch (q.type) {
    case 'single':
    case 'multiple': {
      const options = q.choices.map((c) => `- **(${c.id})** ${c.text.trim()}`).join('\n');
      const how = q.type === 'single' ? 'Choose one.' : 'Choose every option that applies.';
      return `${prompt}\n\n${options}\n\n*${how}*`;
    }
    case 'output': {
      const f = fence(q.code);
      return [
        prompt,
        `${f}${FENCE_LANGUAGE[q.language]}\n${q.code.replace(/\n+$/, '')}\n${f}`,
        `*${LANGUAGE_LABELS[q.language]}, ${q.standard}.* Say what it prints, or that it does not compile, fails at runtime, has undefined behaviour or prints something unspecified.`,
      ].join('\n\n');
    }
    case 'short':
    case 'numeric':
      return prompt;
  }
}

/** What a hosted round records of a bank question when the host poses it (`pose`). */
export function hostedPick(q: QuizQuestion, topicTitle: string = q.topic): QuantPick {
  return {
    questionId: q.id,
    topic: q.topic,
    topicTitle,
    difficulty: q.difficulty,
    type: q.type,
    prompt: hostedPrompt(q),
    unit: q.type === 'numeric' ? (q.unit ?? null) : null,
    hintsAvailable: q.type === 'short' || q.type === 'numeric' ? (q.hints ?? []).length : 0,
  };
}

// ---------------------------------------------------------------- what the host is shown

/** A question's answer as a person reads it (Markdown), whatever its type. HOST-ONLY. */
export function quizSolution(q: QuizQuestion): string {
  const choice = (id: string) => {
    const c =
      q.type === 'single' || q.type === 'multiple' ? q.choices.find((x) => x.id === id) : null;
    return `**(${id})** ${c?.text.trim() ?? ''}`.trim();
  };
  switch (q.type) {
    case 'single':
      return choice(q.answer);
    case 'multiple':
      return q.answer.map((id) => `- ${choice(id)}`).join('\n');
    case 'output': {
      const a = q.answer;
      if (a.kind === 'output') {
        const f = fence(a.output);
        return `It prints:\n\n${f}\n${a.output.replace(/\n+$/, '')}\n${f}`;
      }
      return {
        compile_error: 'It does not compile.',
        undefined: 'Undefined behaviour.',
        unspecified: 'What it prints is unspecified (or implementation-defined).',
        runtime_error: 'It fails at runtime (raises or throws).',
      }[a.kind];
    }
    case 'short':
      return q.reference;
    case 'numeric': {
      const answer = q.answerText ?? q.answer;
      return q.unit ? `${answer} ${q.unit}` : answer;
    }
  }
}

/**
 * A bank question with everything an interviewer needs to run it, for the host of a quant room
 * only (`GET …/host`, the host's bank search). The public projection (`PublicQuizQuestion`: the
 * prompt, choices, code, unit) plus the solution and the interviewer's material. This is the
 * one place a question's `hints` and `followUps` leave the server: to the host who asks them,
 * as a coding room's host reads the problem's interviewer notes.
 */
export const HostQuestionMaterial = PublicQuizQuestion.extend({
  topicTitle: z.string(),
  /** Markdown: the answer as a person reads it (`quizSolution`). */
  solution: z.string(),
  /** As in `AnswerFeedback`: the choice id(s), the `OutputAnswer`, the reference, or the number. */
  correctAnswer: AnswerFeedback.shape.correctAnswer,
  /** A short question's key points; empty for the other types. */
  keyPoints: z.array(z.string()),
  explanation: z.string(),
  /** The hint ladder, gentlest first (short and numeric questions; empty for the others). */
  hints: z.array(z.string()),
  /** What to ask once the answer is in (short and numeric questions; empty for the others). */
  followUps: z.array(z.string()),
  /** A numeric question's tolerance, when it has one. */
  tolerance: NumericToleranceSpec.nullable(),
});
export type HostQuestionMaterial = z.infer<typeof HostQuestionMaterial>;

/** A question the host posed, with its bookkeeping. */
export const HostRoundQuestion = z.object({
  index: z.int().min(0),
  questionId: Slug,
  topic: Slug,
  topicTitle: z.string(),
  difficulty: QuizDifficulty,
  type: QuantQuestionType,
  /** Exactly what was posed (`hostedPrompt`), as the candidate saw it. */
  prompt: z.string(),
  posedAt: IsoDate,
  /** The `question` message that posed it. */
  posedMessageId: z.string().nullable(),
  closedAt: IsoDate.nullable(),
  /** `interviewer`: the host closed it (or posed the next one); `ended`: open when the pad ended. */
  closedBy: QuantClosedBy.nullable(),
  /** Whole seconds it was open; null while it is. */
  timeSec: z.int().nullable(),
  /** The hints recorded, in order: the authored rung (1-based, see `material.hints`) or 0 for one of the host's own. */
  hintRungs: z.array(z.int().min(0)),
  followUpAsked: z.boolean(),
  /** The host's verdict; null until given. */
  verdict: QuantVerdict.nullable(),
  /** The bank question in full; null if it has left the bank since (the snapshot above remains). */
  material: HostQuestionMaterial.nullable(),
});
export type HostRoundQuestion = z.infer<typeof HostRoundQuestion>;

/** One question the host has lined up. */
export const HostQueueItem = z.object({
  questionId: Slug,
  /** null if it is no longer an active question of the bank (it cannot be posed then). */
  material: HostQuestionMaterial.nullable(),
});
export type HostQueueItem = z.infer<typeof HostQueueItem>;

/** `HostView.round`: a quant room's round as its host sees it. HOST-ONLY. */
export const HostRoundView = z.object({
  /** `quant_rounds.version`, as in the candidate's `QuantRoundView`. */
  version: z.int().min(0),
  /** As `QuantRoundView.phase` (a hosted round's `finished` means no question is open). */
  phase: QuantPhase,
  /** The pad has ended: nothing more can be posed, and only missing verdicts can be given. */
  ended: z.boolean(),
  /** Index of the open question; null when none is. */
  open: z.int().min(0).nullable(),
  /** Every question posed, in the order posed (the open one last). */
  questions: z.array(HostRoundQuestion),
  /** What the host lined up, in order. */
  queue: z.array(HostQueueItem),
});
export type HostRoundView = z.infer<typeof HostRoundView>;

// ---------------------------------------------------------------- the host's requests

/** `PUT /api/pads/:id/host/round/queue`: the whole queue, in order (reorder, add, remove). */
export const UpdateQuantQueueRequest = z.object({
  questionIds: z.array(Slug).max(QUANT_QUEUE_MAX),
});
export type UpdateQuantQueueRequest = z.infer<typeof UpdateQuantQueueRequest>;

/** `POST /api/pads/:id/host/round/pose`: any active bank question, queued or not. */
export const PoseQuantQuestionRequest = z.object({ questionId: Slug });
export type PoseQuantQuestionRequest = z.infer<typeof PoseQuantQuestionRequest>;

/**
 * `POST /api/pads/:id/host/round/hint`: the host gave a hint on the open question `index`:
 * `rung` the next authored rung (1-based) or 0 for one in their own words.
 */
export const RecordQuantHintRequest = z.object({
  index: z.int().min(0),
  rung: z.int().min(0),
});
export type RecordQuantHintRequest = z.infer<typeof RecordQuantHintRequest>;

/** `POST /api/pads/:id/host/round/follow-up`: the host asked the open question's follow-up. */
export const RecordQuantFollowUpRequest = z.object({ index: z.int().min(0) });
export type RecordQuantFollowUpRequest = z.infer<typeof RecordQuantFollowUpRequest>;

/** The host's verdict as sent: a score from 0 to 1 and a note (which may be empty). */
export const HostVerdictInput = z.object({
  score: z.number().min(0).max(1),
  summary: z.string().trim().max(4000),
});
export type HostVerdictInput = z.infer<typeof HostVerdictInput>;

/** `POST /api/pads/:id/host/round/close`: closes the open question `index`, with a verdict or none. */
export const CloseQuantQuestionRequest = z.object({
  index: z.int().min(0),
  verdict: HostVerdictInput.nullable().default(null),
});
export type CloseQuantQuestionRequest = z.infer<typeof CloseQuantQuestionRequest>;

/** `PUT /api/pads/:id/host/round/verdict`: gives or changes the verdict on closed question `index`. */
export const SetQuantVerdictRequest = z.object({
  index: z.int().min(0),
  verdict: HostVerdictInput,
});
export type SetQuantVerdictRequest = z.infer<typeof SetQuantVerdictRequest>;

// ---------------------------------------------------------------- the host's bank search

/** A query-string parameter that may be left empty (`?q=`): empty reads as absent. */
const param = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

/**
 * `GET /api/pads/:id/host/round/bank?…`, the query string. Every filter is optional (an empty
 * one reads as absent); `q` matches the prompt, the subtopic or the id (case-insensitive
 * substring).
 */
export const HostBankQuery = z.object({
  track: param(QuizTrack),
  topic: param(Slug),
  subtopic: param(z.string().trim().max(200)),
  difficulty: param(QuizDifficulty),
  type: param(QuantQuestionType),
  q: param(z.string().trim().max(200)),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type HostBankQuery = z.infer<typeof HostBankQuery>;

/** `available`: can be posed or queued; `queued`: in the queue; `posed`: already asked in this room. */
export const HostBankStatus = z.enum(['available', 'queued', 'posed']);
export type HostBankStatus = z.infer<typeof HostBankStatus>;

export const HostBankItem = HostQuestionMaterial.extend({ status: HostBankStatus });
export type HostBankItem = z.infer<typeof HostBankItem>;

export const HostBankPage = z.object({
  /** Questions matching every filter. */
  total: z.int().min(0),
  limit: z.int(),
  offset: z.int(),
  /** This page, in study order: track, topic, subtopic, easy to hard, id. */
  items: z.array(HostBankItem),
  /**
   * Every topic that has active questions, with how many (unfiltered), quant first and then in
   * study order: for the filter.
   */
  topics: z.array(
    z.object({ slug: Slug, title: z.string(), track: QuizTrack, questionCount: z.int() }),
  ),
  /** The subtopics of `topic` when the query names one (empty otherwise), sorted. */
  subtopics: z.array(z.string()),
});
export type HostBankPage = z.infer<typeof HostBankPage>;

// ---------------------------------------------------------------- AI for the host

/**
 * `POST /api/pads/:id/host/round/review`: the AI's second opinion on a question, for the host on
 * the host's key. `index` defaults to the open question; `question` is something the host wants
 * checked, in their own words.
 */
export const QuantSecondOpinionRequest = z.object({
  index: z.int().min(0).optional(),
  question: z.string().trim().max(1000).optional(),
});
export type QuantSecondOpinionRequest = z.infer<typeof QuantSecondOpinionRequest>;

/** Returned to the host only; neither stored nor broadcast. */
export const QuantSecondOpinion = z.object({
  index: z.int().min(0),
  /**
   *  correct         the candidate has the answer, with sound reasoning
   *  partly_correct  on the right track, or right with a gap in the reasoning
   *  incorrect       a wrong answer or a wrong method
   *  not_yet         nothing to judge yet: no answer and no committed approach
   *  unclear         the record does not say (most of it was said aloud, say)
   */
  verdict: z.enum(['correct', 'partly_correct', 'incorrect', 'not_yet', 'unclear']),
  summary: z.string(),
  /** The key points or steps the candidate has got. */
  covered: z.array(z.string()),
  /** What is missing or wrong, each concrete. */
  missing: z.array(z.string()),
  /** Questions the host could ask next, worded so as not to give the answer away. */
  followUps: z.array(z.string()),
  /** A score the AI would give now, 0..1; null when there is nothing to score yet. */
  suggestedScore: z.number().min(0).max(1).nullable(),
  /** The answer to the host's own question, when one was asked. */
  answer: z.string().nullable(),
  model: z.string(),
  createdAt: IsoDate,
});
export type QuantSecondOpinion = z.infer<typeof QuantSecondOpinion>;
