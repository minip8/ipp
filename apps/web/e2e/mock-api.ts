/**
 * Network interception for browser tests: a small stateful stand-in for apps/api, built only
 * from contract fixtures. It lives in the test suite, never in the app.
 *
 *   HTTP  /api/*            page.route
 *   WS    /ws/pads/:id      page.routeWebSocket (events are pushed by the test)
 *   WS    /collab           a real Hocuspocus server started by global-setup (see collab-server.ts)
 */

import {
  AI_PROVIDERS,
  type AiKeyStatus,
  type AiProvider,
  type AnswerFeedback,
  ChangeProblemRequest,
  ClientEvent,
  CreateAttemptRequest,
  CreatePadRequest,
  CreateRunRequest,
  DiscussionReplyRequest,
  type DiscussionTurn,
  DRILL_HISTORY_LIMIT,
  type DrillHistory,
  type DrillRun,
  drillScore,
  effectiveModel,
  type HostView,
  type InviteInfo,
  isFullMix,
  JoinGuestRequest,
  LANGUAGE_LABELS,
  type Language,
  type Message,
  type Pad,
  type PadDetail,
  type PadSummary,
  type ProblemProgress,
  QuizAttempt,
  type QuizAttemptSummary,
  type QuizRoadmapTopic,
  type QuizTopicStats,
  RecordDrillRunRequest,
  type RecordDrillRunResponse,
  ReviewRequest,
  type Run,
  ServerEvent,
  SubmitAnswerRequest,
  UpdateHostNotesRequest,
  UpdatePadRequest,
} from '@ipp/contracts';
import type { Page, WebSocketRoute } from '@playwright/test';
import {
  ACTIVE_PAD_ID,
  aiKeyStatus,
  aiModelList,
  DEFAULT_MODELS,
  DISCUSSION_FOLLOW_UP,
  ENDED_PAD_ID,
  GUEST,
  HOST_VIEWS,
  iso,
  makeAttempt,
  makeMessage,
  makePadDetail,
  makePlayback,
  makeReview,
  makeRoomDetail,
  PAD_SUMMARIES,
  PROBLEM_DETAILS,
  PROBLEM_PROGRESS,
  PROBLEMS,
  QUIZ_FEEDBACK,
  QUIZ_HISTORY,
  QUIZ_QUESTIONS,
  QUIZ_TOPICS,
  REPORT_PENDING,
  REPORT_READY,
  REPORT_ROOM,
  RUNS,
  TWO_SUM,
  USER,
  uuid,
} from './fixtures';
import { DRILL_RUNS, drillBests } from './fixtures-drill';
import { publicOf, ROOM_BANK } from './fixtures-quant-room';
import { QUANT_FOLLOW_UP, QUANT_QUESTIONS, QUANT_TOPIC } from './fixtures-quiz-quant';
import { QUIZ_ROADMAP } from './fixtures-quiz-roadmap';
import { MockQuantRooms } from './mock-quant-room';
import { MockQuantRounds } from './mock-quant-round';
import { MockQuizBank } from './mock-quiz-bank';

type RunScript = (id: string, mode: Run['mode']) => Run;

export class MockBackend {
  signedIn = true;
  /** Who /api/me says is signed in (a guest after joining a room by its link). */
  me: { id: string; name: string; email: string; image?: string | null; guest?: boolean } = USER;
  /** Room hosts' private notes, by pad. */
  hostNotes = new Map<string, string>();
  /** Questions sent with second-opinion requests (undefined = none). */
  reviews: (string | undefined)[] = [];
  githubAuth = true;
  googleAuth = true;
  /** The signed-in user's own provider key. Pads they own run on it. */
  aiKey: AiKeyStatus = aiKeyStatus('active');
  /** Bodies of PUT /api/ai-key (the tests assert the UI sent exactly what was pasted). */
  savedKeys: string[] = [];
  /** The provider sent with each PUT /api/ai-key. */
  savedProviders: (AiProvider | undefined)[] = [];
  /** GET /api/ai-key/models: the provider could not list them (a built-in list comes back). */
  modelsFail = false;
  modelListCalls = 0;
  pads = new Map<string, PadDetail>();
  attempts = new Map<string, QuizAttempt>();
  runs = new Map<string, Run>();
  /** What the next run returns; defaults depend on the mode. */
  nextRun: RunScript | null = null;
  /** Delay between run.created and run.finished, in ms. */
  runDelayMs = 600;
  /** Fail the next request matching this path fragment with the given status/body. */
  failures: { match: RegExp; status: number; body: unknown; times: number }[] = [];
  /** Interviewer reply streamed back for each chat.send. */
  replyText =
    'Good instinct. A hash map from value to index gives you O(n) time. What would you store as the key, and when would you check for the complement?';
  sockets: WebSocketRoute[] = [];
  received: ClientEvent[] = [];
  requests: { method: string; path: string; body: unknown }[] = [];
  report = REPORT_READY;
  /** GET /api/pads; DELETE /api/pads/:id removes from it. */
  summaries: PadSummary[] = structuredClone(PAD_SUMMARIES);
  /** Pad ids deleted (owner) or left (collaborator), in order. */
  deleted: string[] = [];
  /** GET /api/quiz/attempts; DELETE /api/quiz/attempts/:id and /api/quiz/history remove from it. */
  quizHistory: QuizAttemptSummary[] = structuredClone(QUIZ_HISTORY);
  /** Attempt ids deleted, in order (a deleted attempt is a 404 from then on). */
  deletedAttempts: string[] = [];
  /** How many times the whole quiz or drill history was cleared. */
  cleared = { quiz: 0, drill: 0 };
  /** GET /api/progress/problems: the user's solved and attempted problems (`[]` for a newcomer). */
  problemProgress: ProblemProgress = structuredClone(PROBLEM_PROGRESS);
  quizMode: 'practice' | 'exam' = 'practice';
  /** Question bank state (answers given outside attempts). */
  quizBank = new MockQuizBank();
  /** GET /api/quiz/roadmap (QUIZ_ROADMAP_FRESH for a first visit). */
  quizRoadmap: QuizRoadmapTopic[] = QUIZ_ROADMAP;
  /** GET /api/quiz/topics (QUIZ_TOPICS_FUNDAMENTALS for the site before any quant content). */
  quizTopics: QuizTopicStats[] = QUIZ_TOPICS;
  /** Mental math drill runs, newest first (`[]` for a first visit). */
  drillRuns: DrillRun[] = structuredClone(DRILL_RUNS);
  /** Live quant rounds: their pads, the scripted interviewer and their reports. */
  quant: MockQuantRounds;
  /** Quant rooms (§8.4): their hosted rounds, the host's routes and their reports. */
  quantRooms: MockQuantRooms;
  /**
   * The signed-in user is a candidate in a quant room that is still going: the quiz routes that
   * reveal answers refuse them (`in_quant_interview`), as the API's guard does.
   */
  inQuantInterview(): boolean {
    return [...this.pads.values()].some(
      (d) =>
        d.pad.kind === 'room' &&
        d.pad.format === 'quant' &&
        d.pad.status === 'active' &&
        d.role !== 'owner' &&
        d.members.some((m) => m.userId === this.me.id),
    );
  }

  constructor() {
    this.pads.set(ACTIVE_PAD_ID, makePadDetail());
    this.pads.set(
      ENDED_PAD_ID,
      makePadDetail({
        // Same times as the playback fixture (makePlayback) so the report's timeline lines up.
        pad: {
          id: ENDED_PAD_ID,
          problemSlug: 'lru-cache',
          title: 'LRU Cache',
          language: 'python',
          status: 'ended',
          startedAt: iso(-86400 * 2),
          endedAt: iso(-86400 * 2 + 2520),
        },
      }),
    );
    this.quant = new MockQuantRounds(this);
    this.quantRooms = new MockQuantRooms(this);
  }

  /** The quant room specs: the public question bank is the room's bank (prompts only). */
  useRoomBank() {
    this.quizBank.questions = [];
    this.quizBank.quant = [];
    this.quizBank.extra = ROOM_BANK.map(publicOf);
  }

  fail(match: RegExp, status: number, body: unknown, times = 1) {
    this.failures.push({ match, status, body, times });
  }

  /** Push a server event to every open pad socket (validated against the contract). */
  push(event: ServerEvent) {
    const e = ServerEvent.parse(event);
    for (const ws of this.sockets) ws.send(JSON.stringify(e));
  }

  async streamReply(
    text: string,
    opts: { kind?: Message['kind']; intent?: Message['intent']; chunkMs?: number } = {},
  ) {
    const id = uuid();
    this.push({ type: 'interviewer.thinking', active: true });
    await sleep(350);
    const words = text.split(/(?<=\s)/);
    for (let i = 0; i < words.length; i += 3) {
      this.push({ type: 'message.delta', messageId: id, delta: words.slice(i, i + 3).join('') });
      await sleep(opts.chunkMs ?? 60);
    }
    const message = makeMessage({
      id,
      role: 'interviewer',
      kind: opts.kind ?? 'chat',
      intent: opts.intent ?? 'answer',
      text,
    });
    this.push({ type: 'message.created', message });
    this.push({ type: 'interviewer.thinking', active: false });
    return message;
  }

  async install(page: Page) {
    await page.route(/\/api\//, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      const method = req.method();
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = null;
      }
      this.requests.push({ method, path, body });

      const failure = this.failures.find((f) => f.match.test(`${method} ${path}`) && f.times > 0);
      if (failure) {
        failure.times--;
        return route.fulfill({ status: failure.status, json: failure.body });
      }
      const res = await this.handle(method, path, url.searchParams, body);
      if (res === undefined)
        return route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: `No mock for ${method} ${path}` } },
        });
      if (res instanceof Response)
        return route.fulfill({ status: res.status, json: await res.json() });
      return route.fulfill({ status: 200, json: res });
    });

    await page.routeWebSocket(/\/ws\/pads\//, (ws) => {
      this.sockets.push(ws);
      const socketPad = /\/ws\/pads\/([0-9a-f-]{36})/.exec(ws.url())?.[1] ?? '';
      this.quant.connected(ws, socketPad);
      this.quantRooms.connected(ws, socketPad);
      ws.onMessage((raw) => {
        const parsed = ClientEvent.safeParse(JSON.parse(String(raw)));
        if (!parsed.success) {
          ws.send(JSON.stringify({ type: 'error', code: 'bad_event', message: 'invalid event' }));
          return;
        }
        const ev = parsed.data;
        this.received.push(ev);
        if (ev.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        const quantPad = this.pads.get(socketPad)?.pad.format === 'quant';
        const quantRoom = quantPad && this.pads.get(socketPad)?.pad.kind === 'room';
        if (quantRoom && ev.type === 'chat.send') {
          this.quantRooms.chat(this, socketPad, ev.text, ev.via);
          return;
        }
        if (quantPad && ev.type === 'language') {
          ws.send(
            JSON.stringify({
              type: 'error',
              code: 'wrong_format',
              message: 'A quant pad has no code',
            }),
          );
          return;
        }
        if (quantPad && ev.type === 'chat.send') {
          const d = this.pads.get(socketPad);
          this.quant.chat(
            socketPad,
            ev.text,
            ev.via,
            Boolean(d && this.detail(d).interviewerKey === 'active'),
          );
          return;
        }
        if (ev.type === 'chat.send') {
          // Like the real interviewer: silent without the pad owner's key.
          const padId = /\/ws\/pads\/([0-9a-f-]{36})/.exec(ws.url())?.[1] ?? '';
          const d = this.pads.get(padId);
          if (d?.pad.kind === 'room') {
            // A room is people talking: the message comes back to everyone, and no AI answers.
            this.push({
              type: 'message.created',
              message: makeMessage({
                padId,
                role: d.role === 'owner' ? 'interviewer' : 'candidate',
                userId: this.me.id,
                text: ev.text,
                createdAt: new Date().toISOString(),
              }),
            });
            return;
          }
          if (d && this.detail(d).interviewerKey === 'active')
            void this.streamReply(this.replyText);
        }
      });
      ws.onClose(() => {
        this.sockets = this.sockets.filter((s) => s !== ws);
      });
    });
  }

  /** Pad detail as GET returns it: an owned pad follows the user's own key. */
  detail(d: PadDetail): PadDetail {
    if (d.role !== 'owner') return d;
    // A room has no AI in the conversation; the host's own key is read from /api/ai-key.
    const provider = this.aiKey.state === 'active' ? this.aiKey.provider : null;
    return {
      ...d,
      interviewerKey: this.aiKey.state,
      interviewerAvailable: this.aiKey.state === 'active',
      interviewerModel: provider
        ? effectiveModel(d.pad.interviewer.model, provider, DEFAULT_MODELS[provider])
        : null,
    };
  }

  /** A room's host asked for the AI assessment (until then its report offers one). */
  roomAssessed = false;

  private padByToken(token: string): PadDetail | undefined {
    return [...this.pads.values()].find(
      (p) => p.pad.shareToken === token || this.tokens.get(token) === p.pad.id,
    );
  }

  /** Invite tokens of rooms the signed-in user does not host (their pad carries no token). */
  tokens = new Map<string, string>();

  /** The current user enters a room as a candidate, and everyone in it is told. */
  private joinRoom(pad: PadDetail) {
    if (pad.members.some((x) => x.userId === this.me.id)) return;
    const member = {
      userId: this.me.id,
      name: this.me.name,
      role: 'collaborator' as const,
      guest: this.me.guest === true,
    };
    pad.members = [...pad.members, member];
    this.push({ type: 'member.joined', member });
    if (pad.pad.format === 'quant') this.quantRooms.joined(this, pad.pad.id, member);
  }

  /**
   * The pad is gone for this user (deleted, or left as a collaborator): out of the list, its
   * detail 404s, and its open event sockets close with 4404 like the API's. Null if unknown.
   */
  removePad(id: string): PadSummary['role'] | null {
    const summary = this.summaries.find((p) => p.id === id);
    const detail = this.pads.get(id);
    if (!summary && !detail) return null;
    this.summaries = this.summaries.filter((p) => p.id !== id);
    this.pads.delete(id);
    this.deleted.push(id);
    for (const ws of this.sockets)
      if (ws.url().includes(id)) void ws.close({ code: 4404, reason: 'pad-deleted' });
    return summary?.role ?? detail?.role ?? 'owner';
  }

  setKey(next: AiKeyStatus) {
    this.aiKey = next;
    this.push({ type: 'interviewer.status', key: next.state });
  }

  private status(status: number, code: string, message: string, retryAfter?: number) {
    return new Response(
      JSON.stringify({ error: { code, message, ...(retryAfter ? { retryAfter } : {}) } }),
      { status },
    );
  }

  /** Like the API's `language_unavailable`: a problem refuses languages it does not offer. */
  private languageRefusal(slug: string, language: Language) {
    const p = PROBLEMS.find((x) => x.slug === slug);
    if (!p || p.languages.includes(language)) return null;
    return this.status(
      400,
      'language_unavailable',
      `${p.title} can only be solved in ${p.languages.map((l) => LANGUAGE_LABELS[l]).join(', ')}, not ${LANGUAGE_LABELS[language]}`,
    );
  }

  private async handle(
    method: string,
    path: string,
    q: URLSearchParams,
    body: unknown,
  ): Promise<unknown> {
    const m = (re: RegExp) => path.match(re);
    // auth
    if (path === '/api/auth/sign-in/email' && method === 'POST') {
      const b = body as { email: string; password: string };
      if (b.password !== 'correct-horse')
        return new Response(
          JSON.stringify({
            code: 'INVALID_EMAIL_OR_PASSWORD',
            message: 'Invalid email or password',
          }),
          { status: 401 },
        );
      this.signedIn = true;
      return { token: 'tok', user: USER };
    }
    if (path === '/api/auth/sign-up/email' && method === 'POST') {
      this.signedIn = true;
      return { token: 'tok', user: USER };
    }
    if (path === '/api/auth/sign-out') {
      this.signedIn = false;
      return { success: true };
    }
    if (path === '/api/config')
      return {
        githubAuth: this.githubAuth,
        googleAuth: this.googleAuth,
        ai: { requiresUserKey: true, model: 'claude-opus-5-5', keyTtlHours: 24 },
      };
    // Invite links work without a session.
    let inv = m(/^\/api\/pads\/invite\/([^/]+)$/);
    if (inv) {
      const pad = this.padByToken(decodeURIComponent(inv[1] ?? ''));
      if (!pad) return this.status(404, 'not_found', 'Invite not found');
      const info: InviteInfo = {
        kind: pad.pad.kind,
        title: pad.pad.title,
        hostName: pad.members.find((x) => x.role === 'owner')?.name ?? 'Someone',
        status: pad.pad.status,
      };
      return info;
    }
    if (path === '/api/pads/join-guest' && method === 'POST') {
      const req = JoinGuestRequest.parse(body);
      const pad = this.padByToken(req.shareToken);
      if (pad?.pad.kind !== 'room') return this.status(404, 'not_found', 'Invite not found');
      if (pad.pad.status !== 'active')
        return this.status(409, 'pad_ended', 'This interview has ended');
      if (!this.signedIn) {
        this.signedIn = true;
        this.me = { ...GUEST, name: req.name, image: null, guest: true };
      } else if (this.me.guest) this.me = { ...this.me, name: req.name };
      this.joinRoom(pad);
      return { padId: pad.pad.id };
    }
    inv = null;
    if (!this.signedIn) return this.status(401, 'unauthorized', 'Sign in to continue.');
    if (path === '/api/me') return { user: this.me };
    if (
      this.me.guest &&
      (path === '/api/pads' ||
        path.startsWith('/api/ai-key') ||
        path.startsWith('/api/progress') ||
        path.startsWith('/api/quiz') ||
        path.startsWith('/api/drill'))
    )
      return this.status(403, 'account_required', 'Sign in with an account to do this');

    if (path === '/api/ai-key') {
      if (method === 'GET') return this.aiKey;
      if (method === 'DELETE') {
        this.setKey(aiKeyStatus('missing'));
        return this.aiKey;
      }
      if (method === 'PUT') {
        const b = body as { apiKey?: unknown; provider?: AiProvider };
        const apiKey = String(b?.apiKey ?? '');
        const provider = b?.provider ?? 'anthropic';
        this.savedKeys.push(apiKey);
        this.savedProviders.push(b?.provider);
        if (apiKey.includes('revoked'))
          return this.status(
            422,
            'ai_key_rejected',
            `${AI_PROVIDERS[provider].label} did not accept this key. Check that you copied all of it and that it has not been revoked.`,
          );
        await sleep(250); // the real API makes one call to the provider here
        this.setKey(aiKeyStatus('active', { last4: apiKey.slice(-4), provider }));
        return this.aiKey;
      }
    }
    if (path === '/api/ai-key/models' && method === 'GET') {
      this.modelListCalls++;
      if (this.aiKey.state !== 'active')
        return this.status(409, 'ai_key_missing', 'Add an API key to choose a model.');
      const provider = this.aiKey.provider ?? 'anthropic';
      if (this.modelsFail) {
        const defaultModel = DEFAULT_MODELS[provider];
        return {
          provider,
          defaultModel,
          models: [{ id: defaultModel, label: defaultModel, default: true }],
          source: 'fallback',
        };
      }
      return aiModelList(provider);
    }

    if (path === '/api/problems') {
      const text = (q.get('q') ?? '').toLowerCase();
      return PROBLEMS.filter(
        (p) =>
          (!q.get('difficulty') || p.difficulty === q.get('difficulty')) &&
          (!q.get('category') || p.category === q.get('category')) &&
          (!q.get('tag') || p.tags.includes(q.get('tag') ?? '')) &&
          (!text || p.title.toLowerCase().includes(text)),
      );
    }
    if (path === '/api/progress/problems' && method === 'GET') return this.problemProgress;
    let r = m(/^\/api\/problems\/([a-z0-9-]+)$/);
    if (r) {
      const slug = r[1] ?? '';
      const d = PROBLEM_DETAILS[slug];
      if (d) return d;
      const s = PROBLEMS.find((p) => p.slug === slug);
      if (!s) return this.status(404, 'not_found', 'Problem not found.');
      return { ...TWO_SUM, ...s };
    }

    if (path === '/api/pads' && method === 'POST') {
      const parsed = CreatePadRequest.safeParse(body);
      if (!parsed.success)
        return this.status(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Invalid');
      const req = parsed.data;
      if (req.format === 'quant') return this.quantRooms.create(this, req);
      if (req.queue) return this.status(400, 'validation_error', 'Only a quant room has a queue');
      if (req.kind === 'room') {
        const id = uuid();
        const slug = req.blank ? null : (req.problemSlug ?? 'two-sum');
        const detail = makeRoomDetail({
          pad: {
            id,
            problemSlug: slug,
            title: PROBLEMS.find((p) => p.slug === slug)?.title ?? 'Interview room',
            language: req.language ?? 'python',
            durationMin: req.durationMin,
            shareToken: `room_${id.slice(0, 8)}`,
            startedAt: new Date().toISOString(),
          },
        });
        this.pads.set(id, detail);
        return detail.pad;
      }
      // A random pick (API compatibility; the web UI always sends a slug) takes the first match.
      const slug =
        req.problemSlug ??
        PROBLEMS.find(
          (p) =>
            (!req.random?.difficulty || p.difficulty === req.random.difficulty) &&
            (!req.random?.tag || p.tags.includes(req.random.tag)) &&
            p.languages.includes(req.language ?? 'python'),
        )?.slug ??
        'two-sum';
      const refusal = this.languageRefusal(slug, req.language ?? 'python');
      if (refusal) return refusal;
      const id = uuid();
      const detail = makePadDetail({
        pad: {
          id,
          problemSlug: slug,
          title: req.title ?? PROBLEMS.find((p) => p.slug === slug)?.title ?? 'Two Sum',
          language: req.language ?? 'python',
          durationMin: req.durationMin,
          interviewer: req.interviewer,
          startedAt: new Date().toISOString(),
        },
        messages: [],
      });
      this.pads.set(id, detail);
      return detail.pad;
    }
    if (path === '/api/pads/quant' && method === 'POST') return this.quant.create(body);
    if (path === '/api/pads' && method === 'GET') return this.summaries;
    if (path === '/api/pads/join' && method === 'POST') {
      const token = (body as { shareToken?: string })?.shareToken ?? '';
      const room = this.padByToken(token);
      if (room?.pad.kind === 'room') {
        this.joinRoom(room);
        return { padId: room.pad.id };
      }
      return { padId: ACTIVE_PAD_ID };
    }

    r = m(/^\/api\/pads\/([0-9a-f-]{36})(\/.*)?$/);
    if (r) {
      const id = r[1] ?? '';
      const rest = r[2] ?? '';
      const pad = this.pads.get(id);
      if (rest === '' && method === 'DELETE') {
        // Like the API: owner deletes, collaborator leaves; either way it is gone for this user,
        // and a repeat is a 404. Open pad sockets are closed as deleted.
        const role = this.removePad(id);
        if (!role)
          return this.status(404, 'not_found', 'This pad does not exist or you are not a member.');
        return { padId: id, removed: role === 'owner' ? 'pad' : 'membership' };
      }
      if (!pad)
        return this.status(404, 'not_found', 'This pad does not exist or you are not a member.');
      if (rest === '' && method === 'GET') return this.detail(pad);
      if (pad.pad.kind === 'room' && pad.pad.format === 'quant') {
        const out = await this.quantRooms.handle(this, pad, rest, method, q, body);
        if (out !== undefined) return out;
      } else if (rest.startsWith('/host/round/')) {
        // As the API's `quantRoomForHost`: the host first, then the format.
        if (this.me.guest)
          return this.status(403, 'account_required', 'Sign in with an account to do this');
        if (pad.pad.kind !== 'room' || pad.role !== 'owner')
          return this.status(403, 'forbidden', 'Only the host of a room can do this');
        return this.status(409, 'wrong_format', 'Only a quant room has questions to pose');
      }
      const quant = pad.pad.format === 'quant';
      if (rest === '' && method === 'PATCH') {
        const upd = UpdatePadRequest.parse(body);
        // As on the API: a quant pad has no language, and its interviewer is always on.
        if (quant && upd.language)
          return this.status(409, 'wrong_format', 'A quant pad has no language');
        if (quant && upd.interviewer) upd.interviewer = { ...upd.interviewer, enabled: true };
        const refusal =
          upd.language &&
          pad.pad.problemSlug &&
          this.languageRefusal(pad.pad.problemSlug, upd.language);
        if (refusal) return refusal;
        const next: Pad = {
          ...pad.pad,
          ...upd,
          interviewer: { ...pad.pad.interviewer, ...upd.interviewer },
        };
        pad.pad = next;
        this.push({ type: 'pad.updated', pad: next });
        return next;
      }
      if (rest === '/end' && method === 'POST') {
        const at = new Date();
        pad.pad = { ...pad.pad, status: 'ended', endedAt: at.toISOString() };
        this.push({ type: 'pad.updated', pad: pad.pad });
        if (quant) this.quant.end(id, at);
        return pad.pad;
      }
      if (quant && rest === '/report') return this.quant.report(id);
      if (quant && rest === '/playback') return this.quant.playback(id) ?? undefined;
      if (quant && rest === '/runs' && method === 'POST')
        return this.status(409, 'wrong_format', 'A quant pad has no code to run');
      if (rest === '/round/quote' && method === 'POST')
        return quant
          ? this.quant.quote(id, body, this.detail(pad).interviewerKey === 'active')
          : this.status(409, 'wrong_format', 'Only a quant round has markets');
      const room = pad.pad.kind === 'room';
      const hostOnly = () => this.status(403, 'forbidden', 'Only the host of a room can do this');
      if (rest === '/host' || rest === '/host/notes' || rest === '/review' || rest === '/problem') {
        if (!room || pad.role !== 'owner') return hostOnly();
        if (rest === '/host') {
          const view: HostView = {
            problem: pad.pad.problemSlug ? (HOST_VIEWS[pad.pad.problemSlug] ?? null) : null,
            notes: this.hostNotes.get(id) ?? '',
            round: null,
          };
          return view;
        }
        if (rest === '/host/notes' && method === 'PUT') {
          const { notes } = UpdateHostNotesRequest.parse(body);
          this.hostNotes.set(id, notes);
          return { notes };
        }
        if (rest === '/review' && method === 'POST') {
          const { question } = ReviewRequest.parse(body);
          if (this.aiKey.state !== 'active')
            return this.status(409, 'ai_key_missing', 'Add your AI API key first');
          this.reviews.push(question);
          await sleep(300); // one model call
          return makeReview(question);
        }
        if (rest === '/problem' && method === 'POST') {
          const { problemSlug } = ChangeProblemRequest.parse(body);
          const problem = problemSlug ? (PROBLEM_DETAILS[problemSlug] ?? null) : null;
          if (problemSlug && !problem) return this.status(404, 'not_found', 'Problem not found');
          pad.pad = { ...pad.pad, problemSlug };
          pad.problem = problem;
          this.push({ type: 'pad.problem', pad: { ...pad.pad, shareToken: null }, problem });
          return { pad: pad.pad, problem };
        }
      }
      if ((rest === '/report' || rest === '/playback') && room && pad.role !== 'owner')
        return this.status(403, 'forbidden', 'Only the host can open the report');
      if (rest === '/report') {
        if (room && this.report === REPORT_READY && !this.roomAssessed)
          return {
            ...REPORT_ROOM,
            padId: id,
            hostNotes: this.hostNotes.get(id) ?? REPORT_ROOM.hostNotes,
          };
        return {
          ...this.report,
          padId: id,
          ...(room ? { hostNotes: this.hostNotes.get(id) ?? '' } : {}),
        };
      }
      if (rest === '/report/assessment' && method === 'POST') {
        if (this.aiKey.state !== 'active')
          return this.status(409, 'ai_key_missing', 'Add your AI API key first');
        this.roomAssessed = true;
        this.report = REPORT_PENDING;
        setTimeout(() => {
          this.report = REPORT_READY;
        }, 1500);
        return { ...this.report, padId: id };
      }
      if (rest === '/playback') return makePlayback();
      if (rest === '/runs' && method === 'POST') {
        const req = CreateRunRequest.parse(body);
        const runId = uuid();
        if (!pad.pad.problemSlug && req.mode !== 'file')
          return this.status(400, 'no_problem', 'This room has no problem, so there are no tests');
        const queued = {
          ...RUNS.queued(req.mode, runId),
          padId: id,
          language: req.language,
          problemSlug: pad.pad.problemSlug,
        };
        this.runs.set(runId, queued);
        const script = this.nextRun ?? defaultScript(req.mode);
        this.nextRun = null;
        setTimeout(() => void this.playRun(runId, req.mode, script, req.language), 50);
        return new Response(JSON.stringify(queued), { status: 201 });
      }
    }
    r = m(/^\/api\/runs\/([0-9a-f-]{36})$/);
    if (r) return this.runs.get(r[1] ?? '') ?? this.status(404, 'not_found', 'Run not found.');
    if (path === '/api/ws-ticket')
      return { ticket: `t_${Math.random().toString(36).slice(2)}`, expiresInSec: 30 };

    // mental math drill
    const drillHistory = (): DrillHistory => ({
      runs: this.drillRuns.slice(0, DRILL_HISTORY_LIMIT),
      bests: drillBests(this.drillRuns),
      totalRuns: this.drillRuns.length,
    });
    if (path === '/api/drill/runs' && method === 'GET') return drillHistory();
    // As on the server: the history left comes back, bests recomputed; another id is a 404.
    if (path === '/api/drill/runs' && method === 'DELETE') {
      this.drillRuns = [];
      this.cleared.drill++;
      return drillHistory();
    }
    r = m(/^\/api\/drill\/runs\/([0-9a-f-]{36})$/);
    if (r && method === 'DELETE') {
      const id = r[1] ?? '';
      if (!this.drillRuns.some((x) => x.id === id))
        return this.status(404, 'not_found', 'Run not found');
      this.drillRuns = this.drillRuns.filter((x) => x.id !== id);
      return drillHistory();
    }
    if (path === '/api/drill/runs' && method === 'POST') {
      // As on the server: the body must pass the contract (self-consistent, humanly possible).
      const parsed = RecordDrillRunRequest.safeParse(body);
      if (!parsed.success)
        return this.status(400, 'invalid_body', parsed.error.issues[0]?.message ?? 'Invalid run');
      const req = parsed.data;
      const sum = (k: 'correct' | 'wrong' | 'skipped') =>
        req.byCategory.reduce((n, c) => n + c[k], 0);
      const correct = sum('correct');
      const wrong = sum('wrong');
      const run: DrillRun = {
        id: uuid(),
        config: req.config,
        byCategory: req.byCategory,
        correct,
        wrong,
        skipped: sum('skipped'),
        score: drillScore({ correct, wrong }),
        elapsedMs: req.elapsedMs,
        finishedAt: new Date().toISOString(),
      };
      const prior = drillBests(this.drillRuns).find(
        (b) => b.durationSec === req.config.durationSec && b.level === req.config.level,
      );
      const newBest = isFullMix(req.config) && (!prior || run.score > prior.score);
      this.drillRuns = [run, ...this.drillRuns];
      const res: RecordDrillRunResponse = { run, newBest };
      return new Response(JSON.stringify(res), { status: 201 });
    }

    // quizzes
    // As the API's `refuseDuringQuantInterview`: the routes that reveal answers or explanations.
    if (
      this.inQuantInterview() &&
      (/^\/api\/quiz\/questions\/[^/]+(\/answers)?$/.test(path) ||
        (/^\/api\/quiz\/attempts\/[0-9a-f-]{36}$/.test(path) && method === 'GET') ||
        /^\/api\/quiz\/attempts\/[0-9a-f-]{36}\/(answers|discussion|finish)$/.test(path))
    )
      return this.status(
        409,
        'in_quant_interview',
        'You are a candidate in a quant interview that is still going: answers and explanations are unavailable until it ends.',
      );
    if (path === '/api/quiz/topics') return this.quizTopics;
    if (path === '/api/quiz/roadmap') return this.quizRoadmap;
    const bank = this.quizBank.handle(
      method,
      path,
      body,
      this.aiKey.state === 'active',
      this.quizTopics,
    );
    if (bank !== undefined) return bank;
    if (path === '/api/quiz/attempts' && method === 'GET') return this.quizHistory;
    if (path === '/api/quiz/history' && method === 'DELETE') {
      const res = { attempts: this.quizHistory.length, bankAnswers: this.quizBank.answers.size };
      this.deletedAttempts.push(...this.quizHistory.map((a) => a.id));
      this.quizHistory = [];
      this.attempts.clear();
      this.quizBank.answers.clear();
      this.cleared.quiz++;
      return res;
    }
    if (path === '/api/quiz/attempts' && method === 'POST') {
      const req = CreateAttemptRequest.parse(body);
      // As on the server: every node must be on the roadmap of one of the topics.
      const onTopics = new Set(
        this.quizRoadmap
          .filter((t) => req.topics.includes(t.slug))
          .flatMap((t) => t.nodes.map((x) => x.id)),
      );
      if (req.nodes?.some((id) => !onTopics.has(id)))
        return this.status(400, 'unknown_node', 'Unknown roadmap node for these topics');
      // The fundamentals fixtures stand in for any fundamentals topics, and probability's questions
      // (the one quant bank with questions) for any quant topics.
      const isQuant = (slug: string) =>
        slug === QUANT_TOPIC || this.quizTopics.some((t) => t.slug === slug && t.track === 'quant');
      const pool = [
        ...(req.topics.some((t) => !isQuant(t)) ? QUIZ_QUESTIONS : []),
        ...(req.topics.some(isQuant) ? QUANT_QUESTIONS : []),
      ];
      const a = makeAttempt({
        id: uuid(),
        mode: req.mode,
        topics: req.topics,
        // As on the server: open questions only in a discussion, never otherwise.
        questions: pool.filter(
          (q) => (q.type === 'short') === (req.mode === 'discussion'),
        ) as unknown as QuizAttempt['questions'],
      });
      this.attempts.set(a.id, a);
      return a;
    }
    r = m(/^\/api\/quiz\/attempts\/([0-9a-f-]{36})(\/.*)?$/);
    if (r) {
      const id = r[1] ?? '';
      if (this.deletedAttempts.includes(id))
        return this.status(404, 'not_found', 'Attempt not found');
      if ((r[2] ?? '') === '' && method === 'DELETE') {
        this.deletedAttempts.push(id);
        this.attempts.delete(id);
        this.quizHistory = this.quizHistory.filter((x) => x.id !== id);
        return { attemptId: id };
      }
      let a = this.attempts.get(id);
      if (!a) {
        a = makeAttempt({ id, mode: this.quizMode });
        this.attempts.set(id, a);
      }
      const rest = r[2] ?? '';
      if (rest === '' && method === 'GET') return a;
      if (rest === '/answers' && method === 'POST') {
        const req = SubmitAnswerRequest.parse(body);
        a.responses[req.questionId] = req.response;
        const fb = QUIZ_FEEDBACK[req.questionId]?.(req.response);
        if (!fb) return this.status(400, 'bad_question', 'Unknown question.');
        if (a.mode === 'exam') return { recorded: true };
        let feedback: AnswerFeedback = fb;
        if (req.response.type === 'short' && this.aiKey.state !== 'active') {
          feedback =
            req.response.selfGrade === undefined
              ? {
                  ...fb,
                  gradedBy: 'self',
                  feedback: null,
                  needsSelfGrade: true,
                  score: 0,
                  correct: false,
                }
              : {
                  ...fb,
                  gradedBy: 'self',
                  feedback: null,
                  needsSelfGrade: false,
                  score: req.response.selfGrade,
                  correct: req.response.selfGrade >= 0.5,
                };
        }
        a.feedback = [...a.feedback.filter((f) => f.questionId !== req.questionId), feedback];
        return feedback;
      }
      if (rest === '/discussion' && method === 'POST') {
        const req = DiscussionReplyRequest.parse(body);
        if (this.aiKey.state !== 'active')
          return this.status(409, 'ai_key_missing', 'Add your AI API key first');
        const turns: DiscussionTurn[] = [
          ...(a.discussion[req.questionId] ?? []),
          { role: 'candidate', text: req.text },
        ];
        const said = turns.filter((t) => t.role === 'candidate');
        // One follow-up, then the question is closed and graded.
        const closed = said.length >= 2;
        const topic = a.questions.find((qq) => qq.id === req.questionId)?.topic;
        if (!closed)
          turns.push({
            role: 'interviewer',
            text: topic === QUANT_TOPIC ? QUANT_FOLLOW_UP : DISCUSSION_FOLLOW_UP,
          });
        a.discussion = { ...a.discussion, [req.questionId]: turns };
        if (!closed) return { turns, feedback: null };
        const response = { type: 'short' as const, text: said.map((t) => t.text).join('\n\n') };
        const feedback = QUIZ_FEEDBACK[req.questionId]?.(response);
        if (!feedback) return this.status(400, 'bad_question', 'Unknown question.');
        a.responses[req.questionId] = response;
        a.feedback = [...a.feedback, feedback];
        return { turns, feedback };
      }
      if (rest === '/finish' && method === 'POST') {
        const feedback = a.questions.map((qq) => {
          const resp = a.responses[qq.id];
          const existing = a.feedback.find((f) => f.questionId === qq.id);
          if (existing) return existing;
          const fn = QUIZ_FEEDBACK[qq.id];
          if (!fn) throw new Error('no feedback');
          return resp
            ? fn(resp)
            : { ...fn({ type: 'short', text: '' }), score: 0, correct: false, feedback: null };
        });
        const score = feedback.reduce((s, f) => s + f.score, 0) / feedback.length;
        const next = QuizAttempt.parse({
          ...a,
          status: 'finished',
          feedback,
          score,
          finishedAt: new Date().toISOString(),
        });
        this.attempts.set(id, next);
        return next;
      }
    }
    return undefined;
  }

  private async playRun(
    runId: string,
    mode: Run['mode'],
    script: RunScript,
    language: Run['language'],
  ) {
    const queued = this.runs.get(runId);
    if (!queued) return;
    this.push({ type: 'run.created', run: queued });
    await sleep(120);
    this.push({ type: 'run.progress', runId, event: { type: 'started' } });
    if (language !== 'python') {
      this.push({ type: 'run.progress', runId, event: { type: 'compiling' } });
      await sleep(this.runDelayMs / 2);
    }
    const final = { ...script(runId, mode), mode, padId: queued.padId, language };
    if (mode === 'file' && final.file?.stdout) {
      for (const line of final.file.stdout.split(/(?<=\n)/)) {
        this.push({
          type: 'run.progress',
          runId,
          event: { type: 'output', stream: 'stdout', chunk: line },
        });
        await sleep(80);
      }
    } else if (final.compile?.ok !== false) {
      const total = final.total || 1;
      for (let done = 0; done <= total; done += Math.max(1, Math.floor(total / 4))) {
        this.push({ type: 'run.progress', runId, event: { type: 'running', done, total } });
        await sleep(this.runDelayMs / 6);
      }
    }
    await sleep(this.runDelayMs / 2);
    this.runs.set(runId, final);
    this.push({ type: 'run.finished', run: final });
  }
}

function defaultScript(mode: Run['mode']): RunScript {
  switch (mode) {
    case 'file':
      return (id) => RUNS.fileOk(id);
    case 'samples':
      return (id) => RUNS.samplesAccepted(id);
    case 'custom':
      return (id) => RUNS.customRan(id);
    case 'submit':
      return (id) => RUNS.submitAccepted(id);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export { RUNS };
