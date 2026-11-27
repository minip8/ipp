/**
 * Mock of staged interviews (`packages/contracts/src/interview.ts`), kept apart from mock-api.ts
 * (which delegates here):
 *
 *   POST   /api/interviews            create it and start stage 0 -> { interview, padId }
 *   GET    /api/interviews            newest first
 *   GET    /api/interviews/:id
 *   POST   /api/interviews/:id/next   { from }: end stage `from`'s pad if still active, start the
 *                                     next (after the last, end the interview: padId null);
 *                                     the interview as it is once it has moved past `from`
 *   POST   /api/interviews/:id/end    end the active pad and the interview
 *   DELETE /api/interviews/:id        the interview and every stage's pad
 *
 * With the API's refusals: 403 for a guest, 409 `ai_key_missing` without a usable key, 404 for an
 * unknown problem, 409 `quant_unavailable` (naming the stage) when a stage's topics are short of
 * questions. A stage's pad is made when it starts, as the API does: a coding pad on the chosen or
 * a random problem, or a quant pad (MockQuantRounds) with no path and the topics' subject.
 * Statuses come from the contract's `stageStatuses`. mock-api.ts adds the rest: `PadDetail.interview`,
 * `in_interview` on deleting a stage's pad, ending the last stage's pad ending the interview, and
 * a stage's report pending or ready as a spec sets it here (`setReport`).
 */
import {
  AdvanceInterviewRequest,
  type AiKeyStatus,
  CreateInterviewRequest,
  type Interview,
  type InterviewSettings,
  type InterviewStage,
  type InterviewStageView,
  type PadDetail,
  type PadInterview,
  type PadSummary,
  type QuantPick,
  quantQuestionCount,
  quantSubject,
  type Recommendation,
  type Report,
  stageStatuses,
  type Track,
} from '@ipp/contracts';
import { makePadDetail, PROBLEMS, QUIZ_TOPICS, uuid } from './fixtures';
import { type BankQuestion, gamePick, ROUND_BANK } from './fixtures-quant-round';
import type { MockQuantRounds } from './mock-quant-round';
import { QUANT_ASSESSMENT } from './mock-quant-round';

/** What the mock needs of MockBackend (an interface, so the two files do not import each other). */
export interface InterviewHost {
  pads: Map<string, PadDetail>;
  summaries: PadSummary[];
  aiKey: AiKeyStatus;
  me: { id: string; guest?: boolean };
  quant: MockQuantRounds;
  removePad(id: string): unknown;
  /** A pad ended (as POST /api/pads/:id/end does it: pad.updated, the round's end). */
  endPadNow(id: string, at: Date): void;
}

type Stored = {
  id: string;
  title: string;
  track: Track;
  preset: string | null;
  ended: boolean;
  current: number;
  stages: InterviewStage[];
  /** Each started stage's pad. */
  padIds: (string | null)[];
  interviewer: InterviewSettings;
  startedAt: string;
  endedAt: string | null;
};

type ReportState = 'pending' | 'ready' | 'failed';

function response(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), { status });
}

const topicTitle = (slug: string) => QUIZ_TOPICS.find((t) => t.slug === slug)?.title ?? slug;

/**
 * A questions stage's picks, as the API's assembler spreads them: one topic after another, the
 * next unused question of each, until the stage has its count. Null when the topics are short.
 */
function stagePicks(topics: readonly string[], count: number): BankQuestion[] | null {
  const byTopic = topics.map((t) => Object.values(ROUND_BANK).filter((q) => q.topic === t));
  const picks: BankQuestion[] = [];
  for (let round = 0; picks.length < count; round++) {
    const before = picks.length;
    for (const list of byTopic) {
      const q = list[round];
      if (q && picks.length < count) picks.push(q);
    }
    if (picks.length === before) return null;
  }
  return picks;
}

export class MockInterviews {
  list: Stored[] = [];
  /** A stage's report, by its pad (absent: ready). */
  reports = new Map<string, ReportState>();
  /** A stage's recommendation, by its pad (absent: the fixture assessment's). */
  recommendations = new Map<string, Recommendation>();
  /** Stage indexes whose start is refused with `quant_unavailable`, whatever their topics. */
  unavailable = new Set<number>();

  constructor(private host: InterviewHost) {}

  // ---------------------------------------------------------------- views

  private padStatus(s: Stored, index: number): 'active' | 'ended' | undefined {
    const id = s.padIds[index];
    return id ? this.host.pads.get(id)?.pad.status : undefined;
  }

  private result(padId: string, format: 'coding' | 'quant'): InterviewStageView['result'] {
    const report = this.reports.get(padId) ?? 'ready';
    const fallback: Recommendation = format === 'coding' ? 'hire' : QUANT_ASSESSMENT.recommendation;
    return {
      report,
      recommendation: report === 'ready' ? (this.recommendations.get(padId) ?? fallback) : null,
    };
  }

  view(s: Stored): Interview {
    const statuses = stageStatuses({
      count: s.stages.length,
      current: s.current,
      ended: s.ended,
      pad: (i) => this.padStatus(s, i),
    });
    return {
      id: s.id,
      title: s.title,
      track: s.track,
      preset: s.preset,
      status: s.ended ? 'ended' : 'active',
      current: s.current,
      interviewer: s.interviewer,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      stages: s.stages.map((stage, index) => {
        const id = s.padIds[index];
        const d = id ? this.host.pads.get(id) : undefined;
        const status = statuses[index] ?? 'upcoming';
        return {
          index,
          stage,
          status,
          pad: d
            ? {
                id: d.pad.id,
                title: d.pad.title,
                problemTitle: d.problem?.title ?? null,
                startedAt: d.pad.startedAt,
                endedAt: d.pad.endedAt,
              }
            : null,
          result: d && status === 'done' ? this.result(d.pad.id, d.pad.format) : null,
        };
      }),
    };
  }

  private find(id: string) {
    return this.list.find((s) => s.id === id);
  }

  private ofPad(padId: string): { s: Stored; index: number } | null {
    for (const s of this.list) {
      const index = s.padIds.indexOf(padId);
      if (index >= 0) return { s, index };
    }
    return null;
  }

  /** `PadDetail.interview` for a stage's pad (the owner's). */
  padInterview(padId: string): PadInterview | null {
    const at = this.ofPad(padId);
    if (!at) return null;
    const { s, index } = at;
    return {
      id: s.id,
      title: s.title,
      index,
      total: s.stages.length,
      next: s.stages[index + 1] ?? null,
      active: !s.ended,
    };
  }

  isStagePad = (padId: string) => this.ofPad(padId) !== null;

  /** POST /api/pads/:id/end on a stage's pad: the last stage's ends the interview. */
  padEnded(padId: string, at: Date) {
    const found = this.ofPad(padId);
    if (!found || found.s.ended) return;
    if (found.index === found.s.stages.length - 1) {
      found.s.ended = true;
      found.s.endedAt = at.toISOString();
    }
  }

  /** A stage's report as a spec set it: pending (being written) or failed, else as it is. */
  adjustReport(padId: string, report: Report): Report {
    const state = this.reports.get(padId);
    if (state === 'pending')
      return { ...report, status: 'pending', generatedAt: null, assessment: null };
    if (state === 'failed') return { ...report, status: 'failed', assessment: null };
    const r = this.recommendations.get(padId);
    if (r && report.assessment)
      return { ...report, assessment: { ...report.assessment, recommendation: r } };
    return report;
  }

  /** A spec: stage `index` of the latest interview (or of `interviewId`) has this report. */
  setReport(index: number, state: ReportState, interviewId?: string) {
    const s = interviewId ? this.find(interviewId) : this.list[0];
    const id = s?.padIds[index];
    if (!id) throw new Error(`stage ${index} has no pad`);
    this.reports.set(id, state);
  }

  // ---------------------------------------------------------------- starting stages

  /** Why stage `index` cannot start (as the API's 409 or 404), or null. */
  private refusal(stage: InterviewStage, index: number): Response | null {
    if (
      stage.kind === 'coding' &&
      stage.problemSlug &&
      !PROBLEMS.some((p) => p.slug === stage.problemSlug)
    )
      return response(404, 'not_found', `Stage ${index + 1}: that problem does not exist.`);
    if (
      this.unavailable.has(index) ||
      (stage.kind === 'questions' &&
        !stagePicks(stage.topics, quantQuestionCount(stage.durationMin)))
    ) {
      const topics =
        stage.kind === 'questions' ? stage.topics.map(topicTitle).join(', ') : 'the game';
      return response(
        409,
        'quant_unavailable',
        `Stage ${index + 1} cannot start: there are not enough questions on ${topics} yet. Choose more topics or a shorter stage.`,
      );
    }
    return null;
  }

  /** The stage's pad, made now (what it draws is chosen now, as on the API). */
  private startStage(s: Stored, index: number, startedAt: Date): string {
    const stage = s.stages[index];
    if (!stage) throw new Error(`no stage ${index}`);
    const id = uuid();
    const interviewer = { ...s.interviewer, enabled: true };
    if (stage.kind === 'coding') {
      const problem =
        PROBLEMS.find((p) => p.slug === stage.problemSlug) ??
        PROBLEMS.find(
          (p) =>
            (!stage.difficulty || p.difficulty === stage.difficulty) &&
            (!stage.category || p.category === stage.category) &&
            p.languages.includes(stage.language),
        ) ??
        PROBLEMS[0];
      const detail = makePadDetail({
        pad: {
          id,
          problemSlug: problem?.slug ?? 'two-sum',
          title: problem?.title ?? 'Two Sum',
          language: stage.language,
          durationMin: stage.durationMin,
          interviewer,
          startedAt: startedAt.toISOString(),
          interviewId: s.id,
        },
        messages: [],
      });
      this.host.pads.set(id, detail);
      this.host.summaries.unshift({
        id,
        title: detail.pad.title,
        kind: 'practice',
        format: 'coding',
        problemSlug: detail.pad.problemSlug,
        language: stage.language,
        status: 'active',
        startedAt: detail.pad.startedAt,
        endedAt: null,
        interviewId: s.id,
        problemTitle: problem?.title ?? null,
        difficulty: problem?.difficulty ?? null,
        accepted: false,
        role: 'owner',
        quantPath: null,
      });
    } else {
      const questions = stage.kind === 'questions';
      const picks: QuantPick[] = questions
        ? (stagePicks(stage.topics, quantQuestionCount(stage.durationMin)) ?? [])
        : [gamePick()];
      const homes = questions
        ? stage.topics.map((t) => QUIZ_TOPICS.find((x) => x.slug === t)?.track ?? 'quant')
        : ['quant' as const];
      this.host.quant.createStage({
        id,
        title: questions ? stage.topics.map(topicTitle).join(', ') : 'Market-making game',
        durationMin: stage.durationMin,
        startedAt: startedAt.toISOString(),
        interviewer,
        picks,
        subject: quantSubject(homes),
        interviewId: s.id,
      });
    }
    s.padIds[index] = id;
    s.current = index;
    return id;
  }

  private start(o: {
    track: Track;
    preset: string | null;
    title: string;
    stages: InterviewStage[];
    interviewer: InterviewSettings;
    startedAt: Date;
  }): Stored {
    const s: Stored = {
      id: uuid(),
      title: o.title,
      track: o.track,
      preset: o.preset,
      ended: false,
      current: 0,
      stages: o.stages,
      padIds: o.stages.map(() => null),
      interviewer: o.interviewer,
      startedAt: o.startedAt.toISOString(),
      endedAt: null,
    };
    this.list.unshift(s);
    this.startStage(s, 0, o.startedAt);
    return s;
  }

  /**
   * An interview played already (for the lists, the hub and screens): its first `started`
   * stages, each 20 minutes apart from `startedAt`; those before the last started are done, the
   * last too unless `activeLast`. `ended` ends it (the rest skipped).
   */
  seed(o: {
    track: Track;
    stages: InterviewStage[];
    started: number;
    startedAt: string;
    title?: string;
    preset?: string | null;
    ended?: boolean;
    activeLast?: boolean;
    /** Coding stages (by index) whose pad has an accepted submission. */
    accepted?: number[];
  }): Interview {
    const t0 = Date.parse(o.startedAt);
    const at = (min: number) => new Date(t0 + min * 60_000);
    const s = this.start({
      track: o.track,
      preset: o.preset ?? null,
      title: o.title ?? 'Custom interview',
      stages: o.stages,
      interviewer: { style: 'neutral', proactivity: 'normal', voice: false },
      startedAt: at(0),
    });
    for (let i = 0; i < o.started; i++) {
      if (i > 0) this.startStage(s, i, at(i * 20));
      const id = s.padIds[i] as string;
      const last = i === o.started - 1;
      if (!(last && o.activeLast)) this.host.endPadNow(id, at(i * 20 + 15));
      if (o.accepted?.includes(i)) {
        const summary = this.host.summaries.find((p) => p.id === id);
        if (summary) summary.accepted = true;
      }
    }
    if (o.ended) {
      s.ended = true;
      s.endedAt = at((o.started - 1) * 20 + 15).toISOString();
    }
    return this.view(s);
  }

  // ---------------------------------------------------------------- routes

  handle(method: string, path: string, body: unknown): Response | object | undefined {
    if (!path.startsWith('/api/interviews')) return undefined;
    if (this.host.me.guest)
      return response(403, 'account_required', 'Sign in with an account to do this');
    if (path === '/api/interviews' && method === 'GET') return this.list.map((s) => this.view(s));
    if (path === '/api/interviews' && method === 'POST') {
      const parsed = CreateInterviewRequest.safeParse(body);
      if (!parsed.success)
        return response(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Invalid');
      const req = parsed.data;
      if (this.host.aiKey.state !== 'active')
        return response(
          409,
          'ai_key_missing',
          'Every stage runs on your own AI API key. Add one first.',
        );
      for (const [i, stage] of req.stages.entries())
        if (stage.kind === 'coding' && stage.problemSlug) {
          const refused = this.refusal(stage, i);
          if (refused) return refused;
        }
      const first = req.stages[0] as InterviewStage;
      const refused = this.refusal(first, 0);
      if (refused) return refused;
      const s = this.start({
        track: req.track,
        preset: req.preset,
        title: req.title || 'Custom interview',
        stages: req.stages,
        interviewer: req.interviewer,
        startedAt: new Date(),
      });
      return new Response(JSON.stringify({ interview: this.view(s), padId: s.padIds[0] }), {
        status: 201,
      });
    }
    const m = path.match(/^\/api\/interviews\/([0-9a-f-]{36})(\/next|\/end)?$/);
    if (!m) return undefined;
    const s = this.find(m[1] ?? '');
    if (!s) return response(404, 'not_found', 'Interview not found');
    const rest = m[2] ?? '';
    if (rest === '' && method === 'GET') return this.view(s);
    if (rest === '' && method === 'DELETE') {
      for (const id of s.padIds) if (id) this.host.removePad(id);
      this.list = this.list.filter((x) => x !== s);
      return { interviewId: s.id };
    }
    const activePad = () => {
      const i = s.padIds.findIndex((id, i) => id && this.padStatus(s, i) === 'active');
      return i >= 0 ? (s.padIds[i] ?? null) : null;
    };
    if (rest === '/end' && method === 'POST') {
      if (!s.ended) {
        const now = new Date();
        const id = activePad();
        if (id) this.host.endPadNow(id, now);
        s.ended = true;
        s.endedAt = now.toISOString();
      }
      return this.view(s);
    }
    if (rest === '/next' && method === 'POST') {
      const parsed = AdvanceInterviewRequest.safeParse(body);
      if (!parsed.success)
        return response(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Invalid');
      const { from } = parsed.data;
      // Moved past `from` already (a second click, another tab): as it is.
      if (s.ended || from < s.current) return { interview: this.view(s), padId: activePad() };
      if (from > s.current) return response(409, 'wrong_stage', 'That stage has not started yet');
      const now = new Date();
      const id = s.padIds[from];
      if (id && this.padStatus(s, from) === 'active') this.host.endPadNow(id, now);
      const nextIndex = from + 1;
      const next = s.stages[nextIndex];
      if (!next) {
        s.ended = true;
        s.endedAt = now.toISOString();
        return { interview: this.view(s), padId: null };
      }
      const refused = this.refusal(next, nextIndex);
      if (refused) return refused;
      const padId = this.startStage(s, nextIndex, now);
      return { interview: this.view(s), padId };
    }
    return undefined;
  }
}
