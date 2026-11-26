# interview++

Practice for quant and software interviews in the browser: CoderPad-style coding pads (C++,
Python, Java) with an AI interviewer that speaks up on its own; quant question banks (probability,
brainteasers, betting and market making, options, statistics, linear algebra and calculus) with
numeric answers checked exactly and open questions talked through with the interviewer, laid out
as trader and researcher paths; and fundamentals quizzes for developers (C++, Python, computer
architecture, operating systems, networking, concurrency).

Design and security model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Deployment: [docs/DEPLOY.md](docs/DEPLOY.md).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js frontend |
| `apps/api` | Hono API, auth, WebSockets, collaborative editor server, hosts the interviewer |
| `apps/judge`, `crates/*` | Rust judge: class extraction, driver, sandboxed execution |
| `infra/sandbox` | One Docker image per language |
| `packages/contracts` | Shared Zod schemas and cross-language fixtures |
| `packages/db` | Drizzle schema, migrations, seed |
| `packages/interviewer` | Interviewer prompts, the speak / stay-silent policy, model clients per provider |
| `packages/content` | Coding problems and quiz questions |

## Running locally

Needs Node 22+, pnpm, Docker, and a Rust toolchain.

```sh
cp .env.example .env            # AI features use each user's own key (Anthropic, OpenAI, Gemini, OpenRouter)
pnpm install
pnpm infra:up                   # Postgres and Redis
pnpm db:migrate && pnpm db:seed # loads packages/content

infra/sandbox/build.sh          # sandbox images (first time, and after changing them)
cargo build --release -j 4

# three processes:
pnpm --filter @ipp/api dev
SANDBOX_RUNTIME=runc JUDGE_ALLOW_INSECURE_RUNTIME=1 target/release/judge
pnpm --filter @ipp/web dev      # http://localhost:3000
```

`runc` with `JUDGE_ALLOW_INSECURE_RUNTIME=1` is for development only. **Before anyone you do not
trust can reach the site, install gVisor and run the judge with `SANDBOX_RUNTIME=runsc`** — see
`apps/judge/README.md` — and run the judge on its own host as described in the architecture doc.

## Checks

```sh
pnpm typecheck && pnpm test && pnpm lint
cargo test -j 4 && cargo clippy --all-targets -- -D warnings

pnpm --filter @ipp/content check                           # content validates; Python references reproduce the tests
pnpm --filter @ipp/content exec tsx scripts/judge-all.ts   # every reference solution through the real judge
pnpm --filter @ipp/web test:e2e                            # browser tests on fixtures
pnpm --filter @ipp/web test:e2e:real                       # browser tests against the running stack
pnpm --filter @ipp/interviewer exec tsx scripts/simulate.ts  # scripted interview against the live model
```

## Adding content

- A coding problem is a directory under `packages/content/problems/` (see `two-sum` for the shape).
  Give it a `category` (`dsa`, `implementation` or `data-structure`) and tags from the topic
  groups in `packages/contracts/src/taxonomy.ts`; the content checks fail on a tag in no group.
- Quiz questions are YAML arrays under `packages/content/quiz/<topic>/`.
- Run the content checks above, then `pnpm db:seed` (idempotent).
