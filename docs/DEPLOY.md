# Deploying interview++

Two hosts, as in [ARCHITECTURE.md](ARCHITECTURE.md) §6.3: an **app host** (TLS proxy, web, API,
Postgres, Redis) and a **judge host** that runs untrusted code under gVisor and can reach nothing
but Redis. Files are in `infra/deploy/`.

What has been verified:

- This procedure was used to deploy `https://ipp.minip8.com` on Google Compute Engine: `gcp.sh`
  (`network`, `vms`, `push`, `lockdown`), `setup-app.sh` and the service unit have all been run.
- `setup-judge.sh` was run to the point of the sandbox tests, fixed twice along the way (those
  fixes are in the script), and its remaining install steps were then run by hand. The fixed
  script has not been run start to finish in one go.
- The sandbox test suite passes under gVisor on the judge host, and correct, wrong and hostile
  programs (fork bomb, memory hog, network access, writes to the root filesystem) get the right
  verdicts through the live site. One test of a program freezing its own supervisor has failed
  once in several runs under load; treat any failure of the suite as something to investigate,
  not to bypass with `runc`.

## Before you start

- A hostname, e.g. `interview.example.com`.
- A budget alert on the cloud project.

No Anthropic key: the AI features run only on keys users save themselves (ARCHITECTURE.md §7.1).
The server takes none and never uses `ANTHROPIC_API_KEY` / `ANTHROPIC_KEY`.

## Google Cloud

```sh
infra/deploy/gcp.sh network     # prints the static IP
```

Create a DNS **A record** for the hostname pointing at that IP. In Cloudflare set it to
**DNS only** (grey cloud): Caddy obtains the certificate itself and the API's per-IP rate limits
rely on seeing the client address. (Proxying through Cloudflare later is possible but needs
Caddy's `trusted_proxies` set to Cloudflare's ranges first.)

```sh
infra/deploy/gcp.sh vms
infra/deploy/gcp.sh push        # copies the repo to /opt/ipp-src on both VMs (never .env)
```

### App host

```sh
infra/deploy/gcp.sh ssh-app
cd /opt/ipp-src && infra/deploy/setup-app.sh interview.example.com
```

The first run writes `infra/deploy/.env.prod` with generated secrets. It prints the `REDIS_URL`
for the judge. `setup-app.sh` still writes an empty `ANTHROPIC_API_KEY=` line and suggests filling
it: ignore that, the API no longer reads it. Optionally add `AI_KEY_ENCRYPTION_SECRET`
(`openssl rand -hex 32`) so users' API keys are not encrypted under `BETTER_AUTH_SECRET`, and
`AI_KEY_TTL_HOURS` (default 24); see `env.prod.example`. Changing either secret later makes the
stored keys unreadable, and users add theirs again.

### Judge host

```sh
infra/deploy/gcp.sh ssh-judge
cd /opt/ipp-src && infra/deploy/setup-judge.sh 'redis://judge:<password>@<app private ip>:6379'
```

This installs Docker, gVisor and Rust, builds the sandbox images and the judge, runs
`judge check` and the sandbox integration tests under `runsc`, and installs the `ipp-judge`
service. Then, from your machine:

```sh
infra/deploy/gcp.sh lockdown    # judge VM egress: Redis on the app host only
```

Use `gcp.sh unlock` temporarily when the judge VM needs the internet (rebuilding images, updates).

## Google sign-in (optional)

1. Google Cloud Console → APIs & Services → OAuth consent screen: user type **External**, app name,
   support email, and the default scopes (`openid`, `email`, `profile`). Publish the app; these
   scopes need no Google review.
2. Credentials → Create credentials → **OAuth client ID** → *Web application*.
   - Authorised JavaScript origin: `https://interview.example.com`
   - Authorised redirect URI: `https://interview.example.com/api/auth/callback/google`
   - For local development add `http://localhost:3000` and
     `http://localhost:3000/api/auth/callback/google`.
3. Put the client ID and secret in `.env.prod` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   and re-run `setup-app.sh`. The button appears when both are set.

A Google sign-in whose email already has a password account is refused rather than merged
(emails are not verified, so merging would let someone pre-register another person's address).
The sign-in page tells the user to use their password instead.

## Go-live checks

```sh
# Browser tests against the deployed site (creates two test accounts). With REAL_ANTHROPIC_KEY
# set, the test pastes that key into the "add key" dialog, runs an interview, assessment and
# grading on it, then removes it; without it only the no-key states are checked.
REAL_API=1 REAL_BASE_URL=https://interview.example.com pnpm --filter @ipp/web exec playwright test -c playwright.real.config.ts
```

- The pages carry a nonce CSP: `curl -sI https://interview.example.com/sign-in` shows
  `content-security-policy` with `'nonce-…' 'strict-dynamic'` and no `'unsafe-inline'` in
  `script-src`, a different nonce on each request.

- On the judge host, `journalctl -u ipp-judge` shows no insecure-runtime warning, and run results
  report `sandbox.runtime: "runsc"`.
- Submit a fork bomb, an infinite loop, a memory blow-up and a network connect; each gets the
  right verdict and the judge keeps serving.
- From two different networks, confirm rate limits are tracked per client address.
- Postgres backups: schedule `pg_dump` from the `postgres` container to off-host storage, or move
  to a managed database.

## Updating

When updating a deployment from before bring-your-own-key: delete `ANTHROPIC_API_KEY` from
`.env.prod` (it is ignored now, and it is a secret with nothing using it), optionally add
`AI_KEY_ENCRYPTION_SECRET`, then deploy as below. Users see "add your API key" prompts until they
save one. Pages are now rendered per request (the CSP nonce), with no static HTML caching.

```sh
infra/deploy/gcp.sh deploy <hostname>   # app host: copy the checked-out commit, build, migrate, seed, restart
```

`deploy` ships the commit that is checked out (`git archive HEAD`), not the working tree, and
does not touch the judge host. Update that by hand when `crates/`, `apps/judge` or
`infra/sandbox` change:

```sh
infra/deploy/gcp.sh push
# judge host:  gcp.sh unlock; rebuild (cargo build --release, infra/sandbox/build.sh if images changed),
#              sudo install target/release/judge /opt/ipp/judge && sudo systemctl restart ipp-judge; gcp.sh lockdown
```

Both `deploy` and `push` unpack over `/opt/ipp-src` without removing anything (`.env.prod` lives
there), so a file deleted from the repository stays on the host. If a build fails on a file that
no longer exists in the repository, delete it on the host.

## Deploying from GitHub

`.github/workflows/deploy.yml` runs the checks (typecheck, lint, tests) on every push and pull
request, and on a push to `main` that passes runs `gcp.sh deploy` against the app host. It signs
in with Workload Identity Federation, so the repository holds no key.

One-time setup, from a machine where `gcloud` is signed in as a project owner and its
project/zone are the ones the VMs are in:

```sh
infra/deploy/gcp.sh ci-identity <owner>/<repo>
```

It creates the service account `ipp-deploy` and an OIDC provider in the workload identity pool
`github` (created if the project has none) that only this repository's `main` branch can use.
The account may read instance details and open IAP tunnels project-wide, and log in (with sudo)
to `ipp-app` only. OS Login must already be on for the project; the script checks and does not
change it. It prints the `gh variable set` lines for the five repository variables the workflow
reads; set `IPP_SITE_HOST` to the site's hostname. Until the variables are set the deploy job
is skipped and only the checks run.

The workflow's log is public when the repository is: `setup-app.sh` is run with
`IPP_NO_SECRET_OUTPUT=1` there so it does not print the judge's Redis URL.

## Still open

Email verification is off (anyone can register any address); Redis traffic between the two hosts
is authenticated but not encrypted (private network only), and users' encrypted API keys live in
the app host's Redis (its volume and backups hold them, so treat both as secret); see "Known
limitations" in ARCHITECTURE.md for the rest.
