# interview++ architecture

A prep site for quant and software interviews: CoderPad-style coding pads (C++, Python, Java)
with an AI interviewer that watches and speaks up unprompted, plus quizzes (§8): quant question
banks, which the Quant page orders into trader and researcher paths (`QUANT_PATHS`), and
fundamentals for developers. Strangers can sign up and run code, so untrusted-code execution is
designed as a hostile-input problem. The operator pays for no model usage: the AI features run
only on an API key each user saves themselves, from Anthropic, OpenAI, Google Gemini or
OpenRouter (§7.1).

`packages/contracts` is the source of truth for every shape that crosses a process boundary.
If this document and the contracts disagree, the contracts win; fix the document.

## 1. Topology

```
 browser ──HTTP /api/* (Next rewrite, same origin, cookie session)──┐
    │                                                               ▼
    │  WS /ws/pads/:id  (events)        ┌──────────── apps/api (Node, Hono) ───────────┐
    └─ WS /collab (Yjs, Hocuspocus) ───▶│ REST · auth · WS gateway · Yjs server        │
                                        │ interviewer orchestrator (packages/interviewer)│──▶ user's provider API
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
| `packages/interviewer` | `@anthropic-ai/sdk`, `fetch` | Prompts, speak/stay-silent policy, streaming replies, assessment, short-answer grading, key verification, model listing. One `ModelClient` per provider family (`src/model.ts` Anthropic, `src/openai-compat.ts` OpenAI-compatible); provider table in `src/providers.ts`. Interface in `src/types.ts`. |
| `packages/content` | YAML/Markdown/JSON | Coding problems and quiz bank, validated by contracts. |
| `infra/sandbox` | Dockerfiles | One image per language. |

Rust lives in a Cargo workspace at the repo root (`Cargo.toml`, members `apps/judge`, `crates/*`).

Ports in development: web 3000, api 4000, postgres 5432, redis 6379.

## 2. Repository conventions

- pnpm workspaces + Turborepo. Internal packages export TypeScript source (`"exports": "./src/index.ts"`); no build step. Apps: `tsx` for the API, `transpilePackages` in Next.
- **Dependency installs race.** Several people/agents work in this tree at once. Wrap every install: `flock /home/matt/Documents/code/ipp/.pnpm-install.lock pnpm add --filter <pkg> <dep>`. pnpm blocks postinstall scripts by default; allow a package with `pnpm approve-builds <name>` (also under the flock).
- One env file: `/.env` at the repo root (see `.env.example`). Each app loads it itself and validates with Zod at boot. Every variable has a development default except real secrets; in `NODE_ENV=production` missing values are fatal. There is no operator provider key: the API never reads `ANTHROPIC_API_KEY` / `ANTHROPIC_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` or any other provider key (only the developer script `packages/interviewer/scripts/simulate.ts` reads an Anthropic one). Never log or print secrets, including users' API keys.
- Biome for lint/format, Vitest for unit tests, Playwright for browser tests, `cargo test` + `cargo clippy` for Rust.
- Every package has `typecheck` and `test` scripts. Keep them green.
- The machine has ~7 GB RAM and other builds are running. Do not run several heavy builds at once; prefer `tsc --noEmit` and tests over `next build`; `cargo build -j 4`.
- Do not `git commit`. Do not edit another unit's directory; if a contract needs to change, change `packages/contracts` minimally, keep its tests green, and say so in your report.

## 3. Data model (Postgres)

Better Auth owns `user`, `session`, `account`, `verification` (text ids). App tables:

| Table | Key columns |
|---|---|
| `problems` | `slug` pk, title, difficulty, category, tags text[], statement, signature jsonb, limits jsonb, interviewer_notes, reference_solutions jsonb, languages text[], starter_code jsonb, harness jsonb (server-only), source jsonb |
| `problem_tests` | problem_slug, idx, hidden, data jsonb (`TestCase`) |
| `pads` | id uuid, owner_id, title, kind (`practice` / `room`), problem_slug (null: a blank room), language, status, duration_min (null: no time limit), interviewer jsonb, share_token, host_notes (rooms, host-only), started_at, ended_at |
| `pad_members` | pad_id, user_id, role (`owner`; `collaborator` = a room's candidate) |
| `pad_docs` | pad_id pk, state bytea (merged Yjs state), updated_at |
| `pad_updates` | pad_id, seq, at, update bytea — append-only Yjs history for playback, coalesced to at most one row per ~2 s of editing |
| `messages` | id, pad_id, role, kind, intent, text, via, user_id, created_at |
| `interviewer_notes` | pad_id, at, note — private notes the interviewer writes to itself |
| `timeline_events` | id, pad_id, at, event jsonb |
| `runs` | id, pad_id, user_id, problem_slug (the pad's problem when queued), mode, language, source, status, verdict, result jsonb (full `JudgeResult`), hidden_ids text[], created_at, finished_at |
| `reports` | pad_id pk, status, stats jsonb, assessment jsonb, generated_at |
| `quiz_topics` | slug pk, title, description, track (`fundamentals` or `quant`), position (study order), roadmap jsonb (`QuizRoadmapNode[]`) |
| `quiz_questions` | id pk (slug), topic, subtopic, difficulty, type, data jsonb (`QuizQuestion`) |
| `quiz_attempts` | id, user_id, mode, topics, question_ids, transcript jsonb (discussion turns per question), status, score, started_at, finished_at |
| `quiz_answers` | attempt_id, question_id, response jsonb, score, correct, feedback, graded_by, answered_at |
| `quiz_standalone_answers` | user_id, question_id (pk together), same grading columns — question-bank answers outside attempts, latest per question |
| `ai_usage` | user_id, day, messages, input_tokens, output_tokens — spend guard |

`user.is_anonymous` marks a guest (Better Auth's anonymous plugin): someone who joined a room by
its link with just a name (§4.1).

Seeding is idempotent upsert from `packages/content`; removing a question from content does not delete answers.

## 4. HTTP API

Base path `/api`, JSON, cookie session. The browser always calls the web origin; Next rewrites
`/api/*` to the API, so cookies are first-party and there is no CORS in the normal path. Errors are
`ApiError` with a meaningful status (400 validation, 401, 403, 404, 409, 413, 429 with `retryAfter`, 503 queue full).
Every body is validated with the contracts schema named below.

| Method and path | Request | Response |
|---|---|---|
| `ALL /api/auth/*` | Better Auth (email+password; Google and GitHub when configured) | |
| `GET /api/me` | | `{ user: { id, name, email, image, guest } }` |
| `GET /api/config` | | `{ githubAuth, googleAuth, ai: { requiresUserKey: true, model, keyTtlHours } }` (server facts only; `model` is the Anthropic default; AI availability is per user) |
| `GET /api/ai-key` | | `AiKeyStatus` (`state` active / missing / rejected, `provider`, `last4`, `expiresAt`, `problem`, `model` = the provider's default model, `ttlHours`) |
| `PUT /api/ai-key` | `SaveAiKeyRequest` (`{ provider?, apiKey }`, ≤ 2 KB body; provider inferred from the key shape when absent; a key that does not fit the provider is a 400 before any call) | `AiKeyStatus`; 422 `ai_key_rejected` when the provider refuses the key, 503 `ai_key_unverifiable` when it cannot be reached, 429 |
| `DELETE /api/ai-key` | | `AiKeyStatus` (`missing`) |
| `GET /api/ai-key/models` | | `AiModelList` (`provider`, `defaultModel`, `models[] {id, label, default}`, `source` live / fallback); 409 `ai_key_missing` without a usable key; 429 |
| `GET /api/problems?difficulty=&tag=&q=` | | `ProblemSummary[]` |
| `GET /api/problems/:slug` | | `ProblemDetail` |
| `POST /api/pads` | `CreatePadRequest` (`kind: 'room'` hosts an interview; a room may be `blank`) | `Pad` |
| `GET /api/pads` | | `PadSummary[]` (mine, newest first) |
| `GET /api/pads/:id` | | `PadDetail` |
| `PATCH /api/pads/:id` | `UpdatePadRequest` | `Pad` |
| `POST /api/pads/:id/end` | | `Pad` (starts report generation) |
| `DELETE /api/pads/:id` | | `DeletePadResponse` (owner: deletes the pad and everything attached, closing its live sockets; collaborator: removes only their own membership) |
| `GET /api/pads/invite/:token` | no session needed | `InviteInfo` (`kind`, `title`, `hostName`, `status`) |
| `POST /api/pads/join` | `{ shareToken }` | `{ padId }` (the session's user becomes a member; a guest may only join rooms) |
| `POST /api/pads/join-guest` | `JoinGuestRequest` (`shareToken`, `name`), no session needed | `{ padId }`, and a guest session cookie when there was no session (rooms only) |
| `POST /api/pads/:id/problem` | `ChangeProblemRequest` (`problemSlug` or null) | `PadProblem` (room host; also broadcast as `pad.problem`) |
| `GET /api/pads/:id/host` | | `HostView` (room host: interviewer notes, reference solutions, own notes) |
| `PUT /api/pads/:id/host/notes` | `UpdateHostNotesRequest` | `{ notes }` (room host; also after the room ended) |
| `POST /api/pads/:id/review` | `ReviewRequest` (`question?`) | `SolutionReview` (room host, on their key; 409 `ai_key_missing`, 429, 502 `review_failed`) |
| `GET /api/pads/:id/report` | | `Report` (`assessmentUnavailable` says why there is no assessment; a room's report is its host's alone and carries `hostNotes`) |
| `POST /api/pads/:id/report/assessment` | | `Report` (owner only, after the pad ended, with a usable key; starts the assessment again, or for a room writes it for the first time) |
| `GET /api/pads/:id/playback` | | `Playback` |
| `POST /api/pads/:id/runs` | `CreateRunRequest` | `201 Run` (status `queued`) |
| `GET /api/runs/:id` | | `Run` |
| `POST /api/ws-ticket` | `{ padId }` | `WsTicketResponse` |
| `GET /api/quiz/topics` | | `QuizTopicStats[]` |
| `GET /api/quiz/roadmap` | | `QuizRoadmapTopic[]` (topics in study order, each node with the caller's progress per node and subtopic) |
| `POST /api/quiz/attempts` | `CreateAttemptRequest` (optional `nodes` narrows topics to roadmap nodes) | `QuizAttempt` |
| `GET /api/quiz/attempts` | | `QuizAttemptSummary[]` |
| `GET /api/quiz/attempts/:id` | | `QuizAttempt` |
| `POST /api/quiz/attempts/:id/answers` | `SubmitAnswerRequest` | practice: `AnswerFeedback`; exam: `{ recorded: true }` |
| `POST /api/quiz/attempts/:id/discussion` | `DiscussionReplyRequest` | `DiscussionReplyResponse` (discussion mode: the turns so far, and `AnswerFeedback` once the question is closed) |
| `POST /api/quiz/attempts/:id/finish` | | `QuizAttempt` (all feedback present) |
| `GET /api/quiz/topics/:slug/questions` | | `QuizBank` (active questions as `PublicQuizQuestion` + the caller's status per question) |
| `GET /api/quiz/questions/:id` | | `QuizBankQuestion` (latest recorded response and its feedback, both null before answering) |
| `POST /api/quiz/questions/:id/answers` | `SubmitStandaloneAnswerRequest` | `AnswerFeedback` (graded like attempt answers; same rate limit) |
| `GET /healthz`, `GET /readyz` | | liveness / dependencies reachable |

Authorization: a pad is visible to its members only. Runs and chat require membership and an active pad.
The key endpoints act only on the signed-in user's own key and never return it (at most its last
four characters). `PadDetail.interviewerAvailable` / `interviewerKey` describe the pad owner's key
state and `PadDetail.interviewerModel` the model the interviewer runs on (which implies the key's
provider); collaborators learn nothing else about it.
Problem responses never contain hidden tests, interviewer notes or reference solutions; the one
exception is `GET /api/pads/:id/host`, for the host of a room.

### 4.1 Interview rooms

A pad of kind `room` is hosted by its owner, who is the interviewer; whoever joins by the invite
link is a candidate (role `collaborator`). The web app offers it as "Host an interview"
(`/dashboard?mode=host`, `src/features/room`; `/new` redirects to `/dashboard` with its query).

- **Guests.** A candidate needs no account: `POST /api/pads/join-guest` creates a guest user
  (`is_anonymous`) with the name they typed, signs them in and adds them to the room. This is the
  only way a guest is created (Better Auth's own `/sign-in/anonymous` is answered with 404), it
  needs a link to an active room, and it is rate limited per client address (`invites`, `auth`).
  A room takes at most `PAD_MEMBERS_MAX` people besides its host. A guest may use the pads they
  are a member of and nothing else: every other route goes through `requireAccount` (403
  `account_required`), and the web app sends a guest to sign-in anywhere but the room. A guest
  who then signs in or signs up keeps their rooms (memberships, runs and messages move to the
  account). Deleting a room deletes the guests who are in no other room.
- **No AI in the conversation.** A room's `interviewer.enabled` is always false, so no trigger
  reaches the interviewer. Chat is between people: the host's messages are stored with the
  `interviewer` role and their user id, the candidates' with `candidate`.
- **Host only.** The problem's interviewer notes and reference solutions, the host's own notes
  (`pads.host_notes`, never in the shared document), the AI second opinion, the report and the
  playback. A candidate's `PadDetail` says nothing about the host's key, and
  `interviewer.status` events go to the host's sockets only.
- **Changing the problem.** The host can move the room to another library problem or to a blank
  editor (`problem_slug` null: no statement, no tests, only `file` runs). The editor keeps one
  buffer per language: the server, on the live document, stashes each language's code under the
  problem being left (`YDOC.stash`) and puts back what was stashed for the new one, or its
  starter code the first time. A `problem` timeline event marks the change; runs carry the
  problem they were made on and the console shows those of the current one.
- **Runs** by a candidate count against the host's run allowance (the in-flight guard stays per
  user), so minting guests buys no extra runs.
- **AI for the host** (§7): a second opinion on the code as it is now (`POST …/review`, one
  model call, returned to the host and neither stored nor broadcast), and after the interview an
  assessment written only when the host asks for it. Both run on the host's own key, with the
  room prompts in `packages/interviewer/src/room-prompts.ts`: the model advises the host as an
  observer and never addresses the candidate.
Quiz responses never contain answers or explanations for questions the user has not answered
(practice) or before the attempt is finished (exam).

## 5. Realtime

Two WebSocket endpoints on the API origin (`NEXT_PUBLIC_WS_URL`), both authenticated with a
single-use ticket (`POST /api/ws-ticket`, 30 s TTL, stored in Redis, bound to user and pad):

- `/ws/pads/:padId?ticket=` — JSON events, `ServerEvent` / `ClientEvent` in `contracts/src/ws.ts`.
  Run progress and results, chat, streamed interviewer replies, pad updates, and
  `interviewer.status` when the pad owner's key is saved, removed, expires or is rejected (so the
  interviewer panel changes without a reload). Rooms add `member.joined` and `pad.problem`.
- `/collab` — Hocuspocus (Yjs). Document `pad:<padId>` (layout in `YDOC`, `contracts/src/pad.ts`);
  the ticket is the Hocuspocus token. On first load the server seeds `code:<language>` for all three
  languages with `problemScaffold` (the problem's starter code where it has some, else the generated scaffold; empty for a language the problem does not offer). State is persisted to `pad_docs` (debounced) and history to
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

**Problems with a harness** (language-restricted ones such as a C++ `UniquePtr<T>`; content files
`harness.<ext>` / `starter.<ext>`, `languages:` in `problem.yaml`). The candidate writes what the
statement asks for, starting from the problem's starter code; the signature describes a harness
class that drives their code. For judged runs the API appends the harness to the candidate's
source before queueing (`composeJudgedSource` in `contracts/src/harness.ts`, also used by
`scripts/judge-all.ts`), so the judge sees one ordinary file and needs no special handling. In
C++ the composition is `<candidate>[\n]#line 1 "tests.cpp"\n<harness>`: the candidate's lines keep
their numbers (`solution.cpp:N`), and errors inside the harness (typically a member it uses is
missing) read `tests.cpp:N`, which the web keeps out of the editor and explains in the console.
The run row stores only the candidate's source; `file` runs are untouched; `CAPS.sourceBytes`
applies to the candidate's part. The harness is server-only (never in a problem response); the
interviewer gets it. Pads, random picks, language switches and judged runs refuse a language the
problem does not offer (`language_unavailable`).

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

Models: each provider has a default interviewer model, overridable by env (§7.2). Effort is set
explicitly per call type (low for speak/stay-silent decisions, medium for replies, high for the
final assessment); structured outputs (a strict JSON schema) for decisions/assessment/grading;
every call streams under one overall deadline. On Anthropic: adaptive thinking, prompt caching on
the stable prefix (system prompt + problem + interviewer notes), server-side refusal fallbacks
(not for Haiku, which has none). On OpenAI-compatible APIs the system blocks become one leading
system message, mid-conversation operator messages keep the system role (`developer` on OpenAI),
effort is `reasoning_effort` (OpenAI, Gemini) or `reasoning.effort` (OpenRouter), and cached
prompt tokens are reported as cache reads. Candidate code and chat are untrusted input to the model
and are delimited as data; platform events use the operator channel rather than being mixed into
candidate text.

Spend guard: `ai_usage` per user per day (`AI_DAILY_MESSAGE_LIMIT`, `AI_DAILY_INPUT_TOKEN_LIMIT`,
`AI_DAILY_OUTPUT_TOKEN_LIMIT`), the per-user chat rate limits, a per-pad cap on interviewer
messages and hard caps on context size. All model calls run on the user's own key (§7.1), so
these limits protect the user's spend and keep the server from being used as a relay.

At the end of a pad the interviewer produces a `ReportAssessment` on the owner's key; the report
page also offers playback of the editor history with run and chat markers.

In an interview room (§4.1) a person interviews and the model only advises that person:
`Interviewer.reviewSolution` (purpose `review`) and `generateRoomAssessment`, both fed by
`InterviewerDeps.loadRoomContext` (which, unlike `loadContext`, may have no problem and includes
the host's notes).

### 7.1 Bring your own key

The site is public and the operator pays for no model usage. The interviewer, the end-of-interview
assessment and AI grading of quiz short answers run only on an API key the user saved (account
menu → AI key, `/settings/ai-key`), from one of the providers in §7.2. One key per user; saving a
key of another provider replaces it. Without one those features are unavailable and say so
where it matters (starting an interview, the pad's interviewer panel, the report, quiz short
answers, each with a one-click "add key" dialog that keeps the page as it is); short answers fall
back to self-grading; everything else works. The API has no code path that builds a model client
from the environment.

Because the interviewer runs server-side (it watches the live editor and speaks unprompted), the
key has to reach the server, which makes the operator a custodian of strangers' secrets:

- **Storage** (`apps/api/src/ai/keys.ts`): Redis only (`<prefix>aikey:<userId>`), never Postgres.
  The record holds the provider and the key encrypted with AES-256-GCM (fresh 96-bit IV per save;
  the user id and the provider as associated data, so a record can neither be moved to another
  user nor relabelled to send the key to another provider) under a key derived with HKDF-SHA256
  and a purpose label from `AI_KEY_ENCRYPTION_SECRET`, or `BETTER_AUTH_SECRET` when that is unset.
  Records written before there were providers (`v: 1`, user-only associated data) are Anthropic
  keys and keep working. A record that no longer decrypts (secret rotated, tampered) is deleted
  and counts as no key. Only the provider and the last four characters are stored in the clear.
  With Redis AOF on, the ciphertext also reaches the Redis volume on disk. The judge's Redis user
  cannot read these keys (`~judge:*`).
- **Expiry**: sliding, `AI_KEY_TTL_HOURS` (default 24) after the last use; every model call is a
  use. Also removed on `DELETE /api/ai-key` and on sign-out (the API wraps Better Auth's sign-out).
- **Saving** checks the key with one cheap real call before storing it (no retries): a tiny
  message to the provider's default model (Anthropic, OpenAI, Gemini) or OpenRouter's key endpoint
  (`GET /key`, which generates nothing). It is rate limited per user (5 / 10 min, 15 / day) and per
  client address (10 / hour, 30 / day) so it is not a free key-checking oracle. The request names
  the provider chosen in the UI; malformed input, or a key whose shape belongs to another provider,
  is refused locally without calling anyone.
- **Fixed endpoints**: every provider's base URL is a constant in `packages/interviewer/src/providers.ts`
  (`api.anthropic.com`, `api.openai.com/v1`, `generativelanguage.googleapis.com/v1beta[/openai]`,
  `openrouter.ai/api/v1`). Nothing a user sends (key, provider, model id) can change where a key is
  sent; the model id only goes into the request body and is validated as a plain id.
- **Never echoed**: no endpoint, WebSocket event, log line or error message contains the key;
  responses carry at most the last four characters. Request bodies are never logged, the logger
  redacts `apiKey`, and model errors are scrubbed of anything shaped like a key (`sk-ant-…`,
  `sk-or-…`, `sk-…`, `AIza…`, `AQ.…`, bearer tokens). Listing models sends no key where the
  catalogue is public (OpenRouter) and returns only ids and names.
- **Whose key**: a pad runs on its owner's key (collaborators talk to the interviewer on it and
  see only whether it is usable); quiz grading runs on the quiz taker's key.
- **Resolution** (`InterviewerDeps.resolveKey(scope)`): the interviewer asks for the key before
  every model call, so deleting or replacing it takes effect at once. Plaintext is held only in a
  small LRU cache of model clients per key id and model (32 clients, dropped after 10 min idle,
  and every client of a key at once when the key is refused or replaced). Backoff after failures
  is per key, so one user's broken or rate-limited key never slows anyone else. There is no code
  path that builds a client from the environment: the Anthropic SDK is always given the key
  explicitly, and the OpenAI-compatible client is plain `fetch` with an explicit bearer key.
- **Runtime refusals**: each provider's errors map to the same problems (`invalid` / `permission`
  / `billing` / `spend_limit`, plus transient `rate_limited`), see §7.2. A key problem marks the
  key `rejected` (the ciphertext is replaced by provider + last four + reason), posts one notice
  in the pad chat naming the provider and telling the owner to update it, broadcasts
  `interviewer.status`, and the interviewer stays silent until a new key is saved. An ordinary 429
  is transient: the reply says the provider is rate-limiting the key and proactive turns back off.
  The UI distinguishes "no key" from "key rejected" everywhere.
- **Chosen model refused ≠ key refused**: a 404 "model not found" (or an "unsupported parameter"
  400) for a model the user *chose* does not reject the key. The interviewer switches that pad to
  the provider default, retries the call on it at once, posts one notice, and the host clears the
  pad's choice (`pad.updated` + `interviewer.status` with the model now used). Only when the
  provider's *default* model is refused does it count as a key problem (`permission`).
- **Live availability**: `PadDetail.interviewerAvailable` is true when the owner's key is usable;
  saving or removing a key broadcasts `interviewer.status` to the owner's open pads (and the web
  app also updates locally on save), and a newly usable key lets the interviewer greet if it had
  not yet. A report without an assessment says why (`assessmentUnavailable`); the owner can add a
  key and ask for it (`POST /api/pads/:id/report/assessment`).

### 7.2 Providers and models

| Provider | Client | Key shape | Default model (env) | Effort | Model list |
|---|---|---|---|---|---|
| Anthropic | `@anthropic-ai/sdk` (`AnthropicModelClient`) | `sk-ant-…` | `claude-opus-5-5` (`INTERVIEWER_MODEL`) | `output_config.effort` + adaptive thinking | `GET /v1/models`, models with adaptive thinking, effort and structured outputs; curated order Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5 (also the fallback list) |
| OpenAI | `OpenAICompatModelClient` | `sk-…` (not `sk-admin-`) | `gpt-6.2-astra` (`INTERVIEWER_MODEL_OPENAI`) | `reasoning_effort` | `GET /v1/models` filtered by id (gpt-/o-series chat models, no audio/realtime/image/embedding/dated snapshots) |
| Google Gemini | same, OpenAI-compatible endpoint | `AIza…` or `AQ.…` | `gemini-4-hydrogen` (`INTERVIEWER_MODEL_GEMINI`) | `reasoning_effort` | native `GET /v1beta/models`, `generateContent` text models |
| OpenRouter | same | `sk-or-…` | `openai/gpt-6.2-sol` (`INTERVIEWER_MODEL_OPENROUTER`) | `reasoning.effort` | public `GET /api/v1/models?supported_parameters=structured_outputs`, text-output models |

Error mapping: 401 → `invalid` everywhere (Gemini also `API_KEY_INVALID`); 403 → `permission`
(OpenRouter: a moderation block, not a key problem); 402 → `billing` (OpenRouter: `spend_limit`
when the key's own limit is hit); OpenAI 429 with `insufficient_quota` / `credit_balance_*` →
`billing`, `*_spend_limit_exceeded` / `usage_limit` → `spend_limit`, other 429 → `rate_limited`;
Gemini 429 → `rate_limited` (quotas reset), `FAILED_PRECONDITION` → `permission`; 404 → model
unavailable (plus `permission` for Anthropic, OpenAI and Gemini, which matters only for the
default model); 408/409/5xx are transient and retried twice before any output.

The user's choice is stored per interview as `InterviewerSettings.model` (`{ provider, id }`),
remembered by the new-interview preferences and changeable mid-interview (PATCH, owner only).
A pad call uses it only while the owner's key is from that provider, otherwise the provider
default (`effectiveModel` in contracts); quiz grading and key verification always use the
default. `GET /api/ai-key/models` lists the models live with the user's key (cached 10 min per
key, 30 s after a failure, rate limited, not "use" of the key); when listing fails it returns the
curated list (Anthropic) or just the default with `source: "fallback"`, so choosing a model never
blocks starting an interview. Adding a provider is one entry in `PROVIDERS` (base URL, default
model, client options, list, verify, error classifier) and one in contracts `AI_PROVIDERS` (label,
key shape, console links).

### Voice

Voice mode is a transport on top of the same chat channel: speech is transcribed to a
`chat.send` with `via: "voice"`, and interviewer messages are spoken. The first implementation is
browser-native (Web Speech API recognition and synthesis, with barge-in), behind a small
`VoiceTransport` interface in the web app so a server-side pipeline (WebRTC + streaming STT/TTS)
can replace it without touching the interviewer. In voice mode the interviewer is told to speak in
short conversational turns.

## 8. Quizzes

Question types (`QuizQuestion`): single choice, multiple choice, output prediction
(cppquiz-style: exact output / compile error / undefined / unspecified / runtime error), numeric
(one number, graded automatically), and short free-form answers graded by the model against key
points, on the quiz taker's own API key (self-graded without one).

A numeric answer is typed as an integer (`42`, `1,000`), a fraction of integers (`5/36`), a
decimal (`0.25`, `.5`, `1.5e-3`) or a percentage (`12.5%`); `parseNumeric` in
`packages/contracts/src/numeric.ts` reads each as an exact rational, the browser uses it to refuse
anything else before sending, and the API refuses it again with a 400. `numericMatches` grades:
equal as rationals is always right; a question with a `tolerance` (`abs` and/or `rel`) accepts
anything within it, however it is written; otherwise a decimal or a whole number within 0.5% of a
non-integer answer counts (three significant figures, so `0.333` for `1/3` but not `0.33`, and
`105` for `105.13`), a fraction must be exact, and a whole-number answer must be exact. The score is 1 or 0. The question's
`answer` is kept as text so a fraction never goes through a float; the feedback shows
`answerText` (Markdown, e.g. `$1/e \approx 0.368$`) or else the answer as written, and `unit` is
shown beside the input.

Short and numeric questions may carry `hints` (a ladder, gentlest first, none giving the answer)
and `followUps` (what to ask once the answer is in). They are interviewer material: server-only
like the reference answer, never in a response, not even after answering. In a discussion the
interviewer bases a follow-up for a stuck candidate on the first hint it has not used yet, and once
the key points are covered asks the first authored follow-up (at most one) before closing; with
neither it behaves as before. The grader sees them as context and does not require them. Rows
stored before these fields existed lack them (and `unit`), so the API and the interviewer read
them as `?? []`.

Every topic belongs to a track (`QUIZ_TRACKS`: `fundamentals`, the default, and `quant`), set in
`quiz/topics.yaml` and stored on `quiz_topics.track`; every topic shape the API returns carries
it, and the Quizzes page and the roadmap group topics by track. Quiz Markdown is rendered with
remark-math and KaTeX, so `$...$` and `$$...$$` are LaTeX and a literal dollar is `\$`; the
grading and discussion prompts tell the model the same. A content test enforces it: a
fundamentals topic has no math at all and no bare `$`, and every formula in a quant topic must
typeset with KaTeX (`packages/content/src/math.ts`, also run by `check`).

There are three modes. Practice gives feedback after each answer and exam at the end; both draw
only on the automatically graded types (numeric included), never short answers. Discussion draws
only on short answers and needs the user's key: each question is a conversation in which the candidate may speak
up to `DISCUSSION_MAX_TURNS` times. After each turn one model call judges everything said so far
against the key points and either writes a follow-up (which must not give the answer away) or
closes the question; closing records an ordinary AI-graded short answer whose text is everything
the candidate said, so results, stats and the question bank treat it like any other answer. The
turns are kept on the attempt (`transcript`), and nothing is stored when the model call fails.
Selection favours questions the user has missed or not seen. Stats per topic.
The question bank (`/quiz/topics/:slug`) holds a topic's whole bank, searchable and filterable by
difficulty, type and status, and answers any question in place with no attempt. It opens on an
overview of the subtopics (a card each, with progress); a subtopic (`?subtopic=`) lists its
questions, and an open question (`?question=`) sits beside its subtopic's list, where Next walks
on through the filtered bank from one subtopic into the next. Answering again
replaces the previous standalone answer. Status, stats and selection all use the latest
*countable* answer per question across standalone answers, practice and discussion answers and finished
exams (a running exam never shows up).

The roadmap (the Quizzes page's Roadmap view, `?view=roadmap&roadmap=<topic>&node=<id>`) draws each
topic as a layered graph of study areas. `quiz/roadmap.yaml` maps each topic to its nodes
(`QuizRoadmapNode`: id, short title, one-line description, the question `subtopics` it groups,
`requires`, the nodes of the same topic to learn first, and `related`, nodes of other topics that
go with it: a link is written on one side, listed on both in the details panel, draws no edge and
has no say in "next up"); the seed stores them on
`quiz_topics.roadmap` and the study order (the order of `quiz/topics.yaml`) on `position`.
`GET /api/quiz/roadmap` adds progress per node and subtopic from the same latest graded answers as
the topic stats. An area is complete when every question is answered with a mean score of at
least 0.7, and "next up" when it is not complete and everything it requires is; nothing is ever
locked. "Practise" starts a practice attempt with `nodes: [id]`: the server checks each node is
on the roadmap of a requested topic and narrows that topic's pool to the node's subtopics (other
requested topics stay whole), then selects as usual. The web client lays the graph out itself
(`features/quiz/roadmap-logic.ts`: longest-path layers, dummy lanes for long edges, barycentre
ordering, a least-squares x placement) and sizes it to the container, compact on phones.

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
- Hidden tests, reference solutions and interviewer notes never reach the browser; redaction happens in exactly one place in the API and is unit-tested. (A room's host reads the notes and solutions of the problem they chose, §4.1; hidden tests stay hidden from them too.)
- Guests (§4.1) exist only for the rooms they were invited to: created by a valid room link, refused by every route that is not a pad they are a member of.

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
- The OpenAI, Gemini and OpenRouter request/response and error shapes follow the providers'
  documentation and are tested against fakes only; Gemini's OpenAI-compatible error bodies and
  strict JSON-schema handling are not documented and are parsed defensively.
- The key's expiry restarts on every model call, so a key used daily never expires on its own.
- A rejected key is not re-checked: after topping up credit the user saves the key again.
- CSP styles still allow `'unsafe-inline'` (Monaco and React inline styles).
- The queue-depth check is not atomic and can overshoot under concurrent submissions.
- Pads do not end automatically when the timer reaches zero; the interviewer calls time. (A pad
  created with `durationMin: null` has no time limit: its clock shows the time elapsed, and the
  interviewer raises no clock checkpoints and is told not to bring up the time.)

## 10. Out of scope for the first version

Language servers in the editor (clangd/pyright/jdtls), video calls, server-side voice pipeline,
multi-instance API, admin UI for content, email verification, linked-list/tree parameter types.
