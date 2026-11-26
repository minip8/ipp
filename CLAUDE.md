# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

interview++ is a prep site for quant and software interviews: collaborative coding pads (C++,
Python, Java) with an AI interviewer that speaks up on its own, quant question banks (numeric
answers, multiple choice, and open questions discussed with the interviewer; the Quant page lays
them out as trader and researcher paths) and fundamentals quizzes for developers.
`docs/ARCHITECTURE.md` is the design and security reference; `docs/DEPLOY.md` covers production.

## Git and deploys

You may commit, push, open pull requests and merge them without asking first.

Pushing to `main` deploys to production: `.github/workflows/deploy.yml` runs typecheck, lint and
tests on every push and pull request, and a push to `main` that passes is then deployed to the
live app host (build, **migrate**, seed, restart). So anything merged or pushed to `main` should
be ready to go live; use a branch and pull request for work that is not. The judge host is never
deployed by the workflow; changes under `crates/`, `apps/judge` or `infra/sandbox` need the
manual steps in `docs/DEPLOY.md` ("Updating").

## Commands

Needs Node 22+, pnpm, Docker and a Rust toolchain. Postgres and Redis run in Docker
(`pnpm infra:up`); the env file is `/.env` at the repo root (`cp .env.example .env`).

```sh
pnpm install
pnpm infra:up && pnpm db:migrate && pnpm db:seed   # seed is idempotent; it loads packages/content

# Run the stack (three processes)
pnpm --filter @ipp/api dev                                              # :4000
SANDBOX_RUNTIME=runc JUDGE_ALLOW_INSECURE_RUNTIME=1 target/release/judge  # after infra/sandbox/build.sh && cargo build --release -j 4
pnpm --filter @ipp/web dev                                              # :3000

# Checks (what CI runs)
pnpm typecheck && pnpm lint && pnpm test
pnpm format                                    # biome check --write

# One package / file / test
pnpm --filter @ipp/api test
pnpm --filter @ipp/api exec vitest run test/quiz.test.ts -t "part of the test name"
pnpm --filter @ipp/web exec playwright test library -g "categories"      # browser tests

# Rust
cargo test -j 4 && cargo clippy --all-targets -- -D warnings
cargo test -p ipp-judge-contracts -j 4         # crate names carry an ipp- prefix

# Content and database
pnpm --filter @ipp/content check               # validates problems/quiz; Python references reproduce the tests,
                                               # and every quant numeric answer is recomputed
pnpm --filter @ipp/content exec tsx scripts/judge-all.ts   # every reference solution through the real judge
pnpm --filter @ipp/db generate --name <what_changed>       # after editing packages/db/src/schema.ts
```

The machine is small (about 7 GB RAM): build Rust with `-j 4`, prefer `tsc --noEmit` and tests
over `next build`, and do not run several heavy builds at once.

### Test infrastructure

- **API and db tests use the real Postgres and Redis**, not mocks. They create and migrate their
  own databases: `API_TEST_DATABASE_URL` (default `…/ipp_test`), `API_TEST_REDIS_URL` (default
  Redis DB 15), `DB_TEST_DATABASE_URL` (default `…/ipp_test_db`). API test setup truncates its
  database, so two runs at once must be given different URLs. Never point tests at the dev
  database `ipp`.
- **Browser tests (`apps/web/e2e`) run against a mock of the API**, `e2e/mock-api.ts`, built from
  fixtures in `e2e/fixtures*.ts`. A feature that adds or changes an endpoint must be mirrored
  there or its spec cannot pass. Playwright starts `next dev` on fixed ports (3100, plus 4100 for
  a real collab server) and reuses a server that is already listening, so only one run at a time
  and never from two checkouts.
- `SCREENS=1 pnpm --filter @ipp/web exec playwright test screens` writes light/dark screenshots at
  1440 and 390 px to `apps/web/e2e/.screens/` (`ONLY=dashboard,new` and `SCREEN_WIDTHS=1440`
  narrow it). Use it to look at UI changes.
- `test:e2e:real` and `packages/interviewer/scripts/simulate.ts` hit the running stack and a live
  model; they are not part of the normal checks. `simulate.ts --quant` plays a quant round against
  a live model: run it after changing `packages/interviewer/src/quant/` (the prompt's behaviour is
  the one thing the tests, which script the model, cannot show).
- `apps/api/test/quant-round-real.test.ts` runs the real interviewer against the real API, database
  and socket with only the model scripted; it is where a mismatch between the two halves of a
  quant round shows up.

## Architecture

```
browser ── /api/* (Next rewrite, same origin, cookie session) ──▶ apps/api (Hono)
   ├─ WS /ws/pads/:id   JSON events (runs, chat, interviewer)        │  Postgres (Drizzle)
   └─ WS /collab        Yjs via Hocuspocus (the editor document)     │  Redis
                                                                     ▼
                     judge:jobs stream ─▶ apps/judge (Rust) ─▶ judge:results stream
                                            one sandboxed container per run (gVisor, no network)
```

- **`packages/contracts`** (Zod) is the source of truth for every shape that crosses a boundary:
  HTTP bodies, WebSocket events, the judge queue protocol, content formats. The web client parses
  every response with these schemas (`apps/web/src/lib/api.ts`), and JSON fixtures in
  `packages/contracts/fixtures` are also read by the Rust crates. Change a contract first, then
  both sides.
- **Internal packages export TypeScript source**; there is no build step (`tsx` for the API,
  `transpilePackages` in Next). `@ipp/db/orm` re-exports the Drizzle helpers the API uses.
- **`apps/api`** owns auth (Better Auth), authorization, rate limits, both WebSocket endpoints and
  the live Yjs document. It is assumed to be a single instance: pad rooms, the collab documents
  and interviewer state are in memory. Routes are thin (`src/routes`), shaping for the browser is
  in `src/views.ts`.
- **Server-only data never reaches the browser**: hidden tests, interviewer notes, reference
  solutions, quiz answers and explanations before a response is recorded, and quiz `hints` and
  `followUps` ever. Runs are stored
  unredacted and passed through `src/runs/redact.ts` on the way out; the interviewer gets the
  unredacted version.
- **Running code**: the API inserts a run, queues a self-contained job on a Redis stream and
  consumes the result stream; the judge extracts the candidate's class, generates a driver,
  compiles and runs it in a container, and compares outputs itself (expected values never enter
  the sandbox). The judge talks only to Redis and Docker: no database, no secrets.
- **`packages/interviewer`** decides when to speak and what to say; the API (`src/interviewer/host.ts`)
  feeds it triggers (`session_started`, `code_changed`, `run_finished`, `tick`, …) and does all
  I/O for it through `InterviewerDeps` (`src/types.ts`). Model calls go through the `ModelClient`
  seam: `src/model.ts` (Anthropic) and `src/openai-compat.ts` (OpenAI, Gemini, OpenRouter), with
  one table entry per provider in `src/providers.ts`. Tests use fakes and an injected `fetch`.
- **Bring your own key** (ARCHITECTURE §7): every model call runs on the key of the user it
  serves; there is no operator key and the server must never fall back to a provider key from its
  environment. Keys live only in Redis, encrypted, with a sliding expiry
  (`apps/api/src/ai/keys.ts`); they are never returned, logged or put in an error message, and
  provider base URLs are fixed server-side. A pad runs on its owner's key and optionally a model
  chosen per interview (`InterviewerSettings.model`); a refused model falls back to the provider
  default without discarding the key.
- **Interview rooms** (ARCHITECTURE §4.1): a pad of kind `room` is hosted by its owner, who
  interviews whoever joins by the invite link; a candidate needs only a name (a guest user,
  created only by `POST /api/pads/join-guest`). Guests may use the pads they are members of and
  nothing else: a new route that is not about a pad takes `requireAccount`, not `requireUser`.
  A room has no AI in the conversation and may have no problem (`problemSlug` null), and
  host-only data (interviewer notes, reference solutions, `host_notes`, the AI review, the
  report) must never be put in `PadDetail`, the shared Yjs document or a broadcast event. A
  **quant room** (ARCHITECTURE §8.4: `POST /api/pads` with `kind: 'room', format: 'quant'`, no
  key needed) interviews on questions of the bank: its round is `mode: 'hosted'`, moved only by
  the host's steps (`QuantHostStep`, the `…/host/round/*` routes, `apps/api/src/quant/room.ts`),
  with no clock and never recorded as anyone's quiz answer. Its host-only data (solutions, hint
  ladders, follow-ups, verdicts, the queue) goes out only through `GET …/host` and
  `…/host/round/*` behind `roomForHost`; a candidate gets `publicRound` (no total, no budgets),
  and while the room is active the quiz routes that reveal answers refuse them
  (`refuseDuringQuantInterview`, 409 `in_quant_interview`: a deterrent, not a control).
- **The mental math drill** (ARCHITECTURE §8.1) is generated and marked in the browser; the API
  only stores finished runs (`drill_runs`, `POST`/`GET /api/drill/runs`) after the contract's
  consistency checks, computing totals, score and `finishedAt` itself. Bests count full-mix runs only.
- **Quant rounds** (ARCHITECTURE §8.2): a practice pad of `format: 'quant'` (`POST /api/pads/quant`)
  has no problem, code or runs; the AI interviewer asks quant-track questions one by one while the
  candidate works on the scratchpad. The round's state (`quant_rounds`) is server-only and changes
  only through the pure `advanceRound` in contracts, applied by `apps/api/src/quant/round.ts` behind
  a compare-and-swap on its version. A stored state without `mode` is an AI round (`quantMode`);
  a quant room's is `hosted` (§8.4), and each refuses the other's steps (`wrong_mode`). The
  browser gets `publicRound` (`PadDetail.round`,
  `round.updated`), and question ids, answers, verdicts, hints and later questions reach it only in
  the report after the pad ended (hint and follow-up text never). Assembly is
  `apps/api/src/quant/assemble.ts`; the interviewer's side is `packages/interviewer/src/quant/`
  (one structured turn per message, the books and the clock kept in code); the web's is
  `apps/web/src/features/quant-pad/`, loaded only for a quant pad. A route or event that assumes code or a problem must refuse a
  quant pad, a quant room included (409 `wrong_format`). A slot may hold a market-making game (ARCHITECTURE §8.3,
  `packages/contracts/src/quant-game.ts`): its hidden values, quotes, position and P&L live in the
  round's state and change only through `advanceRound`; a stored trade names the interviewer's
  side, everything shown names the candidate's, and the browser gets `gameView` only (never a
  hidden value or the fair value). A trader round has one in its second slot
  (`includeGame` overrides); the candidate quotes through `POST /api/pads/:id/round/quote`, posted
  as their chat message and handed to the interviewer as one, a refusal being 409 with the
  round's reason as the code; every step's game entries become `game` timeline events. The
  interviewer reads a game's slot as a `kind: 'game'` entry of `QuantContext.questions` (content
  and `gameBooks`), whose books, counterparty notes and explanation stay out of every prompt
  until it can make moves.
- **`apps/web`** is UI only. Read `apps/web/AGENTS.md` first: this Next.js version differs from
  older ones, and the relevant guide under `apps/web/node_modules/next/dist/docs/` should be read
  before writing Next-specific code. Features live in `src/features/<name>/`, with pure logic in
  a `logic.ts` beside the components and unit-tested there; shared primitives are in
  `src/components/ui`. Pages carry a per-request CSP nonce (`src/proxy.ts`, `src/lib/csp.ts`).

## Content

- A coding problem is a directory under `packages/content/problems/<slug>/` (`two-sum` shows the
  shape): `problem.yaml`, `statement.md`, `notes.md` (interviewer-only), `tests.json`, and
  reference solutions (C++ and Python required unless `languages:` restricts the problem; a
  restricted problem may add `starter.<ext>` and a server-only `harness.<ext>` appended to the
  candidate's code for judged runs, see ARCHITECTURE §6.1). `problem.yaml` needs a `category`
  (`dsa`, `implementation`, `data-structure`), and every tag must belong to a topic group in
  `packages/contracts/src/taxonomy.ts` or be listed in its excluded tags; a content test fails
  otherwise.
- Quiz questions are YAML arrays under `packages/content/quiz/<topic>/`; topics are declared in
  `quiz/topics.yaml` (in study order), each with a `track`: `fundamentals` (the default) or
  `quant`. A `numeric` question's `answer` is an integer, a fraction (`5/36`), a decimal or a
  percentage; without a `tolerance` a typed decimal or whole number within 0.5% (three
  significant figures) counts for a non-integer answer and everything else must be exact (`numericMatches` in
  `packages/contracts/src/numeric.ts`), with a `tolerance` (`abs`/`rel`) anything within it counts.
  `short` and `numeric` questions may add `hints` (gentlest first) and `followUps` for the
  discussion interviewer; both are server-only.
- Quiz Markdown renders `$...$` as KaTeX math. In a fundamentals topic write a dollar as `\$`
  (the content test rejects any math and any bare `$` there); in a quant topic every formula must
  typeset. `quiz/roadmap.yaml` groups each topic's subtopics into the
  roadmap's study areas, with prerequisites between areas of the same topic and a few `related`
  links to areas of other topics (written on one side, shown on both). Every subtopic a
  question uses must be on exactly one area of its topic (and every listed subtopic must have
  questions), so a question with a new subtopic fails the content check until it is placed
  there.
- Every `numeric` question of a quant topic needs an independent recomputation of its answer in
  `packages/content/scripts/quant_checks/<topic>.py` (`@check("<id>")`: enumerate, run the
  recurrence, or simulate; never restate the explanation's formula). The content check runs them
  (`scripts/verify-quant-quiz.py [topic]` runs them alone) and a content test fails when one is
  missing.
- A market-making game (ARCHITECTURE §8.3) is one file, `packages/content/games/<id>.yaml`
  (`QuantGame`; `mm-game-dice-sum` shows the shape): the id is the file name and no quiz
  question's, the topic a quant topic, and its prompt and explanation quant Markdown (every
  formula must typeset). `expect` (fair value, sd, min and max before anything is shown; fair,
  min and max exact, sd to four significant figures) must be what the engine computes from the
  game's components, and every game needs a `@check("<id>")` in
  `packages/content/scripts/quant_checks/games.py` that recomputes them by its own enumeration or
  simulation of the game as its prompt describes it (returning `GameFigures`); the content check
  and a content test fail otherwise. `counterparty`, `hints` and `expect` are server-only.
- After changing content: run the content check, then `pnpm db:seed`.

## Database

Schema is `packages/db/src/schema.ts`; migrations in `packages/db/drizzle` are generated by
`drizzle-kit` and not hand-edited. A new `NOT NULL` column needs a default so the migration
applies to a populated table (the seed then writes real values).
