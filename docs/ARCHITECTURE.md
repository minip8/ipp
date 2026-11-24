# interview++ architecture

A practice-interview site: CoderPad-style coding pads (C++, Python, Java) with an AI interviewer
that watches and speaks up unprompted, plus knowledge quizzes. Strangers can sign up and run code,
so untrusted-code execution is designed as a hostile-input problem. The operator pays for no model
usage: the AI features run only on an Anthropic API key each user saves themselves (§7.1).

`packages/contracts` is the source of truth for every shape that crosses a process boundary.
If this document and the contracts disagree, the contracts win; fix the document.

## 1. Topology

```
 browser ──HTTP /api/* (Next rewrite, same origin, cookie session)──┐
    │                                                               ▼
    │  WS /ws/pads/:id  (events)        ┌──────────── apps/api (Node, Hono) ───────────┐
    └─ WS /collab (Yjs, Hocuspocus) ───▶│ REST · auth · WS gateway · Yjs server        │
                                        │ interviewer orchestrator (packages/interviewer)│──▶ Claude API
 apps/web (Next.js) ── SSR fetch ──────▶│ queue producer / result consumer             │
                                        └───────┬───────────────────────┬──────────────┘
                                                │ Postgres (Drizzle)    │ Redis
                                                ▼                       ▼
                                           [ postgres ]   judge:jobs ─▶ apps/judge (Rust) ─▶ judge:results
                                                                          │ Docker API
                                                                          ▼
                                                              one hardened container per run
                                                              (gVisor runtime, no network)
```

| Unit | Stack | Owns |
|---|---|---|
| `apps/web` | Next.js App Router, React, TypeScript, Tailwind, shadcn/ui, Monaco, Yjs | All UI. No business logic, no secrets. |
| `apps/api` | Node, Hono, Better Auth, Drizzle, Hocuspocus, `ws`, ioredis, pino | HTTP API, auth, authorization, rate limits, WebSockets, Yjs persistence, queueing runs, redacting hidden tests, hosting the interviewer. |
| `apps/judge` | Rust (tokio, bollard, redis, tree-sitter, serde) | Class extraction, driver generation, sandboxed compile/run, verdicts. Only talks to Redis and the local Docker daemon. No database access, no secrets. |
| `packages/contracts` | Zod | Shared schemas/types, limits, scaffold generator, cross-language fixtures. |
| `packages/db` | Drizzle + postgres.js | Schema, migrations, seed (loads `packages/content`). |
| `packages/interviewer` | `@anthropic-ai/sdk` | Prompts, speak/stay-silent policy, streaming replies, assessment, short-answer grading, key verification. Interface in `src/types.ts`. |
| `packages/content` | YAML/Markdown/JSON | Coding problems and quiz bank, validated by contracts. |
| `infra/sandbox` | Dockerfiles | One image per language. |

Rust lives in a Cargo workspace at the repo root (`Cargo.toml`, members `apps/judge`, `crates/*`).

Ports in development: web 3000, api 4000, postgres 5432, redis 6379.

## 2. Repository conventions

- pnpm workspaces + Turborepo. Internal packages export TypeScript source (`"exports": "./src/index.ts"`); no build step. Apps: `tsx` for the API, `transpilePackages` in Next.
- **Dependency installs race.** Several people/agents work in this tree at once. Wrap every install: `flock /home/matt/Documents/code/ipp/.pnpm-install.lock pnpm add --filter <pkg> <dep>`. pnpm blocks postinstall scripts by default; allow a package with `pnpm approve-builds <name>` (also under the flock).
- One env file: `/.env` at the repo root (see `.env.example`). Each app loads it itself and validates with Zod at boot. Every variable has a development default except real secrets; in `NODE_ENV=production` missing values are fatal. There is no operator Anthropic key: the API never reads `ANTHROPIC_API_KEY` / `ANTHROPIC_KEY` (only the developer script `packages/interviewer/scripts/simulate.ts` does). Never log or print secrets, including users' API keys.
- Biome for lint/format, Vitest for unit tests, Playwright for browser tests, `cargo test` + `cargo clippy` for Rust.
- Every package has `typecheck` and `test` scripts. Keep them green.
- The machine has ~7 GB RAM and other builds are running. Do not run several heavy builds at once; prefer `tsc --noEmit` and tests over `next build`; `cargo build -j 4`.
- Do not `git commit`. Do not edit another unit's directory; if a contract needs to change, change `packages/contracts` minimally, keep its tests green, and say so in your report.

## 3. Data model (Postgres)

Better Auth owns `user`, `session`, `account`, `verification` (text ids). App tables:

| Table | Key columns |
|---|---|
| `problems` | `slug` pk, title, difficulty, tags text[], statement, signature jsonb, limits jsonb, interviewer_notes, reference_solutions jsonb, source jsonb |
| `problem_tests` | problem_slug, idx, hidden, data jsonb (`TestCase`) |
| `pads` | id uuid, owner_id, title, problem_slug, language, status, duration_min, interviewer jsonb, share_token, started_at, ended_at |
| `pad_members` | pad_id, user_id, role |
| `pad_docs` | pad_id pk, state bytea (merged Yjs state), updated_at |
| `pad_updates` | pad_id, seq, at, update bytea — append-only Yjs history for playback, coalesced to at most one row per ~2 s of editing |
| `messages` | id, pad_id, role, kind, intent, text, via, user_id, created_at |
| `interviewer_notes` | pad_id, at, note — private notes the interviewer writes to itself |
| `timeline_events` | id, pad_id, at, event jsonb |
| `runs` | id, pad_id, user_id, mode, language, source, status, verdict, result jsonb (full `JudgeResult`), hidden_ids text[], created_at, finished_at |
| `reports` | pad_id pk, status, stats jsonb, assessment jsonb, generated_at |
| `quiz_topics` | slug pk, title, description |
| `quiz_questions` | id pk (slug), topic, subtopic, difficulty, type, data jsonb (`QuizQuestion`) |
| `quiz_attempts` | id, user_id, mode, topics, question_ids, status, score, started_at, finished_at |
| `quiz_answers` | attempt_id, question_id, response jsonb, score, correct, feedback, graded_by, answered_at |
| `ai_usage` | user_id, day, messages, input_tokens, output_tokens — spend guard |

Seeding is idempotent upsert from `packages/content`; removing a question from content does not delete answers.

## 4. HTTP API

Base path `/api`, JSON, cookie session. The browser always calls the web origin; Next rewrites
`/api/*` to the API, so cookies are first-party and there is no CORS in the normal path. Errors are
`ApiError` with a meaningful status (400 validation, 401, 403, 404, 409, 413, 429 with `retryAfter`, 503 queue full).
Every body is validated with the contracts schema named below.

| Method and path | Request | Response |
|---|---|---|
| `ALL /api/auth/*` | Better Auth (email+password; Google and GitHub when configured) | |
| `GET /api/me` | | `{ user: { id, name, email, image } }` |
| `GET /api/config` | | `{ githubAuth, googleAuth, ai: { requiresUserKey: true, model, keyTtlHours } }` (server facts only; AI availability is per user) |
| `GET /api/ai-key` | | `AiKeyStatus` (`state` active / missing / rejected, `last4`, `expiresAt`, `problem`, `model`, `ttlHours`) |
| `PUT /api/ai-key` | `SaveAiKeyRequest` (`{ apiKey }`, ≤ 2 KB body) | `AiKeyStatus`; 422 `ai_key_rejected` when Anthropic refuses the key, 503 `ai_key_unverifiable` when Anthropic cannot be reached, 429 |
| `DELETE /api/ai-key` | | `AiKeyStatus` (`missing`) |
| `GET /api/problems?difficulty=&tag=&q=` | | `ProblemSummary[]` |
| `GET /api/problems/:slug` | | `ProblemDetail` |
| `POST /api/pads` | `CreatePadRequest` | `Pad` |
| `GET /api/pads` | | `PadSummary[]` (mine, newest first) |
| `GET /api/pads/:id` | | `PadDetail` |
| `PATCH /api/pads/:id` | `UpdatePadRequest` | `Pad` |
| `POST /api/pads/:id/end` | | `Pad` (starts report generation) |
| `POST /api/pads/join` | `{ shareToken }` | `{ padId }` |
| `GET /api/pads/:id/report` | | `Report` (`assessmentUnavailable` says why there is no assessment) |
| `POST /api/pads/:id/report/assessment` | | `Report` (owner only, after the pad ended, with a usable key; starts the assessment again) |
| `GET /api/pads/:id/playback` | | `Playback` |
| `POST /api/pads/:id/runs` | `CreateRunRequest` | `201 Run` (status `queued`) |
| `GET /api/runs/:id` | | `Run` |
| `POST /api/ws-ticket` | `{ padId }` | `WsTicketResponse` |
| `GET /api/quiz/topics` | | `QuizTopicStats[]` |
| `POST /api/quiz/attempts` | `CreateAttemptRequest` | `QuizAttempt` |
| `GET /api/quiz/attempts` | | `QuizAttemptSummary[]` |
| `GET /api/quiz/attempts/:id` | | `QuizAttempt` |
| `POST /api/quiz/attempts/:id/answers` | `SubmitAnswerRequest` | practice: `AnswerFeedback`; exam: `{ recorded: true }` |
| `POST /api/quiz/attempts/:id/finish` | | `QuizAttempt` (all feedback present) |
| `GET /healthz`, `GET /readyz` | | liveness / dependencies reachable |

Authorization: a pad is visible to its members only. Runs and chat require membership and an active pad.
The key endpoints act only on the signed-in user's own key and never return it (at most its last
four characters). `PadDetail.interviewerAvailable` / `interviewerKey` describe the pad owner's key
state; collaborators learn nothing else about it.
Problem responses never contain hidden tests, interviewer notes or reference solutions.
Quiz responses never contain answers or explanations for questions the user has not answered
(practice) or before the attempt is finished (exam).

## 5. Realtime

Two WebSocket endpoints on the API origin (`NEXT_PUBLIC_WS_URL`), both authenticated with a
single-use ticket (`POST /api/ws-ticket`, 30 s TTL, stored in Redis, bound to user and pad):

- `/ws/pads/:padId?ticket=` — JSON events, `ServerEvent` / `ClientEvent` in `contracts/src/ws.ts`.
  Run progress and results, chat, streamed interviewer replies, pad updates, and
  `interviewer.status` when the pad owner's key is saved, removed, expires or is rejected (so the
  interviewer panel changes without a reload).
- `/collab` — Hocuspocus (Yjs). Document `pad:<padId>` (layout in `YDOC`, `contracts/src/pad.ts`);
  the ticket is the Hocuspocus token. On first load the server seeds `code:<language>` for all three
  languages with `generateScaffold`. State is persisted to `pad_docs` (debounced) and history to
  `pad_updates`. Ended pads are read-only.

The API holds the live Y.Doc, so the interviewer reads the code server-side without the browser
sending it. A `code_changed` trigger is raised from the Hocuspocus change hook.

Single API instance is assumed for now (in-memory pad rooms and interviewer state). Scaling out
later means the Hocuspocus Redis extension and Redis pub/sub for the event channel; keep room
broadcast behind one small interface so that swap is local.

## 6. Running code

```
POST /pads/:id/runs ─▶ validate + rate limit ─▶ insert run (queued) ─▶ XADD judge:jobs
judge: XREADGROUP ─▶ [extract class + generate driver] ─▶ container: compile ─▶ run ─▶ compare
       PUBLISH judge:progress (best effort)            XADD judge:results
api:   XREADGROUP judge:results ─▶ update run ─▶ timeline event ─▶ WS run.finished (redacted)
                                               └▶ interviewer trigger run_finished (unredacted)
```

Modes (`RunMode`): `file` runs the editor contents as an ordinary program; `samples`, `custom`
and `submit` are judged against the problem's class. The API chooses the tests (`samples` = visible
tests, `submit` = all, `custom` = candidate inputs with `expected: null`) and the limits
(`limitsForTests` / `limitsForFile`). The job payload is self-contained; expected outputs travel to
the judge process but **never into the sandbox**: the driver prints actual results, the judge compares.

Queue protocol (`contracts/src/judge.ts`): Redis Streams with consumer groups, at-least-once.
The judge acknowledges a job only after its result is written, reclaims jobs from dead consumers
with `XAUTOCLAIM`, and reports `internal_error` for a job delivered more than twice. Results are
idempotent on `runId`. The API refuses new runs with 503 when the jobs stream is too long, allows
one in-flight run per user, and marks a run `internal_error` if no result arrives within
`totalMs + 30 s`.

### 6.1 Class extraction (judged modes)

The candidate's file is whatever they typed: the class, helpers, their own `main` with ad-hoc
tests, includes, `using` declarations, macros. The judge parses it with tree-sitter and builds a
translation unit containing the candidate's declarations but not their entry point:

- **C++**: keep every top-level item (preprocessor directives, `using`, namespaces, typedefs,
  globals, helper functions, structs, classes) in original order; drop the definition of `main`.
  Append the generated driver, which supplies its own `main`.
- **Python**: keep imports, class and function definitions, and top-level assignments; drop
  `if __name__ == "__main__":` blocks and other top-level statements with side effects.
- **Java**: keep imports and every top-level type, with `public` removed from top-level types so
  they can share a file with the driver class; candidate `main` methods are never invoked.

Before compiling, verify the required class and each required method exist (by name and arity) and
return `invalid_submission` with a specific message if not ("class `LRUCache` has no method `put`").
Compiler diagnostics must point at the candidate's own line numbers (`#line` in C++, an offset map
elsewhere), and must not show driver source.

### 6.2 Driver

Generated per language from `ProblemSignature` using the type table in `contracts/src/problem.ts`.
It reads tests as JSON, constructs the class, makes each call, and reports each call's return value
as JSON plus elapsed time. Exceptions are caught and reported per test. Candidate prints during a
test are captured as that test's stdout. Results are framed with a per-run nonce so candidate output
cannot be mistaken for a result. A crash or timeout on one test must not lose the remaining tests
(detect which test was in flight, record `runtime_error` / `time_limit`, resume after it).

### 6.3 Sandbox (the security boundary)

Threat: arbitrary native code from anonymous sign-ups — fork bombs, memory and disk exhaustion,
network scanning, kernel exploits, attempts to read other users' code or the hidden tests' answers.

One fresh container per job, destroyed afterwards, created through the Docker API with:

- runtime `runsc` (gVisor) — a user-space kernel between the code and the host. **Required whenever
  strangers can reach the service.** The judge refuses to start with any other runtime unless
  `JUDGE_ALLOW_INSECURE_RUNTIME=1` (local development), and logs loudly when that is set.
- `--network none`; read-only root filesystem; a size-limited tmpfs work directory; no volumes;
  no Docker socket.
- non-root uid, `--cap-drop ALL`, `no-new-privileges`, default seccomp profile.
- cgroup limits: memory (swap disabled), CPU quota, pids; ulimits for file size, open files, core.
  Under gVisor the host cgroup also holds the sandbox kernel, so exhausting it stops the whole
  sandbox: the in-sandbox supervisor kills a program over its memory limit first, the program's
  task limit is RLIMIT_NPROC inside the sandbox, and inodes on the tmpfs mounts are capped by the
  supervisor (`apps/judge/README.md`, "How gVisor differs").
- wall-clock limits enforced by the judge from outside; output streamed and cut at the byte cap.
- nothing secret inside: no expected outputs, no environment, no other user's data.

Process isolation between the judge and the rest: in production the judge runs on its own host or
VM with only outbound Redis access, a Redis ACL limited to the `judge:*` keys, and no route to
Postgres or the API. The API and web hosts have no Docker socket.

Abuse controls in the API: sign-in required; per-user and per-IP rate limits on runs (burst and
daily), on auth, on chat; body size caps (`CAPS`); queue depth cap.

## 7. AI interviewer

The interviewer reads and talks; it has no tools and never executes anything. It is driven by
`Trigger`s from the API (`packages/interviewer/src/types.ts`):

- **Candidate messages** (typed or spoken) always get a reply, streamed token by token.
- **Everything else** (session start, code changes, run results, paste/blur telemetry, idleness,
  time checkpoints) goes through a policy that first decides *in code* whether the moment is worth
  considering at all (debounce while typing, minimum gap between unprompted messages, cap on
  consecutive unanswered messages, proactivity setting), and only then asks the model for a
  structured decision: speak or stay silent, with intent and an optional private note. Staying
  silent is the common outcome.

Behaviour: opens the session and presents the problem; expects clarifying questions; nudges when
the candidate is stuck or silent; probes complexity and edge cases; gives hints on a ladder, never
the solution; when asked whether a solution looks right, reads the code and answers honestly as an
interviewer would (points at the failing case or the flawed step rather than rewriting it); reacts
to run results; manages time; wraps up. Style and proactivity come from `InterviewerSettings`.

Model: `claude-opus-5-5` by default (`INTERVIEWER_MODEL`), adaptive thinking, effort set explicitly
per call type (low for speak/stay-silent decisions, medium for replies, high for the final
assessment), prompt caching on the stable prefix (system prompt + problem + interviewer notes),
structured outputs for decisions/assessment/grading, refusal fallbacks enabled. Candidate code and
chat are untrusted input to the model and are delimited as data; platform events use the operator
channel rather than being mixed into candidate text.

Spend guard: `ai_usage` per user per day (`AI_DAILY_MESSAGE_LIMIT`, `AI_DAILY_INPUT_TOKEN_LIMIT`,
`AI_DAILY_OUTPUT_TOKEN_LIMIT`), the per-user chat rate limits, a per-pad cap on interviewer
messages and hard caps on context size. All model calls run on the user's own key (§7.1), so
these limits protect the user's spend and keep the server from being used as a relay.

At the end of a pad the interviewer produces a `ReportAssessment` on the owner's key; the report
page also offers playback of the editor history with run and chat markers.

### 7.1 Bring your own key

The site is public and the operator pays for no model usage. The interviewer, the end-of-interview
assessment and AI grading of quiz short answers run only on an Anthropic API key the user saved
(account menu → AI key, `/settings/ai-key`). Without one those features are unavailable and say so
where it matters (starting an interview, the pad's interviewer panel, the report, quiz short
answers, each with a one-click "add key" dialog that keeps the page as it is); short answers fall
back to self-grading; everything else works. The API has no code path that builds a model client
from the environment.

Because the interviewer runs server-side (it watches the live editor and speaks unprompted), the
key has to reach the server, which makes the operator a custodian of strangers' secrets:

- **Storage** (`apps/api/src/ai/keys.ts`): Redis only (`<prefix>aikey:<userId>`), never Postgres.
  The record holds the key encrypted with AES-256-GCM (fresh 96-bit IV per save, the user id as
  associated data) under a key derived with HKDF-SHA256 and a purpose label from
  `AI_KEY_ENCRYPTION_SECRET`, or `BETTER_AUTH_SECRET` when that is unset. A record that no longer
  decrypts (secret rotated) is deleted and counts as no key. Only the last four characters are
  stored in the clear. With Redis AOF on, the ciphertext also reaches the Redis volume on disk.
  The judge's Redis user cannot read these keys (`~judge:*`).
- **Expiry**: sliding, `AI_KEY_TTL_HOURS` (default 24) after the last use; every model call is a
  use. Also removed on `DELETE /api/ai-key` and on sign-out (the API wraps Better Auth's sign-out).
- **Saving** checks the key with one real call (a one-token message to the interviewer model,
  no retries) before storing it, and is rate limited per user (5 / 10 min, 15 / day) and per
  client address (10 / hour, 30 / day) so it is not a free key-checking oracle. Malformed input
  is refused locally without calling Anthropic.
- **Never echoed**: no endpoint, WebSocket event, log line or error message contains the key;
  responses carry at most the last four characters. Request bodies are never logged, the logger
  redacts `apiKey`, and model errors are scrubbed of anything shaped like a key.
- **Whose key**: a pad runs on its owner's key (collaborators talk to the interviewer on it and
  see only whether it is usable); quiz grading runs on the quiz taker's key.
- **Resolution** (`InterviewerDeps.resolveKey(scope)`): the interviewer asks for the key before
  every model call, so deleting or replacing it takes effect at once. Plaintext is held only in a
  small LRU cache of SDK clients per key id (32 clients, dropped after 10 min idle, and at once
  when the key is refused or replaced). Backoff after failures is per key, so one user's broken
  or rate-limited key never slows anyone else.
- **Runtime refusals**: 401 / 402 / 403, a "credit balance" 400, a model 404 or a spend-limit
  429 mark the key `rejected` (the ciphertext is replaced by last four + reason), post one notice
  in the pad chat telling the owner to update it, broadcast `interviewer.status`, and the
  interviewer stays silent until a new key is saved. An ordinary 429 is transient: the reply says
  Anthropic is rate-limiting the key and proactive turns back off. The UI distinguishes "no key"
  from "key rejected" everywhere.
- **Live availability**: `PadDetail.interviewerAvailable` is true when the owner's key is usable;
  saving or removing a key broadcasts `interviewer.status` to the owner's open pads (and the web
  app also updates locally on save), and a newly usable key lets the interviewer greet if it had
  not yet. A report without an assessment says why (`assessmentUnavailable`); the owner can add a
  key and ask for it (`POST /api/pads/:id/report/assessment`).

### Voice

Voice mode is a transport on top of the same chat channel: speech is transcribed to a
`chat.send` with `via: "voice"`, and interviewer messages are spoken. The first implementation is
browser-native (Web Speech API recognition and synthesis, with barge-in), behind a small
`VoiceTransport` interface in the web app so a server-side pipeline (WebRTC + streaming STT/TTS)
can replace it without touching the interviewer. In voice mode the interviewer is told to speak in
short conversational turns.

## 8. Quizzes

Question types (`QuizQuestion`): single choice, multiple choice, output prediction
(cppquiz-style: exact output / compile error / undefined / unspecified / runtime error), and short
free-form answers graded by the model against key points, on the quiz taker's own API key
(self-graded without one).
Practice mode gives feedback after each answer; exam mode at the end. Selection favours questions
the user has missed or not seen. Stats per topic.

## 9. Security checklist

- Sessions: httpOnly, SameSite=Lax, Secure in production; Origin check on state-changing requests.
- All input validated with Zod at the edge; sizes capped before parsing where possible.
- Authorization checked per resource on every route and on WebSocket connect.
- Security headers on the web app: a per-request nonce CSP set in `apps/web/src/proxy.ts`
  (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'` or `'unsafe-eval'` for
  scripts in production; `'strict-dynamic'` lets the nonced bundles load Monaco's AMD files and
  workers; styles keep `'unsafe-inline'` for Monaco), frame-ancestors none, nosniff, referrer
  policy. Every page is dynamically rendered so it gets a fresh nonce. `e2e/csp.spec.ts` checks for
  zero violations with the editor running.
- Markdown rendered without raw HTML. Model output is rendered as text/markdown, never as HTML.
- Secrets only in env; structured logs without request bodies or source code. Users' API keys only
  encrypted in Redis (§7.1).
- Rate limits in Redis (sliding window) keyed by user and by IP.
- Hidden tests, reference solutions and interviewer notes never reach the browser; redaction happens in exactly one place in the API and is unit-tested.

### Limits added by the security review

An adversarial pass with real hostile programs and requests found and fixed the following; each has
a regression test.

- **Judge**: parse-tree walks are iterative (a deeply nested file used to overflow a worker stack
  and abort the process); every write to the in-sandbox supervisor times out (a program could stop
  the supervisor and hang a judge slot); a result frame is at most 4 MiB and a run keeps at most
  4 MiB of actual values; a job that cannot be parsed still gets an `internal_error` result.
  One automatic retry in a fresh sandbox when the judge's own infrastructure fails.
- **API**: `X-Forwarded-For` is honoured only from `TRUSTED_PROXIES`; hidden-test times are rounded
  to 1-2-5 steps; `/collab` accepts 64 KB and one document before authentication and drops sockets
  that do not authenticate within 15 s; a pad's accumulated Yjs updates are capped at 16 MiB;
  presence identity must match the authenticated user; telemetry and language events are rate
  limited; request bodies nested deeper than 64 levels are rejected; daily per-user input and
  output token limits (`AI_DAILY_INPUT_TOKEN_LIMIT`, `AI_DAILY_OUTPUT_TOKEN_LIMIT`) in addition to
  the message limit.
- **Web**: shared-document content (whiteboard entries, presence names) is validated before
  rendering; the post-sign-in redirect only accepts same-site paths; output linkification is linear.

### Known limitations

- A program that breaks its sandbox (under gVisor: exhausts the container's memory, which stops
  the whole sandbox; or stops its supervisor) gets a verdict for that test and the job continues in
  a fresh sandbox, at most twice; after that the remaining tests are reported as not run.
- Start-up work (module-level code, static initialisers) is bounded by a fixed allowance rather
  than the per-test limit, so a solution can precompute before the first test is timed.
- Each hidden test still reveals its verdict and a coarse time. Only reporting hidden tests in
  aggregate would close that channel completely.
- Behind a reverse proxy, the proxy must append the client address to `X-Forwarded-For` and be
  listed in `TRUSTED_PROXIES`, otherwise per-IP limits see one address.
- Users' API keys are on the server while in use (encrypted at rest in Redis, plaintext in the
  API process's memory inside the client cache). Anyone with both the Redis data and the
  encryption secret, or control of the API process, can read them; the UI tells users to create
  a dedicated key with a spend limit.
- The key's expiry restarts on every model call, so a key used daily never expires on its own.
- A rejected key is not re-checked: after topping up credit the user saves the key again.
- CSP styles still allow `'unsafe-inline'` (Monaco and React inline styles).
- The queue-depth check is not atomic and can overshoot under concurrent submissions.
- Pads do not end automatically when the timer reaches zero; the interviewer calls time.

## 10. Out of scope for the first version

Language servers in the editor (clangd/pyright/jdtls), video calls, server-side voice pipeline,
multi-instance API, admin UI for content, email verification, linked-list/tree parameter types.
