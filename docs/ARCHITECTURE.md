# interview++ architecture

A prep site for quant and software interviews: CoderPad-style coding pads (C++, Python, Java)
with an AI interviewer that watches and speaks up unprompted, plus quizzes (§8): quant question
banks, which the Quant track orders into trader and researcher paths (`QUANT_PATHS`), and
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

### 1.1 Web pages and tracks

The header's switch chooses a site track (`Track`: Software | Quant, §8) and holds the same three
tabs in each: `/{track}/interviews`, `/{track}/practice` and `/{track}/roadmap` (and
`/quant/practice/drill`, §8.1). Everything below the header is scoped to the track; each tab is one
page component taking the track. The switch goes to the same tab of the other track, keeping
`?view=history`, `?view=maps` and Interviews' `?mode=host` and nothing else. Arriving on a track
page remembers its track (`PUT /api/me/track`, `user.track`, §3); a page of no track (a pad, its
report, a quiz, a question bank, settings) shows the remembered one. URLs are built and read by
the pure `apps/web/src/lib/track.ts`.

- **Interviews** (`features/interviews`): what is under way, then "New interview" and "History"
  (`?view=history`). "New interview" opens with "Practise with the AI | Interview someone"
  (`?mode=host`). Practising is the **interview builder** (`features/interview-builder`, §4.2),
  the same component in both tracks: the track's presets, the plan as an ordered list of stages
  edited in place (any kind of stage and any topic in either track; an edited plan reads
  "Custom"), the interviewer's options, and Start, which creates the interview and opens stage
  0's pad. `?preset=` chooses a preset, `?problem=` makes a plan of one coding stage on that
  problem, the old `?path=` maps to the Trader and Researcher presets; the last plan per track
  is remembered in the browser. Interviewing someone is unchanged: a coding room (§4.1) in
  Software, a quant room (§8.4) in Quant, whose bank browser filters by site track
  (`topicInTrack`, starting on Quant) and still offers every question; the host's desk in the
  room, which searches on the server by a topic's home (`HostBankQuery.track`), has no track
  filter. The lists hold staged interviews of the track they were built in (`interviews.track`)
  and pads started on their own, which are in a track by their format (`padTrack`: coding pads
  and coding rooms Software, quant rounds and quant rooms Quant). A stage's pad is never a row
  of its own; an interview of one stage is shown as its pad.
- **A stage's pad and the interview page.** A pad that is a stage of several
  (`PadDetail.interview`) shows which ("Stage 2 of 3"); its End is "End stage", after which, or
  once its round has run out of questions, it offers the next stage (`next`) or ending the
  interview there. `/interviews/[id]` (`features/interview`, a page of no track, like a pad) is
  the hub between stages and the combined report: the stage to continue or start, each stage
  with its status and, once done, its report in brief with a link to the full one, and after the
  end the overall recommendation, labelled as arithmetic.
- **Practice** (`features/quiz/hub.tsx`): the track's quiz topics and the quiz setup (Quant adds
  the drill), Software's problem library (`?view=problems`: a problem's card starts it on your
  own, a pad with no interviewer and no clock that needs no AI key, or leads to the builder with
  the problem chosen), and the history of attempts with a topic of the track.
- **Roadmap** (`features/roadmap`): the study path (Quant's two, `?path=`) and the topic maps
  (`?view=maps&roadmap=<topic>&node=<id>`, §8).

A topic is in a track by `topicInTrack` (its home's track and `also`, §8); every list of a track's
topics (`topicsOf`) has the track's own topics first, then those shared into it, each in study
order. A URL naming a topic of the other track only goes on to that track. A pad's and its
report's way back is the Interviews tab of the pad's track. `/dashboard` stays the app's home
(sign-in lands there): it goes on to the remembered track's Interviews with the query kept, a
coding query (`problem`, `category`, `difficulty`, `random`) meaning Software and `format=quant`
Quant whatever is remembered (`format` is dropped, `homeTarget`); with no track remembered it first
asks which, the header then showing no track and no tab as current. `/new` does the same;
`/quiz` and `/quiz/topics` go to the current track's Practice (`?view=roadmap` to its topic maps);
`/software` and `/quant` to their Interviews.

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
| `pads` | id uuid, owner_id, title, kind (`practice` / `room`), format (`coding` / `quant`, §8.2), problem_slug (null: a blank room, and every quant pad), language (stored as `python` and unused for a quant pad), status, duration_min (null: no time limit), interviewer jsonb, share_token, host_notes (rooms, host-only), started_at, ended_at, interview_id and stage_index (the staged interview it is a stage of, §4.2; both null otherwise; unique together) |
| `interviews` | id uuid, owner_id, title, track (the site track it was built in), preset (null: built from nothing), stages jsonb (`InterviewStage[]`, the plan), interviewer jsonb (`InterviewSettings`), status, current (the latest stage started), started_at, ended_at — a staged interview (§4.2) |
| `quant_rounds` | pad_id pk (a quant pad, cascade), state jsonb (`QuantRoundState`, server-only: question ids, verdicts, hint rungs; a quant room's also `mode: 'hosted'` and the host's queue, §8.4), version (compare-and-swap guard), updated_at |
| `pad_members` | pad_id, user_id, role (`owner`; `collaborator` = a room's candidate) |
| `pad_docs` | pad_id pk, state bytea (merged Yjs state), updated_at |
| `pad_updates` | pad_id, seq, at, update bytea — append-only Yjs history for playback, coalesced to at most one row per ~2 s of editing |
| `messages` | id, pad_id, role, kind, intent, text, via, user_id, created_at |
| `interviewer_notes` | pad_id, at, note — private notes the interviewer writes to itself |
| `timeline_events` | id, pad_id, at, event jsonb |
| `runs` | id, pad_id, user_id, problem_slug (the pad's problem when queued), mode, language, source, status, verdict, result jsonb (full `JudgeResult`), hidden_ids text[], created_at, finished_at |
| `reports` | pad_id pk, status, stats jsonb, assessment jsonb, generated_at |
| `quiz_topics` | slug pk, title, description, track (the home: `fundamentals` or `quant`, §8), also text[] (other site tracks it shows in, `Track[]`, empty by default), position (study order), roadmap jsonb (`QuizRoadmapNode[]`) |
| `quiz_questions` | id pk (slug), topic, subtopic, difficulty, type, data jsonb (`QuizQuestion`) |
| `quant_games` | id pk (slug), topic, difficulty, data jsonb (`QuantGame`, server-only), active — market-making games for quant rounds (§8.3) |
| `quiz_attempts` | id, user_id, mode, topics, question_ids, transcript jsonb (discussion turns per question), status, score, started_at, finished_at |
| `quiz_answers` | attempt_id, question_id, response jsonb, score, correct, feedback, graded_by, answered_at |
| `quiz_standalone_answers` | user_id, question_id (pk together), same grading columns — question-bank answers outside attempts, latest per question |
| `quant_round_answers` | id, user_id (the pad's owner), pad_id (set null when the pad is deleted; unique with question_id), question_id, same grading columns (always `ai`), answered_at (when the question closed) — the judged questions of an ended quant round (§8.2) |
| `drill_runs` | id, user_id, duration_sec, level, categories text[], full_mix, by_category jsonb, correct, wrong, skipped, score, elapsed_ms, finished_at — one finished mental math drill run (§8.1) |
| `ai_usage` | user_id, day, messages, input_tokens, output_tokens — spend guard |

`user.is_anonymous` marks a guest (Better Auth's anonymous plugin): someone who joined a room by
its link with just a name (§4.1). `user.track` is the site track the user chose in the header
switch (`software` or `quant`; null until they choose, and always for a guest). It is ours, not
declared to Better Auth, which neither writes nor returns it.

Seeding is idempotent upsert from `packages/content`; removing a question from content does not delete answers.

## 4. HTTP API

Base path `/api`, JSON, cookie session. The browser always calls the web origin; Next rewrites
`/api/*` to the API, so cookies are first-party and there is no CORS in the normal path. Errors are
`ApiError` with a meaningful status (400 validation, 401, 403, 404, 409, 413, 429 with `retryAfter`, 503 queue full).
Every body is validated with the contracts schema named below.

| Method and path | Request | Response |
|---|---|---|
| `ALL /api/auth/*` | Better Auth (email+password; Google and GitHub when configured) | |
| `GET /api/me` | | `{ user: { id, name, email, image, guest, track } }` (`track`: `software`, `quant` or null, read from the row so a change shows at once; null for a guest) |
| `PUT /api/me/track` | `SetTrackRequest` (`{ track }`) | `SetTrackResponse` (`{ track }`); account only (403 `account_required` for a guest); 429 (`limits.trackChanges`: 30 a minute) |
| `GET /api/config` | | `{ githubAuth, googleAuth, ai: { requiresUserKey: true, model, keyTtlHours } }` (server facts only; `model` is the Anthropic default; AI availability is per user) |
| `GET /api/ai-key` | | `AiKeyStatus` (`state` active / missing / rejected, `provider`, `last4`, `expiresAt`, `problem`, `model` = the provider's default model, `ttlHours`) |
| `PUT /api/ai-key` | `SaveAiKeyRequest` (`{ provider?, apiKey }`, ≤ 2 KB body; provider inferred from the key shape when absent; a key that does not fit the provider is a 400 before any call) | `AiKeyStatus`; 422 `ai_key_rejected` when the provider refuses the key, 503 `ai_key_unverifiable` when it cannot be reached, 429 |
| `DELETE /api/ai-key` | | `AiKeyStatus` (`missing`) |
| `GET /api/ai-key/models` | | `AiModelList` (`provider`, `defaultModel`, `models[] {id, label, default}`, `source` live / fallback); 409 `ai_key_missing` without a usable key; 429 |
| `GET /api/problems?difficulty=&tag=&q=` | | `ProblemSummary[]` |
| `GET /api/problems/:slug` | | `ProblemDetail` |
| `GET /api/progress/problems` | | `ProblemProgress` (the caller's problems that are not new, latest activity first: `solved` with an accepted submission of theirs in any pad, else `attempted` with any run of theirs or a practice interview of their own on it) |
| `POST /api/pads` | `CreatePadRequest` (`kind: 'room'` hosts an interview; a room may be `blank`; `format: 'quant'` with an optional `queue` makes a quant room, §8.4) | `Pad` |
| `POST /api/pads/quant` | `CreateQuantPadRequest` (`path`, `durationMin` 20 / 30 / 45, `interviewer` without `enabled`, `title?`, `includeGame?`: a market-making game in the second slot, §8.3; absent, a trader round has one) | `Pad` (`format: 'quant'`, §8.2); 409 `ai_key_missing` without a usable key, 409 `quant_unavailable` when the path has too few questions, 429 (the `POST /api/pads` allowance) |
| `POST /api/pads/:id/round/quote` | `PostQuantQuoteRequest` (`index`, `bid`, `ask`, `size`; any member) | `QuantRoundView` (the quote posted as the poster's chat message, §8.3); 409 `wrong_format` on a pad that is not a quant pad, 409 with the round's refusal as the code (`bad_quote`, `quote_limit`, `wrong_index`, `not_game`, `wrong_phase`, `ended`, …), 429 (the chat allowance) |
| `GET /api/pads` | | `PadSummary[]` (mine, newest first, with `format`, and `quantPath` for a quant pad) |
| `GET /api/pads/:id` | | `PadDetail` (`round`: a quant pad's `QuantRoundView`, else null) |
| `PATCH /api/pads/:id` | `UpdatePadRequest` | `Pad` (a quant pad: 409 `wrong_format` with `language`; `interviewer.enabled` stays true) |
| `POST /api/pads/:id/end` | | `Pad` (starts report generation) |
| `DELETE /api/pads/:id` | | `DeletePadResponse` (owner: deletes the pad and everything attached, closing its live sockets; collaborator: removes only their own membership); 409 `in_interview` for the owner of a stage's pad (§4.2) |
| `POST /api/interviews` | `CreateInterviewRequest` (`track`, `preset?`, `title?`, `stages` 1 to 6, `interviewer` without `enabled`) | `InterviewStart` (`{ interview, padId }`: the interview, and stage 0's pad, started); 409 `ai_key_missing`; a plan that cannot run is refused before anything is created (404 for a problem or topic that is not there, 400 `language_unavailable`, 409 `quant_unavailable` naming the stage); 429 (the `POST /api/pads` allowance, once) |
| `GET /api/interviews` | | `Interview[]` (mine, newest first, at most 100) |
| `GET /api/interviews/:id` | | `Interview` (each stage's status, its pad once started and its report's headline once ended) |
| `POST /api/interviews/:id/next` | `AdvanceInterviewRequest` (`{ from }`) | `InterviewStart`: stage `from`'s pad ended and the next started, or after the last the interview ended (`padId` null); unchanged when it is no longer at `from` |
| `POST /api/interviews/:id/end` | | `Interview` (the stage under way ends; stages never started read `skipped`) |
| `DELETE /api/interviews/:id` | | `DeleteInterviewResponse` (the interview and every stage's pad) |
| `GET /api/pads/invite/:token` | no session needed | `InviteInfo` (`kind`, `title`, `hostName`, `status`) |
| `POST /api/pads/join` | `{ shareToken }` | `{ padId }` (the session's user becomes a member; a guest may only join rooms) |
| `POST /api/pads/join-guest` | `JoinGuestRequest` (`shareToken`, `name`), no session needed | `{ padId }`, and a guest session cookie when there was no session (rooms only) |
| `POST /api/pads/:id/problem` | `ChangeProblemRequest` (`problemSlug` or null) | `PadProblem` (room host; also broadcast as `pad.problem`) |
| `GET /api/pads/:id/host` | | `HostView` (room host: interviewer notes, reference solutions, own notes; a quant room's `round`, §8.4) |
| `GET`, `PUT`, `POST /api/pads/:id/host/round/*` | | a quant room's host: bank search, queue, pose, hint, follow-up, close, verdict, second opinion (§8.4) |
| `PUT /api/pads/:id/host/notes` | `UpdateHostNotesRequest` | `{ notes }` (room host; also after the room ended) |
| `POST /api/pads/:id/review` | `ReviewRequest` (`question?`) | `SolutionReview` (room host, on their key; 409 `ai_key_missing`, 429, 502 `review_failed`; 409 `wrong_format` in a quant room) |
| `GET /api/pads/:id/report` | | `Report` (`assessmentUnavailable` says why there is no assessment; a room's report is its host's alone and carries `hostNotes`; a quant pad's carries `quant`, §8.2); 409 `pad_active` before the pad ends |
| `POST /api/pads/:id/report/assessment` | | `Report` (owner only, after the pad ended, with a usable key; starts the assessment again, or for a room writes it for the first time) |
| `GET /api/pads/:id/playback` | | `Playback` |
| `POST /api/pads/:id/runs` | `CreateRunRequest` | `201 Run` (status `queued`); 409 `wrong_format` on a quant pad |
| `GET /api/runs/:id` | | `Run` |
| `POST /api/ws-ticket` | `{ padId }` | `WsTicketResponse` |
| `GET /api/quiz/topics` | | `QuizTopicStats[]` |
| `GET /api/quiz/roadmap` | | `QuizRoadmapTopic[]` (topics in study order, each node with the caller's progress per node and subtopic) |
| `POST /api/quiz/attempts` | `CreateAttemptRequest` (optional `nodes` narrows topics to roadmap nodes) | `QuizAttempt` |
| `GET /api/quiz/attempts` | | `QuizAttemptSummary[]` (with `answeredCount`) |
| `GET /api/quiz/attempts/:id` | | `QuizAttempt` |
| `DELETE /api/quiz/attempts/:id` | | `DeleteAttemptResponse` (one of the caller's attempts, any mode, running or finished, with its answers; 404 for anyone else's id; 429) |
| `DELETE /api/quiz/history` | | `ClearQuizHistoryResponse` (counts: every attempt of the caller's with its answers, and every question-bank answer; 429) |
| `POST /api/quiz/attempts/:id/answers` | `SubmitAnswerRequest` | practice: `AnswerFeedback`; exam: `{ recorded: true }` |
| `POST /api/quiz/attempts/:id/discussion` | `DiscussionReplyRequest` | `DiscussionReplyResponse` (discussion mode: the turns so far, and `AnswerFeedback` once the question is closed) |
| `POST /api/quiz/attempts/:id/finish` | | `QuizAttempt` (all feedback present) |
| `GET /api/quiz/topics/:slug/questions` | | `QuizBank` (active questions as `PublicQuizQuestion` + the caller's status per question) |
| `GET /api/quiz/questions/:id` | | `QuizBankQuestion` (latest recorded response and its feedback, both null before answering) |
| `POST /api/quiz/questions/:id/answers` | `SubmitStandaloneAnswerRequest` | `AnswerFeedback` (graded like attempt answers; same rate limit) |
| | | These two and the attempt routes that show answers (`GET …/attempts/:id`, `…/answers`, `…/discussion`, `…/finish`) are 409 `in_quant_interview` for a candidate in an active quant room (§8.4) |
| `POST /api/drill/runs` | `RecordDrillRunRequest` (config, results per category, `elapsedMs`) | `RecordDrillRunResponse` (the stored `DrillRun`, totals and score computed by the server, and `newBest`); 429 |
| `GET /api/drill/runs` | | `DrillHistory` (the latest `DRILL_HISTORY_LIMIT` runs newest first, bests per duration and level, `totalRuns`) |
| `DELETE /api/drill/runs/:id` | | `DrillHistory` left, bests recomputed (one of the caller's runs; 404 for anyone else's id; 429) |
| `DELETE /api/drill/runs` | | `DrillHistory` (empty: every run of the caller's, and so every best; 429) |
| `GET /healthz`, `GET /readyz` | | liveness / dependencies reachable |

Authorization: a pad is visible to its members only. Runs and chat require membership and an active pad.
The key endpoints act only on the signed-in user's own key and never return it (at most its last
four characters). `PadDetail.interviewerAvailable` / `interviewerKey` describe the pad owner's key
state and `PadDetail.interviewerModel` the model the interviewer runs on (which implies the key's
provider); collaborators learn nothing else about it.
Problem responses never contain hidden tests, interviewer notes or reference solutions; the one
exception is `GET /api/pads/:id/host`, for the host of a room. The library itself
(`GET /api/problems`) is the same for everyone; the viewer's own standing on it comes separately
from `GET /api/progress/problems`, which needs an account and reads only the caller's runs and
pads, so a room's host is not credited with the candidate's submissions (nor the other way
round). The web app marks each problem in the library and in a room's problem picker with the
question bank's marks (solved as right, attempted as part-way, new as unanswered) and filters the
library by them; a pad deleted takes its runs, and so its progress, with it. Nothing a member reads about an
active quant pad contains a question's id, answer, explanation, hints or follow-ups, a verdict, or
any question not yet posed (§8.2), nor a game's hidden values, fair value, marks, counterparty
notes or hints (§8.3); in a quant room the host reads all of that for the questions they posed or
queued, through `GET …/host` and `…/host/round/*` only (§8.4).

### 4.1 Interview rooms

A pad of kind `room` is hosted by its owner, who is the interviewer; whoever joins by the invite
link is a candidate (role `collaborator`). The web app offers it as "Interview someone" on the
Software track's Interviews tab (`/software/interviews?mode=host`, `src/features/room`; §1.1), a
quant room on the Quant track's.

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
- **Quant rooms** (§8.4): a room of format `quant` (`POST /api/pads` with `format: 'quant'`)
  interviews on questions of the bank instead of a library problem. Its host poses them one by
  one (or none, and just talks), sees each question's solution and material, records hints,
  follow-ups and their own verdicts, and asks the AI for a second opinion on a question or an
  assessment afterwards (`packages/interviewer/src/quant-room-prompts.ts`). The candidate sees
  only what was posed, and while the room is active the quiz will not show them answers.
Quiz responses never contain answers or explanations for questions the user has not answered
(practice) or before the attempt is finished (exam).

### 4.2 Staged interviews

A staged interview (`packages/contracts/src/interview.ts`) is a mock interview in several parts,
taken in one sitting with the AI interviewer: an ordered plan of up to six **stages**, each of
which becomes an ordinary practice pad when it starts. The interview is only the parent record
(`interviews`): the plan, which stage is under way, and through `pads.interview_id` and
`pads.stage_index` the stages' pads. The pad, round and report code know nothing of it.

| Stage | Is | Lengths (min) |
|---|---|---|
| `coding` | a coding pad on a named problem, or one drawn at random (by difficulty and category, in the stage's language, one the owner has not had before while there is one) | 30, 45, 60 |
| `questions` | a pad of format `quant` whose round is assembled from the stage's quiz topics, of either home (`assembleForTopics`): the rules of §8.2 without a path or a game | 15, 20, 30, 45 (2, 3, 4, 6 questions) |
| `game` | a pad of format `quant` whose round is one market-making game (§8.3) | 10, 15 |

- **Presets and custom plans.** `INTERVIEW_PRESETS` are starting points per site track (Software:
  a coding round, a technical screen, an onsite loop; Quant: trader, researcher, quant developer,
  a single round); `presetStages` gives a preset's coding stages the user's language and adds the
  language's own topic to the question stages that ask for it. The builder may change anything,
  and a custom plan may mix stages of both tracks. `interviews.track` records where it was built:
  that track's Interviews tab lists it, whatever its stages are.
- **A stage is drawn when it starts** (`drawStage` in `apps/api/src/interviews/service.ts`), never
  before: its pad's clock starts then, and nothing of a later stage (the problem, the questions,
  a game's hidden values) exists to leak. The plan is checked as a whole when the interview is
  created (`assertPlanStartable`), so one that cannot run fails before anything exists. A later
  stage does not repeat an earlier one's questions (`recentlyPosed`).
- **Each stage has its own clock**, the pad's. The interview has none.
- **Moving on** (`next`) ends the stage being left through `endPad`, so its report and assessment
  are written as for any pad, then starts the next in one transaction with a compare-and-swap on
  `interviews.current`; the unique index on (interview_id, stage_index) backs it, so two calls at
  once start one pad. When the next stage cannot start, the interview stays where it was with
  that pad ended, and `next` can be asked for again. `next` does not check the AI key: a stage
  started after the key lapsed shows the key as missing, as any pad would.
- **Ending.** The last stage's pad ending, by whatever route, ends the interview (`endPad`). A
  round running out of questions does not end its pad (§8.2), so a questions or game stage ends
  when the candidate moves on or ends it. `end` ends the interview where it is; stages never
  started read `skipped` (`stageStatuses`). A stage's pad is deleted only with its interview.
- **A round's subject.** A round assembled from chosen topics has no path and carries a
  `QuantSubject` from its topics' homes: `quant`, `technical` (fundamentals topics only) or
  `mixed`. It chooses the interviewer's frame (§7.3) and what the round is called; a technical
  or mixed round never holds a game.
- **The interviewer knows its place.** For a pad of an interview of more than one stage the
  context carries `StagePosition` (which part this is, how many there are, what kind comes
  next), in the last system message so a stage's cached prefix is a standalone pad's. It opens
  and closes the stage as one part of a longer interview; so does the sweeper's canned close.
- **The report** is each stage's own (`GET /api/pads/:id/report`). `Interview` carries only each
  stage's headline (its report's status and recommendation), and the overall recommendation is
  arithmetic (`overallRecommendation`: the stages' recommendations averaged by planned length),
  not a model's judgement.
- **Who.** Accounts only, and only the owner (404 for anyone else). `PadDetail.interview` says
  where a stage's pad sits to its owner alone; a collaborator who joined by the pad's link sees an
  ordinary pad.

**Proven by tests**: `packages/contracts/test/interview.test.ts` (stages, statuses, the overall
recommendation, every preset a valid plan); `packages/content/test/interview-presets.test.ts`
(every preset can be filled from the bank); `apps/api/test/interviews.test.ts` (each stage kind,
plans refused before anything is created, the lazy start, `next` once under a race and retryable
after a failure, the last pad ending the interview, `end`, `delete`, the owner-only views, short
rounds and the sweeper's wording); `packages/interviewer/test/quant-subject.test.ts` (the quant
core unchanged byte for byte, the technical and mixed cores, the stage wording, the cached prefix
unchanged by a stage).

## 5. Realtime

Two WebSocket endpoints on the API origin (`NEXT_PUBLIC_WS_URL`), both authenticated with a
single-use ticket (`POST /api/ws-ticket`, 30 s TTL, stored in Redis, bound to user and pad):

- `/ws/pads/:padId?ticket=` — JSON events, `ServerEvent` / `ClientEvent` in `contracts/src/ws.ts`.
  Run progress and results, chat, streamed interviewer replies (`message.delta` under an id the
  posted `message.created` then takes, replacing the streamed text in place; or
  `message.discarded` when nothing will be posted under it), pad updates, and
  `interviewer.status` when the pad owner's key is saved, removed, expires or is rejected (so the
  interviewer panel changes without a reload). Rooms add `member.joined` and `pad.problem`. A quant
  pad adds `round.updated` (the whole `QuantRoundView`) after every change to its round and to each
  socket as it connects; it answers a `language` event with an `error` `wrong_format`, and of
  `telemetry` keeps only `blur` (on the timeline).
- `/collab` — Hocuspocus (Yjs). Document `pad:<padId>` (layout in `YDOC`, `contracts/src/pad.ts`);
  the ticket is the Hocuspocus token. On first load the server seeds `code:<language>` for all three
  languages with `problemScaffold` (the problem's starter code where it has some, else the generated scaffold; empty for a language the problem does not offer). A quant pad is seeded with nothing: it uses only `notes` (the scratchpad) and the whiteboard. State is persisted to `pad_docs` (debounced) and history to
  `pad_updates`. Ended pads are read-only.

The API holds the live Y.Doc, so the interviewer reads the code server-side without the browser
sending it. A `code_changed` trigger is raised from the Hocuspocus change hook; for a quant pad
the host turns it into `scratch_changed`, and drops `run_finished`, `telemetry` and
`language_changed` (`quantTrigger` in `apps/api/src/interviewer/host.ts`).

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
messages (`limits.interviewerMessagesPerPad`, 200, posted questions aside; a quant round's follows
its length instead when that allows more, `quantInterviewerMessagesPerMinute` 8 a minute, so 200,
240 and 360 for 20, 30 and 45 minutes: `interviewerMessageCap` in `apps/api/src/interviewer/host.ts`)
and hard caps on context size. The cap is checked (`checkBudget`) before every model call for a
pad; once it is reached the interviewer says so once and stops calling the model, and a quant
round's clock still nudges and closes with its canned lines. All model calls run on the user's own key (§7.1), so
these limits protect the user's spend and keep the server from being used as a relay. The daily
message limit defaults to 1500: it must cover a day of staged interviews (several pads in one sitting,
each with a spoken interviewer that answers often), so on any one pad the per-pad cap,
and over the day the daily token limits, are what bind first; the message limit is the backstop.

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
short conversational turns. What is spoken is prepared in the web app (`spokenText`,
`features/pad/questions.ts`) and only from posted messages, never from streamed text: in a quant
round a posted question is pointed to ("Question 2 is on your screen"), and every other interviewer
message goes through `speechOf` (`features/pad/voice/math-speech.ts`), a backstop for the prompt's
"say mathematics in words": `$...$` math is read as words (fractions, binomials, roots, powers,
subscripts, sums, Greek letters, operators and relations, factorials, percent, `E[X]`, `P(A | B)`,
`Var`, `Cov`), `\$10` is "10 dollars", Markdown markup is dropped, an unknown command is dropped
with its arguments read as they are, and a message with none of that is spoken exactly as written.
The chat shows the original. A coding pad's messages are spoken as written.

### 7.3 The interviewer in a quant round

A quant pad (§8.2) runs on the same per-pad pump, reply queue, key resolution, breakers and budget
as a coding pad; `hydrate` learns the format from `InterviewerDeps.loadQuantContext` (null: a
coding pad, which then behaves exactly as before) and hands the pad to
`packages/interviewer/src/quant/round.ts`. The server keeps every book of the round; the
interviewer only decides what to say and which step to ask for, and each trigger ends in at most
one model call and at most one `applyQuantStep`. It keeps a mirror of the round's version, phase
and clock, refreshed from every context load and step result, so a round that moved on without it
(closed by the API's sweeper while nobody was connected, §8.2) is picked up as it now is when
someone returns: a clock action due on the old mirror finds nothing due in the context it loads
and does nothing, a reply is decided on the current question, and a question posed meanwhile is
a fresh start for stalls and the unanswered count, as after a step of its own.

- **Each pass of the pump**, in order: a queued candidate message (a `turn` or a `close`; before
  the first question the opening and `start`; after the round a plain message through
  `saveMessage`); the clock (`quantDue` in `quant/clock.ts`: a nudge once the budget is up, a close
  for `timeout` after the grace, a close for `round_time` at the round's end); then the policy's
  greeting and stall moments. The policy runs with `quant` set: `scratch_changed` counts as typing
  activity, and there are no clock checkpoints, checkpoint reviews or approach checks. A nudge
  waits while the candidate has just spoken; a reply sent once the budget is up carries the nudge
  itself (`nudge: true`), so there is no separate message.
- **One structured call per turn**, the same for replies, the opening, nudges, stalls and closes
  for time, in every round with a game or without: purpose `turn`, `QuantTurnSchema` (in the
  order the model writes them: `reason`, `action` silent / stay / hint / follow_up / close, the
  game move `trade` none / buy / sell, `quantity` and `reveal`, then `hint_rung`, `message`,
  `score`, `summary`, `note`) and `QUANT_CALLS.turn` (medium effort), so the cached prefix is
  never invalidated by a change of effort or schema. The move comes before the message so it is
  decided first and the stream can check it before showing a word; on a bank question it is
  always none (and ignored if not). A turn read without the move fields is a turn with no move.
- **Streaming** (`quant/stream.ts`): replies (after the round too) and the opening stream their
  `message` while the model writes the JSON. `TurnJsonReader` follows the partial object and
  decodes the top-level `action`, `trade` and `message` strings and the `quantity` and `reveal`
  scalars across chunk boundaries (escapes, `\uXXXX` and surrogate pairs included; a backslash
  that starts no valid escape stands for itself, as in the repair before parsing), keeping the
  move as it stood when the message began; `MessageStream` shows nothing until `action` is known
  and is one that speaks (never `silent`) and the message has begun, then asks its gate (a game's,
  below; none on a bank question) what may show, then the message with `repairLatexEscapes` applied, leading whitespace
  and a role label dropped, holding back the few characters the repair may still change (a tab,
  return or newline until 15 characters follow it, a trailing `$` or `\`). The deltas go out under
  a fresh id; the step names it (`QuantStep.messageId`, optional) and `advanceRound` hands it back
  in `effects.say.messageId`, so the message `applyStep` inserts takes it; a canned reply or an
  after-round message takes it through `NewMessage.id`. The posted text is authoritative (it went
  through `stripJsonDebris`, `cleanSay` and `normaliseTurn`) and replaces the streamed text under
  the same id. When nothing will be posted under the id (an aborted call, a silent turn, a key
  failure, a step refused because the round moved on, a pad that ended), `message.discarded`
  drops it from every client; a failed, refused or invalid call, or a step refused on its content,
  posts its canned reply under the id instead, and a forced close that failed its canned line.
  Nudges, closes for time and stalls are not streamed (a candidate message often discards them),
  nor is text that will not be the model's (an empty forced close gets its canned line whole). The
  request is the same with or without streaming (`onText` is local), and a provider that does not
  stream structured output works without deltas. The web shows a streaming message with any
  formula not yet closed held back (`settledMath`, `components/math-guard.ts`), so `$\frac{5}{`
  never flashes as source or a KaTeX error, and speaks only posted messages. On a game a reply
  streams only when its move was written before the message and shows nothing the step has not
  yet made public: no reveal and no close (whose facts hold values); a trade's facts line is shown
  first, decided by the same normalisation the step uses, so the streamed text is the posted one.
  A reveal or a game's close is posted whole (in live runs, 2 to 4 turns a game).
- **Prompt** (`quant/prompts.ts`): `system[0]` is `QUANT_CORE` (the same for every quant pad),
  `system[1]` the current question in full (prompt, answer or reference and key points,
  explanation, numbered hints, follow-ups), both cache breakpoints; then this question's
  conversation (the posted question message is left out: it is in `system[1]`), with a breakpoint
  on the last interviewer turn; the final user turn holds the new candidate messages and
  `<candidate_scratchpad>`; the final system message holds the clocks, the books (hints given and
  the next rung, follow-up asked, whether closing ends the round), earlier questions as numbers
  only (topic, difficulty, time, hints, score: never their text, answer or verdict wording),
  settings, private notes and the task. Candidate text is only in user turns, neutralised. The
  core tells the model never to state the answer while the round is on, at a close to say at most
  whether the answer was right, never to announce or paraphrase the next question (the platform
  posts it), to treat thinking aloud as thinking and ask "is that your final answer?" rather than
  close on a tentative number, to run market-making and betting questions as a dialogue with the
  authored follow-ups as its next moves, to write mathematics as LaTeX in `$...$` with a literal
  dollar as `\$` (backslashes doubled in the JSON), and on voice to say mathematics in words.
  Three rules come from reading live transcripts (`scripts/simulate.ts --quant`): anything that
  points at the next step is a `hint`, however it is phrased, so the books count it, and a
  `stay` probe only asks about what the candidate already has; a candidate already past the next
  rung gets a hint in the interviewer's own words (rung 0), no bigger than a rung; and on a
  market-making or betting question (`DIALOGUE_TOPICS`) the recorded follow-up is only the first
  move, after which the dialogue goes on with `stay` turns while the question's time allows (the
  per-turn books say so, outside the cached prefix). A market-making game (§8.3) has its own
  section of the core (how a game runs, what the interviewer must and must not do, the verdict on
  decisions not dice), its own `system[1]` (`gameBlock`: the prompt, the mechanics in words, the
  author's counterparty playbook, the explanation, the hint ladder; nothing that changes with
  play, so it stays cached for the whole game), the game's books in the per-turn system message
  (`gameBooksLines`, below) and game variants of the reply, nudge, stall and forced-close tasks.
  Two rules of it come from live games: ask for a tighter or bigger market at most twice in a
  stage, then trade the market as it stands (a playbook with no cap had the interviewer ask five
  times while the candidate re-posted the same market), and ask any one question at most twice,
  then go on as if answered (a stage that reveals "after their answer" had it ask four times).
- **The books in code** (`normaliseTurn`, `quant/turn.ts`), so a step is never one the server would
  refuse for its own reasons: a forced turn is a close whatever the model chose; a hint records the
  next unused authored rung (a higher rung is clamped down, a rung already given or a hint past
  the ladder is 0, the interviewer's own words), never skipping one; a second follow-up is a plain
  `stay`; the score is clamped to 0..1 and an empty summary means no verdict; `silent` is honoured
  on a proactive turn and on a reply to a spoken message only. A typed message with nothing to say
  is a failed call. `parseTurn` first strips the JSON a model sometimes writes inside the last
  string field it closes (`stripJsonDebris`: a trailing `"}`, an unbalanced closing quote, a
  trailing `<br>`).
- **A game's move, and its words** (`quant/game.ts`). The move is kept inside the books
  (`normaliseGameMove`, on the slot's state as loaded for the turn): ignored on a bank question;
  no trade without a live quote; a trade's quantity a whole number clamped to 1..the quote's size;
  no reveal with nothing left, nor on a close (the settlement shows everything); no move on a
  turn that says nothing; `follow_up` is a `stay` (a game has no follow-up). `moveFacts` then
  plays the move with the engine's own transitions (`tradeQuote`, `revealNext`, `settleGame`, the
  ones `advanceRound` applies) and words what they did, and those lines open the posted message,
  the model's words after them: "I buy 2 at your offer of 11.5. Die 1 shows 6. Where's your
  market now?", and on every close of a game (the model's, the clock's, a canned one) the
  settlement: "That settles the game at 13 (Die 1: 6, Die 2: 2, Die 3: 5). You finish short 2, a
  loss of 3." The model is told never to state a trade, a price,
  a quantity or a value itself. So every figure on the screen is the books' figure, whatever the
  model's arithmetic or memory: a move the model wrote but the books do not allow is not made and
  not announced, a clamped quantity is announced as traded, and a message that announces a trade
  nobody made can only come from the model's words breaking that rule (the trace flags words
  that claim a trade, `adjusted`, and the simulator counts them). A move needs no words (the
  facts line is a reply). The step names the version the state was loaded at, so a quote that
  lands while the turn is written makes it `stale`: nothing of it is booked or posted, what it
  streamed is discarded, and the quote, queued meanwhile, is answered next on a fresh load. A
  `close` may carry a last trade (`QuantStep.close.game`), so "I lift you for five; that's the
  game" is one step.
- **The game's books per turn** (`gameBooksLines`, in the final system message, outside the
  cached prefix): every component and whether it is shown, the next reveal and what it is, the
  public fair value, standard deviation and range now, and what the next reveal would make them,
  the true value, the stage (reveals so far; markets, trades, contracts bought and sold this stage
  and in all, as the playbooks count them), the live quote with its mid, its width in standard
  deviations, whether fair is inside it and the interviewer's edge per contract at the bid and at
  the offer against both values, the sign convention stated in words on each line ("bid minus
  value", "value minus offer", "Edges are YOURS"), the candidate's position and cash marked to
  both values, the log and the quotes left. Candidate messages that are quotes posted through the
  quote box (exactly `formatQuote` of a logged quote, at its time) are marked `source="quote"`, so
  a market typed in the chat can be told from one posted.
- **LaTeX in JSON** (`quant/latex.ts`): a single backslash inside a JSON string turns `\frac`,
  `\binom`/`\beta`, `\times`/`\text`, `\rho`/`\right`, `\nu`/`\neq` into control characters, and
  `\alpha` or `\$` into invalid JSON. Unparseable output is re-parsed with every backslash that
  starts no JSON escape doubled; then `message` and `summary` are repaired: a backspace or form
  feed anywhere becomes `\b` / `\f`; inside `$...$` or `$$...$$` only, a tab or carriage return
  before a letter becomes `\t` / `\r`, and a newline before a known `\n…` command (`\nu`, `\neq`,
  `\nabla`, `\not`, …, as a whole word) becomes `\n`. Real newlines, tabs and line endings in
  ordinary text are never touched.
- **Failure rules**: a failed, refused or unparseable call on a candidate message gets the usual
  canned reply and no step; a refused chosen model falls back to the provider default as for
  coding pads; a close the clock requires happens with a canned line and a null verdict when there
  is no key, no budget, an open breaker or a failed call, and a nudge likewise with a canned line,
  so the round's clock never depends on the model; the opening likewise starts the round. A
  candidate message aborts an in-flight clock turn or opening, and its reply does what the clock
  required (a forced close on a reply is `kind: 'chat'`). A refused step (`stale`, …) posts
  nothing (what it streamed is discarded). A clock action that failed or was refused is retried after 30 s, not on every pass. A
  restart greets only while the round is pending and nothing was said, and nudges only while the
  server's `nudgedAt` is null. On a game nothing is traded or shown when a call fails: the
  canned reply asks them to say it again or post their market again (`gameReplyFailed`), the
  canned nudge asks for one last market (`gameNudge`), and a canned close states the settlement
  before its line.
- **Voice**: the model may stay silent on a spoken message that is plainly mid-thought, and before
  answering a spoken message the pump waits `voiceSettleMs` (1.5 s, real time, at most four times)
  for further pieces and answers them together. Each piece of speech is stored as a candidate
  message, which counts against the per-user chat rate limits only; what counts against the
  per-pad cap is the interviewer's messages (posted questions aside), at most one per answered
  batch. A spoken round answers several times a minute where a typed one answers once or twice, so
  a quant round's cap follows its length (§7, 8 a minute: 360 for 45 minutes, against at most
  about 5 a minute in a talkative spoken round, and 10 a minute for someone talking without pause,
  as each reply waits for the settle and the model). A round that reaches it gets one notice and
  no more model calls; its clock still nudges and closes with canned lines and no verdict (and the
  assessment, which checks the same budget, is skipped).
- **Assessment** (`generateQuantAssessment`): with scope `all`, each closed question without a
  verdict is judged first (one call each, `QuantVerdictSchema`, medium effort) and written back
  with a `verdict` step; then one high-effort call sees every posed question in full, the
  transcript with a marker where each question was posted, the final scratchpad, and a code-built
  table of time, budget, hints (authored used of available, and own), follow-up, how it ended and
  score per question, and returns a `ReportAssessment` over `QUANT_REPORT_DIMENSIONS` (structuring,
  correctness, communication, speed, independence), each with quoted or cited evidence. A game is
  presented with its review as played (`reviewText` of `gameReview`: each quote against the fair
  value at the time, each trade's edge, each reveal's effect on fair and on the next mid, the
  position, the expected edge and the realised P&L) instead of a reference answer, in its verdict
  and in the assessment, both told to judge the decisions and never the luck.
- `scripts/simulate.ts --quant` plays a scripted 20-minute round against a live model, and
  reports latencies, including the time to a streamed message's first character against the
  whole call (live, Opus 5.5: p50 2.6 s against 3.9 s, p90 4.8 s against 5.7 s; the `reason`
  field and adaptive thinking come before `message`), and whether any streamed text changed when
  it was posted. `--game <id>` (with `--values` to fix the dice) puts a game in the second slot,
  played by a scripted candidate who posts quotes through the same `quote` step as the API, quotes
  around the public fair value and shades after fills, leaves a stale market once after a
  reveal, types a market in the chat once and asks for the fair value once; it prints the books
  after every step and compares the game's turns with the others. Live (Opus 5.5, seven games):
  a game's turn p50 4.1 to 6.5 s against 2.8 to 3.9 s for the bank question of the same run. Its
  per-turn books add 1.2 to 1.6 thousand uncached input tokens (1.7 to 2.1 thousand a call
  against about 0.53 thousand) and it writes about twice the output (330 to 500 tokens: the
  reason weighs the playbook), while the cache reads stay whole (6.2 to 7.1 thousand tokens a
  call); a reveal or a game's close is posted whole, so in a game with a reveal every stage the
  candidate waits for the whole call more often.

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

Every topic has a home (`track`, a `QuizTrack`: `fundamentals`, the default, or `quant`), set in
`quiz/topics.yaml` and stored on `quiz_topics.track`. The home decides the content rules below,
what the seed treats as quant and what a quant round may draw from (home `quant` topics only).
It is not the site track: the header switch chooses a `Track` (`software` or `quant`,
`packages/contracts/src/track.ts`), home `fundamentals` belonging to `software` and home `quant`
to `quant` (`homeTrack`). A topic may also show in other site tracks, listed as `also` in
`topics.yaml` (`also: [quant]` puts Python in both); `topicTracks` gives the home's track first,
then `also`. It is the same topic in each, so progress on it is shared. Every topic shape the API
returns carries `track` and `also`. A pad belongs to a site track by its format (`padTrack`:
`coding` is `software`). Quiz Markdown is rendered with
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
*countable* answer per question across standalone answers, practice and discussion answers, finished
exams (a running exam never shows up) and the judged questions of the user's ended quant rounds
(§8.2), in one query (`latestAnswers` in `apps/api/src/quiz/answers.ts`).

A user can delete their own history: one attempt of any mode, running or finished, from the
History list or its own page (`DELETE /api/quiz/attempts/:id`, its answers cascade), or all of
it at once (`DELETE /api/quiz/history`: every attempt and every question-bank answer). Nothing is
recomputed on delete: status, stats, the roadmap and "focus weak" simply read the latest
countable answer that is left, which the confirmation says (a running exam's answers never
counted, so deleting one changes nothing). The judged questions of quant rounds are not part of
the quiz history and stay; they are kept even when the round's pad is deleted. Both routes need
an account, act only on the caller's rows (anyone else's id is a 404, as is a repeat) and share
the `historyDeletes` limit with the drill's deletes.

The roadmap (the Roadmap tab's topic maps, `/{track}/roadmap?view=maps&roadmap=<topic>&node=<id>`) draws each
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

### 8.1 Mental math drill

A timed run (60, 120 or 300 s) of generated arithmetic questions on chosen categories and a
level. The browser generates and marks the questions (`apps/web/src/features/drill`); the server
keeps only the result of each finished run, for the user's own history and bests, so there is no
leaderboard and the result is the client's word. `RecordDrillRunRequest` checks that it is
self-consistent and humanly possible: every category in `byCategory` is part of the config and
listed once, `elapsedMs` is at most the duration plus `DRILL_GRACE_MS`, and there are at most
`DRILL_MAX_ANSWERS_PER_SEC` answers (right or wrong; skips are not counted) per second of the time
played. The API ignores any totals or score
the client sends: it adds up the categories, scores correct minus wrong (`drillScore`) and stamps
`finished_at` with its own clock (`apps/api/src/drill/bests.ts`, unit-tested).

Only a full-mix run (every category, `full_mix`) is comparable, so only those count towards a
best: the highest score per duration and level, the earliest run on a tie. `newBest` on recording
is true when a full-mix run scores strictly higher than every earlier full-mix run of its duration
and level (the first one when it scores above 0). Both routes need an account (a guest gets
`account_required`) and act only on the caller's runs; recording is limited per user
(`limits.drillRuns`: 6 a minute, 200 a day). A run can be deleted from the history
(`DELETE /api/drill/runs/:id`), or all of them (`DELETE /api/drill/runs`); both answer with the
history left, so a deleted best falls to the next highest full-mix run of its duration and level
(or to none) with no second request (`limits.historyDeletes`: 30 a minute).

### 8.2 Live quant round

A practice pad of format `quant` (`POST /api/pads/quant`, from the Quant track's Interviews tab): the AI interviewer
asks a few questions of a quant path one after another, out loud or in chat, under the pad's
clock. (A room of format `quant`, whose round a person runs with no clock, is §8.4; everything
below is about the AI-run round, `mode` absent or `'ai'`, unless it says otherwise.) There is no problem, no code and no runs; the candidate works on the scratchpad
(`YDOC.notes`) and the whiteboard. The interviewer runs the round, so a quant pad needs the
owner's key to be created and its `interviewer.enabled` is always true. Collaborators (an account
joining by the link, as on any practice pad) see exactly what the owner sees.

- **Assembly** (`apps/api/src/quant/assemble.ts`, pure and seeded, unit-tested): 3, 4 or 6
  questions for 20, 30 or 45 minutes (`quantQuestionCount`), from the active `short` questions of
  the path's topics and the `numeric` ones that have hints or follow-ups. Difficulty rises by slot
  (E M H; E M M H; E M M M H H), topics go round-robin from a random one, no subtopic twice, at
  least one of each type when the pool has both, the owner's weak questions first (the quiz's
  latest answers, as "focus weak"), and none posed in the owner's last five rounds (unless the
  pool would then be too small). An empty cell relaxes the topic, then the difficulty, and only
  then allows a repeated subtopic. A trader round's second slot holds a market-making game when
  one is active (§8.3), and the bank fills the rest. Too few questions is 409 `quant_unavailable`. The prompt, unit,
  the topic's title and the number of authored hints are copied into the round when it is built
  (a round stored before titles were copied has none, and is shown with the topic's slug).
- **State** (`quant_rounds.state`, server-only) changes only through `advanceRound`
  (`packages/contracts/src/quant-round.ts`): `start`, `turn`, `close`, `verdict` from the
  interviewer (`InterviewerDeps.applyQuantStep`) and `end` from the API (and, for a slot that
  holds a market-making game, `quote` from the API and a game move on `turn`: §8.3). `apps/api/src/quant/round.ts`
  applies a step in one transaction: a share lock on the pad (so ending it waits, or the step sees
  it ended), the next state behind a compare-and-swap on `version`, the interviewer's message,
  the revealed question's message (intent `question`, the bank's exact prompt, `createdAt` 1 ms
  after the message before it, its id recorded as `posedMessageId`) with a `question` timeline
  event, and the interviewer's private note. Every time a step writes (its `now`, so `posedAt`,
  `nudgedAt`, `closedAt`, and its messages' `created_at`) is the database's clock, read in the
  transaction after the lock (`clock_timestamp()` rounded up to the millisecond, `Ctx.dbNow`):
  the clock Postgres stamps every other message and `pads.started_at` with, so the round's
  messages sort among the candidate's whatever the API host's clock says. The interviewer's message
  takes the id its text was streamed under when the step names one (`messageId`). After the
  commit the room gets `message.created` for each message, then `round.updated`. A step decided on an older version (`stale`), or refused by
  the transition (`QuantRefusal`), posts nothing; once the pad has ended only `end` and `verdict`
  are accepted. The interviewer's message counts against the owner's daily AI messages; a posted
  question counts against neither that nor the per-pad cap.
- **Clock**: the round ends at `startedAt + durationMin`; each question's budget is set when it is
  posed (`quantBudgetSec`, unused time rolls forward). All of these are on the database's clock;
  the interviewer decides when the clock is due on the API's (`deps.now`), and a close for time
  it asks for up to `QUANT_CLOCK_SKEW_MS` (5 s) early is accepted, so a small skew either way
  only moves a close by that much: an API behind closes a little late, one ahead by more than
  that is refused `too_early` and retries after 30 s (a timeout also has its grace, 30 to 90 s,
  in hand). The browser counts down from `posedAt` on its own clock, as before. The round
  finishing (last question closed, or closed for `round_time`) does not end the pad; the owner
  does. Ending the pad (`endPad`) closes the open question as `ended` before `session_ended`, and
  the assessment (`generateQuantAssessment`, quant dimensions) first judges questions closed
  without a verdict.
- **Nobody there** (`apps/api/src/quant/sweeper.ts`): the interviewer applies the clock on its
  ticks, which reach only pads someone is connected to, so the API also sweeps every
  `timing.quantSweepMs` (15 s; 0 turns it off, as the tests do): in each active quant pad nobody
  is connected to (by event socket or collab document, the set the ticks reach, checked again
  just before acting) whose open question is past its budget and grace, or whose round's clock
  has run out, it applies the close the interviewer's failure path would (`timeout` or
  `round_time`, the same canned line from `cannedCloseLine`, no verdict) on the database's clock,
  with no model call, so nobody's key is spent while nobody is there; it never nudges. A pad
  someone is on is left to its interviewer, so a turn in flight there is never pre-empted, and
  the compare-and-swap makes a double close impossible anyway. An unattended round therefore runs
  to its end question by question (each close poses the next with a fresh budget, closed in turn);
  a round never started stays pending until someone comes. The sweeper starts and stops with the
  server (`createApi` / `stop`, which waits for a pass in progress) and its timer is unref'd. One
  sweeper sees every live pad because the API is a single instance.
- **What the browser sees**: `PadDetail.round` and `round.updated` carry `publicRound(state,
  version)`, the posed questions only (topic and its title, difficulty, prompt, unit, times, how a
  question closed, hints given as a count, and the id of the `question` message that posed it,
  by which the chat and voice number question messages); never a question id, a subtopic, a
  verdict or a question still to come. How a question closed is not sensitive (everyone saw it
  happen), so the pad says "Timed out" without waiting for the report. `PadSummary.quantPath`
  gives the Interviews tab the round's path ("Quant · Trader"). The report (`Report.quant`, only after
  the pad ended) is built when read from the state and the bank: per question its status
  (`answered`, `timed_out`, `unfinished`, `not_reached`), topic title, solution, key points,
  explanation, verdict, time and budget, and hints as counts. The text of hints and follow-ups
  never leaves the server, not even there. A quant pad's `Report.stats` has `runs`,
  `submissions` and `accepted` null (the API nulls them too in reports stored when they were
  0 / 0 / false); the report shows the round's figures instead, derived from `Report.quant` in
  the web app.
- **In the quiz**: once the pad has ended, each question with a verdict is one of the owner's quiz
  answers (`quant_round_answers`; collaborators get none), as a discussion records one: AI-graded,
  score and feedback from the verdict, the response a short answer holding everything the owner
  said while the question was open (the last 4,000 characters; a numeric question's too, as what
  was said is not a number), answered when it closed. It is
  written in the transaction that finishes the round (or, when the round had already finished,
  the one the pad's end runs) and by every later `verdict` step, once per pad and question (a
  second end or assessment neither duplicates nor overwrites it), and it stays when the pad is
  deleted. Nothing is written while the pad is active, so a verdict never shows in the question
  bank, the stats or the roadmap mid-round (it would also name the bank question); unjudged and
  unposed questions record nothing. It takes part in the latest countable answer per question
  (§8) by its time like any other answer, so the round assembler's "weak first" sees it too.
- **What the interviewer sees** (`InterviewerHost.loadQuantContext`): the current question in full
  (scope `all`, for the assessment: every posed one), a code-built summary of the closed ones, the
  transcript from the latest posed question's message on, and the scratchpad cut at 8,000
  characters. A later question is in it in no form. A game's slot is an entry of its own kind,
  with the game's content and books (§8.3).
- **Refused on a quant pad**: runs and a language change (409 / WS `error` `wrong_format`), the
  room-only endpoints (403 as for any practice pad; `POST …/problem` also checks the format). A
  quant room (§8.4) accepts the room-only endpoints that make sense for it (the host's notes, the
  report, playback, the assessment) and refuses the ones about code (`…/problem`, `…/review`:
  `wrong_format`).

### 8.3 Market-making games

A trader round may hold a **market-making game** in one slot instead of a bank question: a
contract on hidden values the server draws and keeps, on which the candidate makes markets
(bid, ask, size) and the interviewer trades. All the bookkeeping a model cannot be trusted with
(the dice, the quotes, the position, the P&L) is code. This version covers markets on a value
built from independent discrete components; sequential betting games (bankroll and stakes) are
out of scope, and nothing below depends on the payoff being one of today's four.

The pieces:

| | where | state |
|---|---|---|
| content format, loader, checks, nine games | `packages/content/games/`, `src/load.ts`, `src/games.ts` | built |
| engine, view, books, review | `packages/contracts/src/quant-game.ts` | built |
| steps and refusals in the round | `packages/contracts/src/quant-round.ts` (`advanceRound`) | built |
| `quant_games` table and seed | `packages/db` | built |
| report builder takes a game, `quantReport` loads the games | `buildQuantReport(state, bank, games)` in `apps/api/src/quant/round.ts` | built |
| the quote route, the effects' I/O (quote message, `game` timeline events) | `apps/api/src/routes/pads.ts`, `src/quant/round.ts` | built |
| the assembly rule (one game in a trader round's second slot) and `includeGame` | `apps/api/src/quant/assemble.ts` | built |
| the interviewer's seam: a game's entry in `QuantContext.questions` (content and books) | `packages/interviewer/src/types.ts`, `InterviewerHost.loadQuantContext` | built |
| the interviewer's moves, the facts it posts, its books in the prompt, the review in the verdict and the assessment | `packages/interviewer/src/quant/` (`game.ts`, §7.3) | built |
| the game panel (components, quote form, blotter, settlement), the setup option, the report's game section, `game` rows in the transcript | `apps/web/src/features/quant-game/`, `features/report/game-review.tsx` | built |

A round without a game behaves exactly as before (its stored state is byte-for-byte what it
was, and so is its assembly: the same draws from the same generator).

- **Content** (`QuantGame`): one YAML file per game, `packages/content/games/<id>.yaml`, the id
  the file name and distinct from every quiz question id (a round names either by
  `questionId`). `topic` is a quant topic (`betting-market-making` for now); `title`,
  `difficulty`, `prompt` (Markdown with KaTeX, posted word for word as the question message, as a
  bank prompt is). The mechanics: `components`, 1 to 8 hidden values `{ label, faces }`, each
  drawn uniformly and independently from its faces (a die is `[1, 2, 3, 4, 5, 6]`, a coin
  `[0, 1]`; a repeated face weights it), at most 1,000 faces each and at most 200,000 outcomes in
  all; `payoff` (`sum`, `product`, `max`, `min`); `reveal`, the order in which components may be
  shown during play (indices, each once, possibly empty; a component not listed stays hidden
  until settlement); `tick` (a multiple of 0.001, so prices have at most three decimals) and
  `maxSize` (1 to 1,000). Faces and the contract's range lie within ±100,000. Interviewer-only:
  `counterparty` (how to trade: informed or not, when to ask for a tighter market, when to
  reveal), `hints` (a ladder, as a question's). For the report: `explanation`. `expect` holds the
  authored fair value, standard deviation, minimum and maximum before anything is shown (fair,
  min and max exact, as `parseNumeric` reads them, e.g. `49/4`; sd to four significant figures).
  Optional `source`. `counterparty`, `hints` and `expect` never leave the server.
- **Storage**: `quant_games` (id pk, topic → `quiz_topics`, difficulty, data jsonb `QuantGame`,
  active), seeded idempotently like `quiz_questions`: a broken file is skipped and reported, and
  a game removed from content is marked inactive (only when every game file loaded). A game is
  not a quiz question: it is never in the question bank, an attempt, the stats or the roadmap,
  and a verdict on it is never a quiz answer (`recordAnswers` only records ids found in
  `quiz_questions`).
- **Assembly** (`assembleWithGame` in `apps/api/src/quant/assemble.ts`, pure and seeded,
  unit-tested over many seeds). `CreateQuantPadRequest.includeGame`: absent, the path decides (a
  trader round has a game, a researcher round none); true, a game whenever an active one exists
  (of any topic, so a researcher round can ask for one); false, none. The game takes the second
  slot (the first in a one-question round): an active game (`quant_games.active`) not posed in
  the owner's last five rounds (`recentlyPosed` collects game ids with question ids) unless every
  one was, of the slot's difficulty or else the nearest, at random among equals; its hidden
  values are drawn by the same generator through `quantGamePick`. The bank fills the other slots
  by §8.2's rules, as a round one question shorter whose slots keep their own difficulties (a
  20-minute round: easy, the game, hard), so a game round needs one bank question fewer. Those
  slots are filled from the path's other topics, so a market-making question is not asked next
  to a market-making game; the game's own topic comes back only when the others cannot fill
  them. No active game, or none wanted, and the round is assembled exactly as before. The server draws
  with a cryptographic generator (`secureRand`), so the dice cannot be worked out from the
  questions a round shows; the tests pass a seeded one.
- **The engine** (`quant-game.ts`, pure). `drawGame(spec, rand)` draws the values from the
  assembler's PRNG; `createGameState(game, values)` snapshots the mechanics and the title
  (never the counterparty, hints, explanation or expect) into a `QuantGameState`;
  `quantGamePick(game, topicTitle, rand)` (in `quant-round.ts`) makes the slot's `QuantPick`.
  `gameValue`, `gameStats` (unconditional) and `gameConditional(spec, values, revealedCount)` /
  `gameFair` (given the components shown so far: the **public fair value** quotes are judged
  against) are exact, computed from the components' distributions by independence (the tests
  check them against enumerating every outcome). Transitions, each returning a new state or a
  refusal: `postQuote` (validated by `quoteProblem`: finite, within ±1,000,000, both prices whole
  multiples of the tick, forgiving floating point, bid below ask, size a whole number in
  1..maxSize; stored snapped to the tick; it replaces the live quote; at most 100 quotes per game),
  `tradeQuote` (a whole quantity in 1..the quote's size; the quote is consumed whatever the
  quantity), `revealNext` (the next component of `reveal`; withdraws the live quote, made on less
  information), `settleGame` (the true value and P&L = cash + position × value).
- **Sign convention**: a stored trade, and the interviewer's move, name the **interviewer's**
  side (`interviewerSide`): `buy` lifts the candidate's offer (pays the ask: the candidate
  sells), `sell` hits the bid (the candidate buys). Everything else is from the **candidate's**
  side: `position` (contracts, positive long), `cash` (positive received, kept to three
  decimals so decimal ticks stay exact), `candidateSide` in every public entry
  (`candidateSideOf`), and every edge in the review.
- **In the round**: `QuantRoundQuestion.game` holds the state (absent for a bank question and
  in every round stored before games, read as null; `questionId` is the game's id, `prompt` its
  prompt, `unit` null, `hintsAvailable` its hints). `advanceRound` plays it:
  - `{ type: 'quote', index, bid, ask, size }` (`QuantQuoteStep`), raised by the API when the
    candidate posts a market (`PostQuantQuoteRequest`); not versioned, like `end`. Valid only
    while `index` is the current question and a game. Effects: `quote: { index, text }` with
    `text = formatQuote(quote)` ("9.5 bid, 11.5 offered, 1 lot", of the quote as snapped), to
    post as the candidate's chat message, and the quote's game entry.
  - a `turn` may carry `game: { trade?: { interviewerSide, quantity }, reveal?: true }`
    (`QuantGameMove`): a trade against the live quote, a reveal, or a trade then a reveal ("I buy
    one at your offer. Now the first die: it is a 6."). It combines with any `action` (a hint may
    ride along) and the whole step is refused when any part of it is. An empty move is no move.
  - every close settles an open game: `close` for `interviewer`, `timeout` or `round_time`, and
    the API's `end`. A game never posed is never settled. A `close` may carry a last move
    (`game`, as on a turn: in practice a trade), made before the settlement, so the interviewer
    can trade and end the game in one step; the close is refused whole when the move is.
  - new refusals (nothing changes, nothing is posted): `not_game` (a quote or a move on a
    question that is not a game), `bad_quote`, `quote_limit`, `no_quote` (a trade with no live
    quote), `bad_quantity`, `nothing_to_reveal`, `game_settled` (unreachable through the round);
    a trade side that is neither `buy` nor `sell` is `invalid`; a quote on another question is
    `wrong_index`, while pending `wrong_phase`, after the round `ended`.
  - effects gain `quote` (above) and `game: { index, entries }`: what the step did to question
    `index`'s game, in order (`QuantGameEntry`: quote, trade, reveal, settle). The API records
    each as a timeline event `{ type: 'game', index, entry }` (`TimelineEvent`), in the step's
    transaction, after `say` (and after the quote's candidate message) and before the next
    question's `reveal`: the messages are at the step's `now`, the game events a microsecond
    apart after it (`timeline_events.at` keeps microseconds), the next question's event at
    `now` + 1 ms, so playback, which orders by `at`, replays them as they happened. Playback and
    every other reader pass the entry through as it is: it is the public form (a trade from the
    candidate's side, a reveal with the value shown, the settlement once the question closed).
- **The quote route**: `POST /api/pads/:id/round/quote`, body `PostQuantQuoteRequest`
  (`{ index, bid, ask, size }`). Any member of the pad may quote (a collaborator does what the
  owner does on a practice pad). 400 `validation_error` for a body the schema refuses (a size
  that is not a whole number, a price that is not a number, …); 404 for a non-member; 409
  `wrong_format` on a pad that is not a quant pad; 409 `ended` once the pad has ended; 429 under
  the chat allowance (`limits.chat`, per user, burst and daily: a quote is a chat message);
  otherwise the `quote` step through `applyStep` (`postQuote` in `quant/round.ts`), decided again
  when a concurrent step wins the compare-and-swap (it is not versioned, like `end`). A refusal
  by the round is 409 with the refusal as the error code (`bad_quote`, `quote_limit`,
  `wrong_index`, `not_game`, `wrong_phase`, `ended`, …) and a fixed message (no figure of the
  game). The step's transaction posts `formatQuote` of the snapped quote as the poster's chat
  message (role `candidate`, kind `chat`, no intent, their user id) and its `game` timeline
  event; after the commit the room gets `message.created`, then `round.updated`, and the
  response is 200 with the round's new `QuantRoundView`. The quote then reaches the interviewer
  as a typed chat message does (`candidate_message`, via `text`), so it answers it. There is no
  per-pad cap on candidate messages (the interviewer's own messages have one); the engine caps
  quotes at 100 per game.
- **What the browser sees**: `QuantQuestionView.game` is `gameView(state)` (null for a bank
  question), built field by field: the title, each component's label with its value only once
  shown (all once settled), payoff, tick, maxSize, the live quote, the log (quotes, trades from
  the candidate's side, reveals with their values, the settlement), position, cash, the
  settlement and the quotes left. Never a hidden value, the public fair value, a standard
  deviation or a mark-to-market figure: working out the fair value is the candidate's task. The
  browser may check a quote with `quoteProblem` before sending it.
- **What the interviewer sees** (`gameBooks(state)`, privately, to put in the per-turn books):
  everything: every value and whether it is shown, the next reveal, the public fair value, sd
  and range now, the true value, the live quote with its mid, width, whether fair is inside it
  and the interviewer's edge per contract at the bid (`hitBid`) and the offer (`liftOffer`)
  against both fair and true value, the candidate's position and cash marked to both, the log
  and the quotes left. The counterparty notes and hints come from the content. The seam is a
  discriminated entry of `QuantContext.questions` (`packages/interviewer/src/types.ts`): a bank
  question is `QuantBankEntry` (`kind` `'question'`, or absent in code written before games,
  with `question`), a game's slot `QuantGameSlotEntry` (`kind: 'game'`, with `game`, its
  `QuantGameContent`: id, topic, title, difficulty, the posted prompt, `counterparty`, the hints
  cut to `hintsAvailable`, `explanation` and the round's snapshot of the mechanics; `state`, the
  game's `QuantGameState` at the context load; and `books`, `gameBooks` of it), both with
  `index`, `hintRungs` and `followUpAsked`. `InterviewerHost.loadQuantContext` fills it from
  `quant_games` (a missing row leaves the notes, hints and explanation empty, and the block then
  has a generic uninformed playbook). `quant/entry.ts` reads what both kinds have (prompt, hints,
  topic, difficulty, type).
- **The interviewer plays it** (§7.3, `packages/interviewer/src/quant/game.ts`): its turn's
  `trade`, `quantity` and `reveal` fields are its move, kept inside the books by
  `normaliseGameMove` and played on `state` with the engine's transitions; the facts of the move
  (the trade, the value shown, the settlement on a close) open its message, built from what the
  engine computed, so the words can never give a figure the books do not hold. The question's
  system block has the prompt, the mechanics in words, the counterparty playbook, the
  explanation and the hints; the per-turn books (`gameBooksLines`) have everything of
  `gameBooks` and the stage counts the playbooks use, edges with their sign convention spelt out.
  The verdict on a game and the assessment get its review as played (`gameReview(state)` in
  words, `reviewText`) in place of a reference answer, and are told to judge decisions, not the
  dice. A typed or spoken market is not a quote: the model asks for it in the quote box. No
  playbook figure, hidden value, fair value or mark reaches a browser: proven through the real
  API, database and socket in `apps/api/test/quant-game-real.test.ts`.
- **The report** (`QuantQuestionReview` with `type: 'game'`, only after the pad ended):
  `subtopic` empty, `solution` the figures before anything was shown (`gameSolution`: "Fair value
  10.5, standard deviation 2.96, from 3 to 18"), `keyPoints` empty, `explanation` the game's,
  and `game` its `gameReview(state)` (`quantGameReview(q)`; null for a game never posed): the
  components and the true value; per quote the public fair value and sd at the time, mid, width,
  whether fair was inside and whether it was traded; per trade the candidate's side, price,
  quantity, the public fair value and the candidate's edge (per contract and in total); per reveal
  the fair value before and after and the mids of the last quote before and the first after;
  the final and the largest absolute position, the expected edge in total and the realised P&L.
  Quote quality, updating on information, risk taken and P&L, with luck the difference between
  the last two. The counterparty notes and hints never appear.
- **Verification**: `pnpm --filter @ipp/content check` parses every game (`loadQuantGames`: id =
  file name, a quant topic), fails when `expect` differs from what the engine computes from the
  game's own components (`quantGameErrors`), when its prompt or explanation does not typeset
  (`quantGameMathErrors`) and when a quiz question has its id; and
  `scripts/verify-quant-quiz.py` runs `scripts/quant_checks/games.py`, one `@check("<game id>")`
  per game that recomputes the fair value and sd (optionally min and max) by its own enumeration
  or simulation from the game as its prompt describes it, returned as `GameFigures`. A game
  without a check fails the check and a content test, as a numeric question does.
- **In the API, proven by tests** (`apps/api/test/quant-round.test.ts`, "market-making games";
  `quant-game-real.test.ts` with the real interviewer): a game played through the route and
  `applyQuantStep` (quotes, a trade and a reveal, a second quote and trade, the close settling
  it) with position, cash and settlement as the engine computes them; every refusal; a quote
  racing an interviewer step (the quote is decided again, the step goes `stale`); the sweeper
  closing an unattended game and settling it; ending the pad mid-game; a verdict on a game
  never recorded as a quiz answer; a played game kept out of the owner's next rounds. While the
  pad is active no hidden value, public fair value, sd, mark or edge, counterparty note, hint or
  explanation is in `PadDetail`, the list, `round.updated`, `message.created`, the quote
  route's response or errors, the timeline or the playback (the tests choose values no visible
  number can contain and scan every payload); after it ended, the report shows the review.
- **In the interviewer, proven by tests** (`packages/interviewer/test/quant-game*.test.ts`, the
  round played with the real `advanceRound`; `apps/api/test/quant-game-real.test.ts` through the
  real API, database and socket with only the model scripted): a full game (quote, trade and
  reveal, a new quote, an informed trade, a close settling it) with the books asserted at each
  step and every posted figure found in the books; a trade without a quote, a quantity beyond the
  size, a reveal with nothing left and a move on a bank question, each kept out of the step and
  out of the words; a trade carried by a close; a quote landing mid-turn (the turn goes `stale`,
  its stream is discarded, the new quote is answered at its own price); closes for time and failed
  calls on a game; voice; nothing hidden ever streamed before its step, and nothing hidden, fair,
  marked or from the playbook in any socket event before the settlement.
- **Web** (`apps/web/src/features/quant-game/`, pure logic in its `logic.ts`): the panel under
  the current question shows the components (a "?" tile until shown), the market's state (none,
  live, traded, withdrawn), the quote form (bid, offer, size; checked as typed with the
  contract's `quoteProblem`, posted to the quote route, the returned view applied like a
  `round.updated`), position, cash and a blotter from the candidate's side, and the settlement
  when the question closes. Nothing in the browser computes a fair value or a mark. The setup
  card sends `includeGame` (on by default for the trader path, off for the researcher path). The
  report's game section (`features/report/game-review.tsx`, derivations in `quant-logic.ts`) is
  where fair value appears: each market against the fair value at the time, each reveal's effect
  on fair value and on the candidate's mid, the position carried, and the expected edge beside
  the realised P&L. `game` timeline events render as rows in the report's transcript. The
  browser tests' mock (`e2e/mock-quant-round.ts`) mirrors the quote route and plays a scripted
  counterparty with the real `advanceRound`.
- **Known gaps**: the API's sweeper closes an unattended game with `cannedCloseLine` alone, so
  the settlement is on the panel but not stated in the chat as the interviewer's closes state
  it; on a phone the quote form is on the Question tab, not beside the chat.

### 8.4 Quant rooms

A **quant room** is to the question bank what a coding room (§4.1) is to the problem library: a
pad of kind `room` and format `quant` in which a person, the host, interviews a candidate on
questions of the bank. The host may line questions up beforehand, pick more during the
interview, or run the room with none at all and just talk over the shared scratchpad and
whiteboard. Everything a room guarantees holds: the candidate needs only a name (a guest), there
is no AI in the conversation (`interviewer.enabled` is always false, so no trigger reaches the
interviewer, and nothing is ever said by a model), chat is between people (the host's messages
role `interviewer` with their user id, the candidates' `candidate`), and host-only data never
reaches a candidate. The AI only advises the host, on request and on the host's own key.

**The round is hosted.** A quant room's `quant_rounds` row holds a `QuantRoundState` with
`mode: 'hosted'` (`createHostedRound`); every other round has no `mode` and reads as `'ai'`
(`quantMode`), so stored rounds are untouched. The same pure `advanceRound`
(`packages/contracts/src/quant-round.ts`) moves both, a hosted round only through the host's
steps (`QuantHostStep`, raised by the API from the host's routes) and `end`; an AI step on a
hosted round and a host step on an AI round are refused `wrong_mode`. A hosted round:

- starts empty (`questions: []`, `current: -1`, `path: null`, `durationMin: 0`) and holds only
  the questions the host posed, in the order posed, each with its `type` (any type of the bank)
  and the text posed;
- has no clock, budgets, nudges, timeouts or round time: `quantClock` is null, `budgetSec` is
  null on every question, and the sweeper (§8.2) skips it (by SQL and in code);
- keeps the host's **queue** in the state (`queue`: bank question ids in order, never posed
  ones, at most `QUANT_QUEUE_MAX` = 50), server-only like the rest of the state;
- is `pending` until the first pose, `asking` while a question is open, and `finished` whenever
  none is (between questions, and after the end): until the pad ends the host may pose another.
  Ending the pad (`endPad` → `end`) closes the open question as `ended` and sets `ended: true`;
  afterwards only a missing verdict may be given;
- is never anyone's quiz answer: `quant_round_answers` are written only for a practice round
  (`pads.kind = 'practice'` and mode `ai`), since a room's owner is the host, who asked; and its
  questions are not "recently posed" to the host's own practice rounds (`recentlyPosed` reads
  practice pads only);
- offers no market-making games in this version (`POST …/round/quote` is refused `wrong_mode`):
  the host would have to make the counterparty's trades by hand. A host-driven game (the host
  trading against the candidate's quotes, the engine keeping the books) is the natural next step.

The host's steps (`advanceRound`, pure and total; every illegal step a refusal):

| step | what it does | refusals |
|---|---|---|
| `pose { pick }` | appends `pick` (`hostedPick` of an active bank question), makes it current with `posedAt` now and a posing message (`reveal`, `total: null`); closes an open question first, by `interviewer`, without a verdict; takes the id out of the queue | `already_posed` (this room asked it), `question_limit` (60), `invalid` (a malformed pick) |
| `host_hint { index, rung }` | records a hint on the open question: the next authored rung (1-based) or 0 for one in the host's own words | `not_open`, `wrong_index`, `hint_rung` (skipped, repeated or beyond the ladder), `hint_limit` (20 per question), `invalid` |
| `host_follow_up { index }` | records that the open question's follow-up was asked (once) | `not_open`, `wrong_index`, `follow_up_used` |
| `host_close { index, verdict }` | closes the open question by `interviewer`, with the host's verdict or none | `not_open`, `wrong_index`, `invalid` (a score outside 0..1) |
| `host_verdict { index, verdict }` | gives or replaces the host's verdict on a closed question; once the pad has ended, only on one that has none | `wrong_index`, `not_closed`, `has_verdict` (after the end), `invalid` |
| `queue { questionIds }` | replaces the queue | `invalid` (a repeat or a malformed id), `already_posed`, `queue_limit` |
| `end` | closes the open question as `ended`; `ended: true` | `ended` (already) |

After the pad ended every step but `host_verdict` is refused `ended`. Host steps name no version
(like `end` and `quote`): `applyHostStep` (`apps/api/src/quant/round.ts`) decides one again when
it loses the compare-and-swap to a concurrent write, up to three times. The step's transaction
is `applyStep`'s (§8.2): the share lock on the pad, the database's clock, the next state behind
the compare-and-swap, and for a `pose` the posing message (role `interviewer`, kind
`proactive`, intent `question`, the **host's** user id, exactly the posed text) with a
`question` timeline event whose `total` is null. After the commit the room gets
`message.created`, then `round.updated`, but only when the round as a member sees it changed
(a pose, a hint's count, a close, the end): the queue, a follow-up and a verdict broadcast
nothing.

**What is posed.** `hostedPrompt(question)` (contracts, `quant-room.ts`) is the one text a
candidate is shown, in the chat message, the question panel, voice, the transcript and the AI's
material: a short or numeric question's prompt as it is; a choice question's prompt followed by
its options as a list (`- **(a)** …`) and "Choose one." or "Choose every option that applies.";
an output question's prompt, its program in a fenced block (a fence longer than any backtick run
in the code) and "*Python, Python 3.12.* Say what it prints, or that it does not compile, fails
at runtime, has undefined behaviour or prints something unspecified." Composing Markdown on the
server keeps every surface as it is (the candidate's view already renders a Markdown prompt), and
a candidate in a room answers by talking, not through a form, so nothing structured is needed;
nothing of the answer is in it. `quizSolution(question)` is the answer as a person reads it
(Markdown, host-only): the right option(s), "It prints: …" or "It does not compile.", the
reference, or the number with its unit.

**Routes** (all but the first under `roomForHost`: the room's owner, with an account; a
candidate gets 403, a guest 403 `account_required`, a non-member 404; on a coding room the
`host/round/*` routes are 409 `wrong_format`):

| Method and path | Request | Response and errors |
|---|---|---|
| `POST /api/pads` | `CreatePadRequest` with `kind: 'room'`, `format: 'quant'`, optional `queue` (active bank ids in order, ≤ 50), `title?` (default "Quant interview"), `durationMin` (the top bar's clock only; null for none), `interviewer` (stored with `enabled` and `voice` false; `model` is what the host's AI calls use) | `Pad` (`format: 'quant'`, `problemSlug` null, `language` stored as `python`). No AI key needed. 400 `validation_error` with a problem, `random`, `blank`, `kind: 'practice'` (a practice quant round is `POST /api/pads/quant`) or a repeated id; 400 `unknown_question` for an id that is not an active bank question; 429 (the pad allowance). A coding pad still needs `language` (400 without); `queue` on a coding pad is 400 |
| `GET /api/pads/:id/host` | | `HostView`: `problem` null, `notes`, and `round` (`HostRoundView`, below; null for a coding room). Also after the end |
| `GET /api/pads/:id/host/round/bank?track=&topic=&subtopic=&difficulty=&type=&q=&limit=&offset=` | `HostBankQuery` (all optional; `q` a case-insensitive substring of the prompt, the subtopic or the id; `limit` 1..100, default 30) | `HostBankPage`: `total`, `limit`, `offset`, `items` (`HostBankItem` = `HostQuestionMaterial` + `status` `available` / `queued` / `posed`), every topic with its active question count (`topics`, quant first, then study order), and `subtopics` of `topic` when given. Active questions only, quant and fundamentals alike, in study order. 400 `validation_error` for a bad query; 429 (`padEvents`) |
| `PUT /api/pads/:id/host/round/queue` | `UpdateQuantQueueRequest` (`questionIds`, the whole queue in order: reorder, add and remove in one call) | `HostRoundView`; 400 `unknown_question` / `validation_error` (repeat, > 50); 409 `already_posed`, `pad_ended`; 429 |
| `POST /api/pads/:id/host/round/pose` | `PoseQuantQuestionRequest` (`questionId`: any active bank question, queued or not) | `HostRoundView`; 404 `not_found` (unknown or inactive); 409 `already_posed`, `question_limit`, `pad_ended`; 429 (the chat allowance: it posts the host's message) |
| `POST /api/pads/:id/host/round/hint` | `RecordQuantHintRequest` (`index` of the open question, `rung`: next authored, or 0) | `HostRoundView`; 409 `not_open`, `wrong_index`, `hint_rung`, `hint_limit`, `pad_ended`; 429 |
| `POST /api/pads/:id/host/round/follow-up` | `RecordQuantFollowUpRequest` (`index`) | `HostRoundView`; 409 `not_open`, `wrong_index`, `follow_up_used`, `pad_ended`; 429 |
| `POST /api/pads/:id/host/round/close` | `CloseQuantQuestionRequest` (`index`, `verdict?`: `{ score 0..1, summary ≤ 4,000 }` or null) | `HostRoundView`; 400 for a score outside 0..1; 409 `not_open`, `wrong_index`, `pad_ended`; 429 |
| `PUT /api/pads/:id/host/round/verdict` | `SetQuantVerdictRequest` (`index`, `verdict`) | `HostRoundView`; 409 `wrong_index`, `not_closed`, `has_verdict` (after the end); 429. Also after the end |
| `POST /api/pads/:id/host/round/review` | `QuantSecondOpinionRequest` (`index?`, default the open question; `question?` ≤ 1,000) | `QuantSecondOpinion` (below); 409 `no_question` (none open and no index), `wrong_index` (not asked here), `ai_key_missing`; 429 (`review`), 429 `ai_budget`; 502 `review_failed`. Neither stored nor broadcast |
| `PUT /api/pads/:id/host/notes`, `GET …/report`, `POST …/report/assessment`, `GET …/playback` | as for any room | the report carries `quant` (below); the assessment is 409 `nothing_to_assess` when no question was posed, no candidate wrote in the chat and the scratchpad is empty |

The refusal codes are `advanceRound`'s (`QuantRefusal`), each with a fixed message for a person
(`HOST_REFUSALS` in `routes/pads.ts`); the round's `ended` is reported as `pad_ended`, as by every
room route.

**What a quant room refuses**: runs (409 `wrong_format`), a language change (PATCH and the
socket's `language` event: `wrong_format`), `POST …/problem` (`wrong_format`), the code review
`POST …/review` (`wrong_format`: a quant room's second opinion is `…/host/round/review`) and
quotes (`wrong_mode`). PATCH keeps `interviewer.enabled` false. What it accepts as any room does:
chat, telemetry (`blur` only, as a quant pad), the host's notes, the end, delete, join and
join-guest.

**Who sees what.**

- *The candidate* (guest or account): `PadDetail` (`round` = `publicRound`: `mode: 'hosted'`,
  `path` null, `total` null, the posed questions with their posed text, topic and its title,
  difficulty, unit, times, how each closed, the count of hints recorded, the posing message's id,
  `budgetSec` null; never a question id, subtopic, type, verdict, hint text, the queue, or
  anything not yet posed), `round.updated` and `message.created` on the event socket, the join
  response, the invite, the scratchpad and whiteboard. A hosted view shows "Question 3", never
  "3 of N", and no countdown. The report, playback, `GET …/host` and every `host/round/*` route
  are refused (403).
- *The host*: everything the candidate sees, and `HostView.round` (`HostRoundView`: `version`,
  `phase`, `ended`, `open` (the open question's index or null), `questions` (`HostRoundQuestion`:
  index, id, topic and title, difficulty, type, the posed text, `posedAt`, `posedMessageId`,
  `closedAt`, `closedBy`, `timeSec`, `hintRungs`, `followUpAsked`, `verdict`, and `material`),
  and `queue` (`{ questionId, material }`, `material` null for a question no longer active)).
  `HostQuestionMaterial` is the bank question in full: the public projection (`prompt`,
  `choices`, `code`, `unit`, `type`, `subtopic`, …), `topicTitle`, `solution`
  (`quizSolution`), `correctAnswer` (as in `AnswerFeedback`), `keyPoints`, `explanation`,
  `hints` (the ladder; `hintRungs` says which rungs were recorded), `followUps` and
  `tolerance`. This is the one place a question's hints and follow-ups leave the server: to the
  host who asks them, as a coding room's host reads the problem's interviewer notes. The web
  refetches `GET …/host` when `round.updated` arrives (there is no host-only round event); every
  host route answers with the new `HostRoundView`.
- *The AI* (for the host, `packages/interviewer/src/quant-room-prompts.ts`): never the queue.

**AI for the host**, on the host's key, as in a coding room (§4.1): the model advises the host as
an observer and never addresses the candidate (`QUANT_ROOM_PROMPT`). It reads
`InterviewerDeps.loadQuantRoomContext` (`QuantRoomContext`: the pad, every posed question with
the bank question in full and its bookkeeping, the open question's index, the transcript, the
scratchpad cut at 8,000 characters and the host's notes).

- *Second opinion* (`Interviewer.reviewQuantRoom`, purpose `review`): one call over the
  question's block (the posed text, solution, key points, explanation, the authored ladder with
  the recorded rungs marked, the follow-ups, the host's verdict), the messages from its posing
  to its close (or now), the scratchpad, the host's notes and the host's own question. Returns
  `QuantSecondOpinion`: `index`, `verdict` (`correct`, `partly_correct`, `incorrect`, `not_yet`,
  `unclear`), `summary`, `covered`, `missing` (≤ 6), `followUps` (≤ 3, worded so as not to give
  the answer away), `suggestedScore` (0..1, rounded to hundredths, null when there is nothing to
  score), `answer` (to the host's question, else null), `model`, `createdAt`.
- *Assessment* (`Interviewer.generateQuantRoomAssessment`, written only when the host asks with
  `POST …/report/assessment`): one call over every posed question, the whole transcript with a
  platform line where each was posed, the final scratchpad, the host's notes and a code-built
  table (time open, hints recorded, follow-up, how it ended, the host's verdict), on the quant
  dimensions (`QUANT_REPORT_DIMENSIONS`, `QuantAssessmentSchema`; speed judged on time open
  against difficulty, as there were no budgets), written for the host about the candidate in the
  third person. It never gives or changes a verdict (the host's are first-hand, and it may say
  where it disagrees). A room in which no bank question was posed is assessed on its
  conversation; one with nothing at all is refused `nothing_to_assess` before any call.

**The report** (`Report.quant`, the host's alone, only after the end): `QuantReport` with
`mode: 'hosted'`, `path` null and the posed questions in order, each a `QuantQuestionReview`:
`type` any of the bank's, `solution` `quizSolution`, `keyPoints` (short), `explanation`,
`status` (`answered` when the host closed it or moved on, `unfinished` when the pad ended on it;
never `not_reached`), the host's `verdict`, `hintsGiven`, `hintsAvailable`, `hintRungs`,
`followUpAsked`, `timeSec`, `budgetSec` null. Queued questions never posed are not in it, and no
hint or follow-up text is (`hintRungs` are numbers; the host reads the ladder in `GET …/host`,
which still answers after the end). `Report.stats` has the run figures null, as for any quant
pad; `interviewerMessages` counts the host's chat messages, never the posed questions.

**Answers are not a tab away.** A guest cannot reach the quiz at all (`requireAccount`). A
candidate signed in with an account is, while a non-host member of an active quant room, refused
by the quiz routes that reveal answers or explanations: `GET /api/quiz/questions/:id`,
`POST /api/quiz/questions/:id/answers`, `GET /api/quiz/attempts/:id`,
`POST /api/quiz/attempts/:id/answers`, `…/discussion` and `…/finish` answer 409
`in_quant_interview` ("You are a candidate in a quant interview that is still going: answers and
explanations are unavailable until it ends or you leave it."). One check, `refuseDuringQuantInterview`
(`apps/api/src/quant/guard.ts`), called first in each. Browsing topics, the roadmap, a topic's
bank (prompts only) and starting an attempt stay open. It lifts the moment the room ends or the
candidate leaves it (`DELETE /api/pads/:id`), and in any case `QUANT_INTERVIEW_GUARD_HOURS` (8)
after the room started, so a host who never ends a room cannot keep a candidate out of their own
quizzes; it never applies to the host. It is a
**deterrent, not a control**: a second account, another browser or another device defeats it;
the real control is the host, who is watching.

**Proven by tests**: `packages/contracts/test/quant-room.test.ts` (every host step and refusal,
the AI round unchanged and refusing host steps, the view, the posed text, a fuzz over host
steps, old payloads); `apps/api/test/quant-room.test.ts` (creation with and without a queue, a
guest end to end posing every type with hints, follow-up, closes, verdicts and an end
mid-question, the leak scan of every candidate payload, the queue, the bank search and who may
use it, the quiz guard, no quiz answer, the sweeper, the routes refused and accepted, the second
opinion, the assessment and an empty room, with the model scripted);
`packages/interviewer/test/quant-room.test.ts` (what the model is shown, people's text kept as
data, the answers' shaping, no call without a key or over budget).

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
- A quant room's host-only material (solutions, key points, explanations, hint ladders, follow-ups, verdicts, the queue, §8.4) is returned only by `GET …/host` and the `host/round/*` routes, behind `roomForHost`; what a candidate gets of the round is `publicRound`, built field by field. A candidate in an active quant room is refused the quiz routes that reveal answers (`in_quant_interview`), a deterrent only.

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
- Pads do not end automatically when the timer reaches zero; the interviewer calls time (in a
  quant round the API's sweeper also closes overdue questions nobody is there for, §8.2, but the
  pad still waits for its owner to end it). (A pad
  created with `durationMin: null` has no time limit: its clock shows the time elapsed, and the
  interviewer raises no clock checkpoints and is told not to bring up the time.)

## 10. Out of scope for the first version

Language servers in the editor (clangd/pyright/jdtls), video calls, server-side voice pipeline,
multi-instance API, admin UI for content, email verification, linked-list/tree parameter types.
