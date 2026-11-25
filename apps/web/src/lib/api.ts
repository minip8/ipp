/**
 * Typed client for the HTTP API (docs/ARCHITECTURE.md §4). The browser always calls the web
 * origin; Next rewrites /api/* to the API. Every response is parsed with its contracts schema.
 */
import {
  AiKeyStatus,
  AiModelList,
  type AiProvider,
  AnswerFeedback,
  ApiError,
  type CreateAttemptRequest,
  type CreatePadRequest,
  type CreateRunRequest,
  DeletePadResponse,
  type DiscussionReplyRequest,
  DiscussionReplyResponse,
  HostView,
  InviteInfo,
  Pad,
  PadDetail,
  PadProblem,
  PadSummary,
  Playback,
  ProblemDetail,
  ProblemSummary,
  QuizAttempt,
  QuizAttemptSummary,
  QuizBank,
  QuizBankQuestion,
  type QuizResponse,
  QuizTopicStats,
  Report,
  Run,
  SolutionReview,
  UpdateHostNotesRequest,
  type UpdatePadRequest,
  WsTicketResponse,
} from '@ipp/contracts';
import { z } from 'zod';
import { ConfigResponse, JoinResponse, MeResponse, RecordedResponse } from './schemas';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
  get isRateLimited() {
    return this.status === 429;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  get isNotFound() {
    return this.status === 404;
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  400: 'The request was not valid.',
  401: 'You need to sign in.',
  403: "You don't have access to this.",
  404: 'Not found.',
  409: 'That conflicts with the current state. Refresh and try again.',
  413: 'That is too large to send.',
  429: 'Too many requests. Wait a moment and try again.',
  500: 'Something went wrong on our side.',
  502: 'The server is not reachable right now.',
  503: 'The service is busy. Try again shortly.',
};

type Options = { method?: string; body?: unknown; signal?: AbortSignal };

export async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  { method = 'GET', body, signal }: Options = {},
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'network', 'Could not reach the server. Check your connection.');
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const parsed = ApiError.safeParse(json);
    const retryHeader = Number(res.headers.get('retry-after'));
    if (parsed.success) {
      const e = parsed.data.error;
      throw new ApiRequestError(
        res.status,
        e.code,
        e.message,
        e.retryAfter ?? (retryHeader || undefined),
      );
    }
    throw new ApiRequestError(
      res.status,
      `http_${res.status}`,
      FALLBACK_MESSAGES[res.status] ?? `Request failed (${res.status}).`,
      retryHeader || undefined,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error(`Unexpected response from ${method} /api${path}`, z.prettifyError(parsed.error));
    throw new ApiRequestError(
      res.status,
      'bad_response',
      'The server sent an unexpected response.',
    );
  }
  return parsed.data;
}

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request('/me', MeResponse),
  /** The signed-in user's own AI provider API key: status only, never the key. */
  aiKey: () => request('/ai-key', AiKeyStatus),
  saveAiKey: (provider: AiProvider, apiKey: string) =>
    request('/ai-key', AiKeyStatus, { method: 'PUT', body: { provider, apiKey } }),
  /** Models the saved key can use (live from its provider). */
  aiModels: () => request('/ai-key/models', AiModelList),
  deleteAiKey: () => request('/ai-key', AiKeyStatus, { method: 'DELETE' }),
  config: () => request('/config', ConfigResponse),
  problems: (f: { difficulty?: string; tag?: string; q?: string } = {}) =>
    request(`/problems${qs(f)}`, z.array(ProblemSummary)),
  problem: (slug: string) => request(`/problems/${encodeURIComponent(slug)}`, ProblemDetail),
  createPad: (body: z.input<typeof CreatePadRequest>) =>
    request('/pads', Pad, { method: 'POST', body }),
  pads: () => request('/pads', z.array(PadSummary)),
  pad: (id: string) => request(`/pads/${id}`, PadDetail),
  updatePad: (id: string, body: UpdatePadRequest) =>
    request(`/pads/${id}`, Pad, { method: 'PATCH', body }),
  endPad: (id: string) => request(`/pads/${id}/end`, Pad, { method: 'POST' }),
  /** Owner: deletes the pad for everyone. Collaborator: removes it from their own history. */
  deletePad: (id: string) => request(`/pads/${id}`, DeletePadResponse, { method: 'DELETE' }),
  joinPad: (shareToken: string) =>
    request('/pads/join', JoinResponse, { method: 'POST', body: { shareToken } }),
  /** Who is inviting and to what; works without a session. */
  invite: (shareToken: string) =>
    request(`/pads/invite/${encodeURIComponent(shareToken)}`, InviteInfo),
  /** Enter an interview room with just a name (creates a guest session when there is none). */
  joinAsGuest: (shareToken: string, name: string) =>
    request('/pads/join-guest', JoinResponse, { method: 'POST', body: { shareToken, name } }),
  /** Room host: move the room to another problem, or to a blank editor (null). */
  changeProblem: (id: string, problemSlug: string | null) =>
    request(`/pads/${id}/problem`, PadProblem, { method: 'POST', body: { problemSlug } }),
  /** Room host only: interviewer notes, reference solutions and the host's own notes. */
  hostView: (id: string) => request(`/pads/${id}/host`, HostView),
  saveHostNotes: (id: string, notes: string) =>
    request(`/pads/${id}/host/notes`, UpdateHostNotesRequest, { method: 'PUT', body: { notes } }),
  /** Room host only: the AI's second opinion on the code as it is now (the host's own key). */
  reviewSolution: (id: string, question?: string) =>
    request(`/pads/${id}/review`, SolutionReview, {
      method: 'POST',
      body: question ? { question } : {},
    }),
  report: (id: string) => request(`/pads/${id}/report`, Report),
  requestAssessment: (id: string) =>
    request(`/pads/${id}/report/assessment`, Report, { method: 'POST' }),
  playback: (id: string) => request(`/pads/${id}/playback`, Playback),
  createRun: (padId: string, body: CreateRunRequest) =>
    request(`/pads/${padId}/runs`, Run, { method: 'POST', body }),
  run: (id: string) => request(`/runs/${id}`, Run),
  wsTicket: (padId: string) =>
    request('/ws-ticket', WsTicketResponse, { method: 'POST', body: { padId } }),
  quizTopics: () => request('/quiz/topics', z.array(QuizTopicStats)),
  createAttempt: (body: CreateAttemptRequest) =>
    request('/quiz/attempts', QuizAttempt, { method: 'POST', body }),
  attempts: () => request('/quiz/attempts', z.array(QuizAttemptSummary)),
  attempt: (id: string) => request(`/quiz/attempts/${id}`, QuizAttempt),
  submitAnswer: (id: string, body: { questionId: string; response: QuizResponse }) =>
    request(`/quiz/attempts/${id}/answers`, z.union([AnswerFeedback, RecordedResponse]), {
      method: 'POST',
      body,
    }),
  discussionReply: (id: string, body: DiscussionReplyRequest) =>
    request(`/quiz/attempts/${id}/discussion`, DiscussionReplyResponse, { method: 'POST', body }),
  finishAttempt: (id: string) =>
    request(`/quiz/attempts/${id}/finish`, QuizAttempt, { method: 'POST' }),
  /** Question bank: a topic's questions with the user's status, answered outside any attempt. */
  quizBank: (topic: string) =>
    request(`/quiz/topics/${encodeURIComponent(topic)}/questions`, QuizBank),
  quizBankQuestion: (id: string) =>
    request(`/quiz/questions/${encodeURIComponent(id)}`, QuizBankQuestion),
  answerQuestion: (id: string, response: QuizResponse) =>
    request(`/quiz/questions/${encodeURIComponent(id)}/answers`, AnswerFeedback, {
      method: 'POST',
      body: { response },
    }),
};

/** Human message for any error, with rate-limit timing when known. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.isRateLimited && err.retryAfter)
      return `${err.message} You can try again in ${formatRetry(err.retryAfter)}.`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export function formatRetry(sec: number): string {
  const s = Math.max(1, Math.ceil(sec));
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  return m < 60 ? `${m} min` : `${Math.ceil(m / 60)} h`;
}
