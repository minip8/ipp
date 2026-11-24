/**
 * Network interception for browser tests: a small stateful stand-in for apps/api, built only
 * from contract fixtures. It lives in the test suite, never in the app.
 *
 *   HTTP  /api/*            page.route
 *   WS    /ws/pads/:id      page.routeWebSocket (events are pushed by the test)
 *   WS    /collab           a real Hocuspocus server started by global-setup (see collab-server.ts)
 */

import {
  type AiKeyStatus,
  type AnswerFeedback,
  ClientEvent,
  CreateAttemptRequest,
  CreatePadRequest,
  CreateRunRequest,
  type Message,
  type Pad,
  type PadDetail,
  QuizAttempt,
  type Run,
  ServerEvent,
  SubmitAnswerRequest,
  UpdatePadRequest,
} from '@ipp/contracts';
import type { Page, WebSocketRoute } from '@playwright/test';
import {
  ACTIVE_PAD_ID,
  aiKeyStatus,
  ENDED_PAD_ID,
  iso,
  makeAttempt,
  makeMessage,
  makePadDetail,
  makePlayback,
  PAD_SUMMARIES,
  PROBLEM_DETAILS,
  PROBLEMS,
  QUIZ_FEEDBACK,
  QUIZ_HISTORY,
  QUIZ_TOPICS,
  REPORT_PENDING,
  REPORT_READY,
  RUNS,
  TWO_SUM,
  USER,
  uuid,
} from './fixtures';

type RunScript = (id: string, mode: Run['mode']) => Run;

export class MockBackend {
  signedIn = true;
  githubAuth = true;
  googleAuth = true;
  /** The signed-in user's own Anthropic key. Pads they own run on it. */
  aiKey: AiKeyStatus = aiKeyStatus('active');
  /** Bodies of PUT /api/ai-key (the tests assert the UI sent exactly what was pasted). */
  savedKeys: string[] = [];
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
  quizMode: 'practice' | 'exam' = 'practice';

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
      ws.onMessage((raw) => {
        const parsed = ClientEvent.safeParse(JSON.parse(String(raw)));
        if (!parsed.success) {
          ws.send(JSON.stringify({ type: 'error', code: 'bad_event', message: 'invalid event' }));
          return;
        }
        const ev = parsed.data;
        this.received.push(ev);
        if (ev.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        if (ev.type === 'chat.send') {
          // Like the real interviewer: silent without the pad owner's key.
          const padId = /\/ws\/pads\/([0-9a-f-]{36})/.exec(ws.url())?.[1] ?? '';
          const d = this.pads.get(padId);
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
    return {
      ...d,
      interviewerKey: this.aiKey.state,
      interviewerAvailable: this.aiKey.state === 'active',
    };
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
    if (!this.signedIn) return this.status(401, 'unauthorized', 'Sign in to continue.');
    if (path === '/api/me') return { user: USER };

    if (path === '/api/ai-key') {
      if (method === 'GET') return this.aiKey;
      if (method === 'DELETE') {
        this.setKey(aiKeyStatus('missing'));
        return this.aiKey;
      }
      if (method === 'PUT') {
        const apiKey = String((body as { apiKey?: unknown })?.apiKey ?? '');
        this.savedKeys.push(apiKey);
        if (apiKey.includes('revoked'))
          return this.status(
            422,
            'ai_key_rejected',
            'Anthropic did not accept this key. Check that you copied all of it and that it has not been revoked.',
          );
        await sleep(250); // the real API makes one call to Anthropic here
        this.setKey(aiKeyStatus('active', { last4: apiKey.slice(-4) }));
        return this.aiKey;
      }
    }

    if (path === '/api/problems') {
      const text = (q.get('q') ?? '').toLowerCase();
      return PROBLEMS.filter(
        (p) =>
          (!q.get('difficulty') || p.difficulty === q.get('difficulty')) &&
          (!q.get('tag') || p.tags.includes(q.get('tag') ?? '')) &&
          (!text || p.title.toLowerCase().includes(text)),
      );
    }
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
      const req = CreatePadRequest.parse(body);
      const slug = req.problemSlug ?? 'two-sum';
      const id = uuid();
      const detail = makePadDetail({
        pad: {
          id,
          problemSlug: slug,
          title: req.title ?? PROBLEMS.find((p) => p.slug === slug)?.title ?? 'Two Sum',
          language: req.language,
          durationMin: req.durationMin,
          interviewer: req.interviewer,
          startedAt: new Date().toISOString(),
        },
        messages: [],
      });
      this.pads.set(id, detail);
      return detail.pad;
    }
    if (path === '/api/pads' && method === 'GET') return PAD_SUMMARIES;
    if (path === '/api/pads/join' && method === 'POST') return { padId: ACTIVE_PAD_ID };

    r = m(/^\/api\/pads\/([0-9a-f-]{36})(\/.*)?$/);
    if (r) {
      const id = r[1] ?? '';
      const rest = r[2] ?? '';
      const pad = this.pads.get(id);
      if (!pad)
        return this.status(404, 'not_found', 'This pad does not exist or you are not a member.');
      if (rest === '' && method === 'GET') return this.detail(pad);
      if (rest === '' && method === 'PATCH') {
        const upd = UpdatePadRequest.parse(body);
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
        pad.pad = { ...pad.pad, status: 'ended', endedAt: new Date().toISOString() };
        this.push({ type: 'pad.updated', pad: pad.pad });
        return pad.pad;
      }
      if (rest === '/report') return { ...this.report, padId: id };
      if (rest === '/report/assessment' && method === 'POST') {
        if (this.aiKey.state !== 'active')
          return this.status(409, 'ai_key_missing', 'Add your Anthropic API key first');
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
        const queued = { ...RUNS.queued(req.mode, runId), padId: id, language: req.language };
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

    // quizzes
    if (path === '/api/quiz/topics') return QUIZ_TOPICS;
    if (path === '/api/quiz/attempts' && method === 'GET') return QUIZ_HISTORY;
    if (path === '/api/quiz/attempts' && method === 'POST') {
      const req = CreateAttemptRequest.parse(body);
      const a = makeAttempt({ id: uuid(), mode: req.mode, topics: req.topics });
      this.attempts.set(a.id, a);
      return a;
    }
    r = m(/^\/api\/quiz\/attempts\/([0-9a-f-]{36})(\/.*)?$/);
    if (r) {
      const id = r[1] ?? '';
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
