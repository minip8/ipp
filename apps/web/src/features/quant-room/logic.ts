/**
 * Pure rules for a quant room (ARCHITECTURE §8.4), the host's side and the candidate's: the
 * queue, the hint ladder, the bank browser's query and its page (from the host's bank search in
 * the room, or put together in the browser from the public question bank before the room
 * exists), the verdict form and the labels. Nothing here talks to the network.
 */
import {
  type HostBankPage,
  type HostBankQuery,
  type HostBankStatus,
  type HostQuestionMaterial,
  type HostRoundQuestion,
  type HostRoundView,
  LANGUAGE_LABELS,
  type PublicQuizQuestion,
  QUANT_HOSTED_HINTS_MAX,
  QUANT_QUEUE_MAX,
  type QuantQuestionType,
  type QuantRoundView,
  type QuantSecondOpinion,
  type QuizBank,
  type QuizDifficulty,
  type Track,
} from '@ipp/contracts';
import { formatClock, plural } from '@/lib/format';
import { topicsOf } from '@/lib/track';

// ---------------------------------------------------------------- labels

export const TYPE_LABEL: Record<QuantQuestionType, string> = {
  single: 'Single choice',
  multiple: 'Multiple choice',
  output: 'Program output',
  short: 'Open-ended',
  numeric: 'Numeric',
};

export const STATUS_LABEL: Record<HostBankStatus, string | null> = {
  available: null,
  queued: 'Queued',
  posed: 'Asked',
};

// ---------------------------------------------------------------- what the candidate is shown

const FENCE_LANGUAGE = { cpp: 'cpp', python: 'python', java: 'java' } as const;

function fence(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The text the candidate will see when this question is posed, from its public projection: the
 * same composition as the server's `hostedPrompt` (a choice question's options and an output
 * question's program in the prompt), so the host previews exactly what will be shown.
 */
export function composedPrompt(
  q: Pick<PublicQuizQuestion, 'type' | 'prompt' | 'choices' | 'code'>,
): string {
  const prompt = q.prompt.trim();
  if ((q.type === 'single' || q.type === 'multiple') && q.choices) {
    const options = q.choices.map((c) => `- **(${c.id})** ${c.text.trim()}`).join('\n');
    const how = q.type === 'single' ? 'Choose one.' : 'Choose every option that applies.';
    return `${prompt}\n\n${options}\n\n*${how}*`;
  }
  if (q.type === 'output' && q.code) {
    const f = fence(q.code.source);
    return [
      prompt,
      `${f}${FENCE_LANGUAGE[q.code.language]}\n${q.code.source.replace(/\n+$/, '')}\n${f}`,
      `*${LANGUAGE_LABELS[q.code.language]}, ${q.code.standard}.* Say what it prints, or that it does not compile, fails at runtime, has undefined behaviour or prints something unspecified.`,
    ].join('\n\n');
  }
  return prompt;
}

/** A one-line summary of a prompt for a list row: Markdown and math left as written, no newlines. */
export function promptLine(prompt: string, max = 160): string {
  const line = prompt
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

// ---------------------------------------------------------------- the queue

/** The queue's question ids, in order. */
export const queueIds = (round: Pick<HostRoundView, 'queue'>): string[] =>
  round.queue.map((q) => q.questionId);

/** `id` added at the end, unless it is there already or the queue is full. */
export function addToQueue(ids: readonly string[], id: string): string[] {
  if (ids.includes(id) || ids.length >= QUANT_QUEUE_MAX) return [...ids];
  return [...ids, id];
}

export const removeFromQueue = (ids: readonly string[], id: string): string[] =>
  ids.filter((x) => x !== id);

/** `id` moved `delta` places (−1 up, +1 down), kept within the queue. */
export function moveInQueue(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  if (to === from) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** The first queued question that can still be posed (one that left the bank cannot). */
export function nextInQueue(round: Pick<HostRoundView, 'queue'>) {
  return round.queue.find((q) => q.material !== null) ?? null;
}

// ---------------------------------------------------------------- the round

/** The open question, if one is. */
export function openQuestion(round: HostRoundView | null): HostRoundQuestion | null {
  if (!round || round.open === null) return null;
  return round.questions.find((q) => q.index === round.open) ?? null;
}

/** The newer of two host views of a round (a host route's answer and a refetch may cross). */
export function newerHostRound(
  a: HostRoundView | null | undefined,
  b: HostRoundView,
): HostRoundView {
  return a && a.version > b.version ? a : b;
}

/** How many authored rungs were recorded (a rung of 0 is one in the host's own words). */
export const authoredGiven = (q: Pick<HostRoundQuestion, 'hintRungs'>) =>
  q.hintRungs.filter((r) => r > 0).length;

export const ownGiven = (q: Pick<HostRoundQuestion, 'hintRungs'>) =>
  q.hintRungs.filter((r) => r === 0).length;

/** Whether another hint of any kind can be recorded on the question. */
export const canRecordHint = (q: Pick<HostRoundQuestion, 'hintRungs'>) =>
  q.hintRungs.length < QUANT_HOSTED_HINTS_MAX;

/** The next authored rung (1-based) the host would give, or null once the ladder is used up. */
export function nextRung(
  q: Pick<HostRoundQuestion, 'hintRungs'>,
  ladder: readonly string[],
): number | null {
  const given = authoredGiven(q);
  return given < ladder.length && canRecordHint(q) ? given + 1 : null;
}

export type Rung = { rung: number; text: string; state: 'given' | 'next' | 'later' };

/** The ladder as the host reads it: what was given, the one to give next, and the rest. */
export function hintLadder(
  q: Pick<HostRoundQuestion, 'hintRungs'>,
  ladder: readonly string[],
): Rung[] {
  const given = authoredGiven(q);
  const next = nextRung(q, ladder);
  return ladder.map((text, i) => ({
    rung: i + 1,
    text,
    state: i < given ? 'given' : i + 1 === next ? 'next' : 'later',
  }));
}

/** Seconds a question has been open (or was, once closed). */
export function openSeconds(
  q: Pick<HostRoundQuestion, 'posedAt' | 'closedAt' | 'timeSec'>,
  now: number,
): number {
  if (q.timeSec !== null) return q.timeSec;
  const end = q.closedAt ? Date.parse(q.closedAt) : now;
  return Math.max(0, Math.floor((end - Date.parse(q.posedAt)) / 1000));
}

/** "3 hints: rungs 1 and 2, and one of your own"; "No hints". */
export function hintsSummary(rungs: readonly number[], own = 'of your own'): string {
  if (rungs.length === 0) return 'No hints';
  const authored = rungs.filter((r) => r > 0);
  const mine = rungs.length - authored.length;
  const parts: string[] = [];
  if (authored.length)
    parts.push(
      authored.length === 1
        ? `rung ${authored[0]}`
        : `rungs ${authored.slice(0, -1).join(', ')} and ${authored.at(-1)}`,
    );
  if (mine) parts.push(`${mine === 1 ? 'one' : mine} ${own}`);
  return `${plural(rungs.length, 'hint')}: ${parts.join(', and ')}`;
}

// ---------------------------------------------------------------- verdicts

/** The scores the verdict form offers in one tap. */
export const SCORE_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;

export const SCORE_LABEL: Record<(typeof SCORE_STEPS)[number], string> = {
  0: 'Missed',
  0.25: 'Weak',
  0.5: 'Partly',
  0.75: 'Good',
  1: 'Full',
};

export const pct = (score: number) => `${Math.round(score * 100)}%`;

/** The score step nearest a score (the AI's suggestion is in hundredths). */
export function nearestStep(score: number): (typeof SCORE_STEPS)[number] {
  let best: (typeof SCORE_STEPS)[number] = SCORE_STEPS[0];
  for (const s of SCORE_STEPS) if (Math.abs(s - score) < Math.abs(best - score)) best = s;
  return best;
}

export type VerdictDraft = { score: number | null; summary: string };
export const EMPTY_VERDICT: VerdictDraft = { score: null, summary: '' };

/** What the close and verdict routes take from the form: no score means no verdict. */
export function verdictOf(d: VerdictDraft): { score: number; summary: string } | null {
  if (d.score === null) return null;
  return { score: d.score, summary: d.summary.trim().slice(0, 4000) };
}

/** Whether a closed question's verdict can be given or changed now (§8.4: after the end, only a missing one). */
export const verdictEditable = (
  q: Pick<HostRoundQuestion, 'closedAt' | 'verdict'>,
  ended: boolean,
) => q.closedAt !== null && (!ended || q.verdict === null);

// ---------------------------------------------------------------- the second opinion

type Tone = 'ok' | 'bad' | 'warn' | 'neutral';
export const OPINION_VERDICT: Record<QuantSecondOpinion['verdict'], { label: string; tone: Tone }> =
  {
    correct: { label: 'Correct', tone: 'ok' },
    partly_correct: { label: 'Partly correct', tone: 'warn' },
    incorrect: { label: 'Incorrect', tone: 'bad' },
    not_yet: { label: 'Nothing to judge yet', tone: 'neutral' },
    unclear: { label: 'Cannot tell', tone: 'neutral' },
  };

/** Which question a second opinion is about by default: the open one, else the last asked. */
export function defaultOpinionIndex(round: HostRoundView | null): number | null {
  if (!round) return null;
  return round.open ?? round.questions.at(-1)?.index ?? null;
}

// ---------------------------------------------------------------- the candidate's view

/**
 * What the candidate's question panel says when no question is open in a hosted round: waiting
 * for the first, between questions, or the room has ended.
 */
export function hostedWaiting(
  round: Pick<QuantRoundView, 'questions'>,
  ended: boolean,
): { title: string; body: string } {
  if (ended)
    return {
      title: 'The interview has ended',
      body:
        round.questions.length === 0
          ? 'No question was asked.'
          : `${plural(round.questions.length, 'question')} asked. They are listed below.`,
    };
  if (round.questions.length === 0)
    return {
      title: 'Your interviewer will post a question here',
      body: 'When they do, it shows here and in the chat. Until then, say hello in the chat; the scratchpad and whiteboard are shared.',
    };
  return {
    title: 'Waiting for the next question',
    body: 'Your interviewer closed the last one. The next appears here when they post it.',
  };
}

/** The end dialog's line for a quant room. */
export function hostedEndNote(round: Pick<QuantRoundView, 'questions' | 'phase'>): string {
  const asked = round.questions.length;
  if (asked === 0)
    return 'No question was asked. The report keeps the chat, the scratchpad and your notes.';
  const open = round.phase === 'asking';
  return open
    ? `Question ${asked} is still open: ending closes it as unfinished. You can still give a verdict on any question that has none in the report.`
    : `${plural(asked, 'question')} asked. You can still give a verdict on any question that has none in the report.`;
}

// ---------------------------------------------------------------- the bank browser

/**
 * The browser's filters; `undefined` is "any". `track` is a site track (`topicInTrack`: a topic
 * shared into a track is in it), offered where the browser filters itself (the public bank).
 */
export type BankQuery = {
  track?: Track;
  topic?: string;
  subtopic?: string;
  difficulty?: QuizDifficulty;
  type?: QuantQuestionType;
  q?: string;
  offset: number;
};

export const BANK_PAGE = 30;
export const NO_BANK_FILTERS: BankQuery = { offset: 0 };

/** A change of filter starts again at the first page; a topic of the other track clears it. */
export function withFilter(query: BankQuery, patch: Partial<Omit<BankQuery, 'offset'>>): BankQuery {
  const next: BankQuery = { ...query, ...patch, offset: 0 };
  if ('topic' in patch && patch.topic !== query.topic) next.subtopic = undefined;
  if ('track' in patch && patch.track !== query.track) {
    next.topic = undefined;
    next.subtopic = undefined;
  }
  for (const k of Object.keys(next) as (keyof BankQuery)[])
    if (next[k] === undefined || next[k] === '') delete next[k];
  return next;
}

export const filtersActive = (q: BankQuery) =>
  Boolean(q.track || q.topic || q.subtopic || q.difficulty || q.type || q.q?.trim());

/**
 * The host's bank search's query string (`HostBankQuery`) for these filters. Its `track` is a
 * topic's home, not a site track, so the desk's browser offers no track filter and none is sent.
 */
export function hostBankParams(query: BankQuery, limit = BANK_PAGE): Partial<HostBankQuery> {
  return {
    ...(query.topic ? { topic: query.topic } : {}),
    ...(query.subtopic ? { subtopic: query.subtopic } : {}),
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.q?.trim() ? { q: query.q.trim() } : {}),
    limit,
    offset: query.offset,
  };
}

/** One row of the browser: the question as it will be posed, with its material when known. */
export type BankItem = {
  question: PublicQuizQuestion & { topicTitle: string };
  /** The solution and interviewer's material (the host's bank search); null before the room exists. */
  material: HostQuestionMaterial | null;
  status: HostBankStatus;
};

/** A topic of the browser's filter; `also` (the site tracks it is shared into) when known. */
export type BankTopic = HostBankPage['topics'][number] & { also?: readonly Track[] };

/** The topics a track filter leaves, in that track's order (its own first, then shared ones). */
export const topicsForTrack = (topics: readonly BankTopic[], track: Track | undefined) =>
  track ? topicsOf(topics, track) : [...topics];

/** A page of the browser, whichever source it came from. */
export type BankView = {
  total: number;
  offset: number;
  limit: number;
  items: BankItem[];
  topics: BankTopic[];
  subtopics: string[];
};

export function fromHostPage(page: HostBankPage): BankView {
  return {
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    topics: page.topics,
    subtopics: page.subtopics,
    items: page.items.map(({ status, ...material }) => ({
      question: material,
      material,
      status,
    })),
  };
}

/**
 * The browser's page put together from the public question bank (`GET /api/quiz/topics/:slug/
 * questions`, prompts only), for building a queue before the room exists: the same filters as
 * the host's bank search (`q` matches the prompt, the subtopic or the id), quant topics first and
 * then each home in study order (with a track filter: that track's own topics, then those shared
 * into it), and `queued` for what is in the queue being built.
 */
export function searchPublicBank(
  banks: readonly QuizBank[],
  query: BankQuery,
  queued: readonly string[],
  limit = BANK_PAGE,
): BankView {
  const ordered = [...banks].sort(
    (a, b) => Number(a.topic.track !== 'quant') - Number(b.topic.track !== 'quant'),
  );
  const topics: BankTopic[] = ordered
    .filter((b) => b.items.length > 0)
    .map((b) => ({
      slug: b.topic.slug,
      title: b.topic.title,
      track: b.topic.track,
      also: b.topic.also,
      questionCount: b.items.length,
    }));
  const inTrack = query.track
    ? topicsOf(
        ordered.map((b) => b.topic),
        query.track,
      )
    : ordered.map((b) => b.topic);
  const searched = inTrack.flatMap((t) => ordered.filter((b) => b.topic.slug === t.slug));
  const text = query.q?.trim().toLowerCase() ?? '';
  const inQueue = new Set(queued);
  const all: BankItem[] = [];
  for (const b of searched) {
    if (query.topic && b.topic.slug !== query.topic) continue;
    for (const { question } of b.items) {
      if (query.subtopic && question.subtopic !== query.subtopic) continue;
      if (query.difficulty && question.difficulty !== query.difficulty) continue;
      if (query.type && question.type !== query.type) continue;
      if (
        text &&
        !question.prompt.toLowerCase().includes(text) &&
        !question.subtopic.toLowerCase().includes(text) &&
        !question.id.toLowerCase().includes(text)
      )
        continue;
      all.push({
        question: { ...question, topicTitle: b.topic.title },
        material: null,
        status: inQueue.has(question.id) ? 'queued' : 'available',
      });
    }
  }
  const subtopics = query.topic
    ? [
        ...new Set(
          banks.find((b) => b.topic.slug === query.topic)?.items.map((i) => i.question.subtopic) ??
            [],
        ),
      ].sort()
    : [];
  return {
    total: all.length,
    offset: query.offset,
    limit,
    items: all.slice(query.offset, query.offset + limit),
    topics,
    subtopics,
  };
}

/** "31–60 of 212". */
export function pageLabel(v: Pick<BankView, 'total' | 'offset' | 'items'>): string {
  if (v.total === 0) return 'No questions';
  return `${v.offset + 1}–${v.offset + v.items.length} of ${v.total}`;
}

// ---------------------------------------------------------------- the queue at creation

/** A question picked for the queue before the room exists: what the list shows of it. */
export type QueuedPick = Pick<
  BankItem['question'],
  'id' | 'topic' | 'topicTitle' | 'difficulty' | 'type' | 'prompt' | 'subtopic' | 'choices' | 'code'
>;

/** "3:05 open". */
export const openLabel = (sec: number) => `${formatClock(sec)} open`;
