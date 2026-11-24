# judge — interview++ code-execution worker

Consumes `JudgeJob`s from Redis, runs them in a fresh hardened container per job, writes
`JudgeResult`s. Wire contract: `packages/contracts/src/judge.ts`; design: `docs/ARCHITECTURE.md` §6.

```
apps/judge/              binary `judge` (worker + CLI): config, runner (job -> result), Redis worker
crates/judge-contracts/  serde mirror of the TS contract + result comparison (port of content/src/compare.ts)
crates/judge-harness/    tree-sitter class extraction, generated C++ harness, driver protocol, diagnostics
crates/judge-sandbox/    Docker containers + the supervisor protocol (bollard)
infra/sandbox/           one image per language, the in-sandbox supervisor (ipp-run.c), the drivers, build.sh
```

## Running it

```sh
infra/sandbox/build.sh                     # builds ipp-sandbox-{cpp,python,java}:1 (needs network once)
cargo build --release -j 4

# Local development: gVisor is not available, so allow runc explicitly.
export SANDBOX_RUNTIME=runc JUDGE_ALLOW_INSECURE_RUNTIME=1

target/release/judge check                 # runtime registered? images present with the right protocol?
target/release/judge                       # = judge serve: consume judge:jobs until SIGTERM/SIGINT
target/release/judge run-job job.json [--progress]          # run one JudgeJob, print the JudgeResult
target/release/judge run-problem problem.json [--lang cpp,java] [--tests tests.json]
                                           # run a ProblemContent's reference solutions against its tests
                                           # (exit code 1 if any is not accepted)
```

`run-problem` takes the JSON form of a problem (like `packages/contracts/fixtures/problem-*.json`);
`--tests` replaces its tests with a `TestCase[]` file such as `packages/content/problems/*/tests.json`.

The judge refuses to start with any runtime other than `runsc` unless `JUDGE_ALLOW_INSECURE_RUNTIME=1`,
and then logs a loud warning at startup. `sandbox.runtime` in every result says what was used.

### Configuration (environment; the repo-root `.env` is loaded first)

| Variable | Default | |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` | required when `NODE_ENV=production` |
| `SANDBOX_RUNTIME` | `runsc` | required when `NODE_ENV=production` |
| `JUDGE_ALLOW_INSECURE_RUNTIME` | unset | `1` permits a non-gVisor runtime (development only) |
| `JUDGE_CONCURRENCY` | `2` | jobs (= containers) at once |
| `JUDGE_IMAGE_CPP` / `_PYTHON` / `_JAVA` | `ipp-sandbox-<lang>:1` | must carry label `ipp.sandbox.protocol=1` |
| `JUDGE_JOBS_STREAM`, `JUDGE_JOBS_GROUP`, `JUDGE_RESULTS_STREAM`, `JUDGE_PROGRESS_CHANNEL` | `judge:jobs`, `judge`, `judge:results`, `judge:progress` | override for tests |
| `JUDGE_CONSUMER` | `judge-<hostname>` | consumer name; keep it stable across restarts |
| `JUDGE_RECLAIM_IDLE_MS` | `60000` | a pending job idle this long belongs to a dead judge and is reclaimed |
| `JUDGE_RECLAIM_INTERVAL_MS` / `JUDGE_HEARTBEAT_MS` | `15000` / `10000` | |
| `JUDGE_SHUTDOWN_GRACE_MS` | `120000` | how long running jobs may finish after SIGTERM |
| `JUDGE_RESULTS_MAXLEN` | `100000` | approximate cap on `judge:results` |
| `JUDGE_WORKDIR_MB` / `JUDGE_SANDBOX_CPUS` | `64` / `1` | tmpfs size, CPU quota per container |
| `RUST_LOG`, `LOG_FORMAT=json` | `info` | logs never contain source code or test data |

### Tests

```sh
cargo test -j 4                                  # unit + integration (Docker, images and Redis needed)
cargo clippy --all-targets -- -D warnings
IPP_JUDGE_SKIP_SANDBOX_TESTS=1 cargo test        # machines without Docker
SANDBOX_RUNTIME=runsc cargo test -p ipp-judge    # run the sandbox suite under gVisor (do this on the prod host)
```

The Redis test uses random `ipp-test-*` key names and deletes them; it never touches `judge:*`.

## Queue protocol

- `XGROUP CREATE judge:jobs judge 0 MKSTREAM` (BUSYGROUP tolerated; never from `$`), then
  `XREADGROUP ... COUNT 1 BLOCK 2000 ... >`, at most `JUDGE_CONCURRENCY` jobs at once.
- On start, the consumer's own pending entries (jobs it had not finished before a restart) are run first.
- While a job runs, its entry is refreshed every `JUDGE_HEARTBEAT_MS` (`XCLAIM ... 0 id JUSTID`, only
  while still owned), so only jobs of dead judges go idle; those are taken over with `XAUTOCLAIM`
  after `JUDGE_RECLAIM_IDLE_MS`.
- Delivery count (from `XPENDING`) > 2: the job is not run again; an `internal_error` result
  ("failed repeatedly inside the judge") is written instead. Unparseable payloads get an
  `internal_error` result when their `runId` can be read, and are dropped (acked) otherwise.
- Result: `XADD judge:results MAXLEN ~ N * payload <JudgeResult>`, retried with backoff; only then
  `MULTI XACK + XDEL` of the job (so `XLEN judge:jobs` is the real backlog the API checks). If the
  result cannot be written the job stays pending and is retried. Results can be duplicated (at-least-once);
  the API is idempotent on `runId`.
- Progress: `PUBLISH judge:progress <JudgeProgress>`, best effort (a bounded channel; dropped when
  Redis is slow). `started`, `compiling`, `running {done,total}` (≤ every 100 ms), and in file mode
  `output` chunks (coalesced to ≤ 8 KiB / 50 ms, never splitting a UTF-8 character).
- SIGTERM/SIGINT: stop taking jobs, let running ones finish for `JUDGE_SHUTDOWN_GRACE_MS`, then
  abandon them unacknowledged (they are reclaimed elsewhere) and remove their containers.
  Containers of a crashed judge are removed at its next start (label `ipp.judge.consumer`) and by a
  periodic sweep of judge containers older than 15 minutes.
- Budget: `totalMs` counts from when the judge starts the job (container, compile and tests), so a
  result normally arrives within `totalMs` + a few seconds; the API gives up at `totalMs + 30 s`
  after *enqueueing*, so a long queue wait eats into that.

## How a job runs

1. **Tests mode only — extraction** (`crates/judge-harness`, tree-sitter, outside the sandbox):
   - C++: every top-level item kept in order; `main` (also `signed main`, `int main(int, char**)`,
     inside `#ifdef`) is blanked out with spaces so all positions are unchanged. The translation unit is
     `#define main __ipp_user_main` (fallback if tree-sitter missed it) · `#line 1 "solution.cpp"` ·
     candidate code · `#line 1 "[harness]"` · `#undef` of every macro the candidate defined ·
     generated harness. Compiled with `-include ipp/support.h` (precompiled with `<bits/stdc++.h>`),
     so the candidate's macros (`#define int long long`) cannot reach the driver. Method parameter types
     are deduced from `&Class::method`, so `const vector<int>&`, by-value, `long long` etc. all work.
   - Python: keeps imports, defs, classes, assignments, docstrings, `sys.setrecursionlimit(...)` and
     `try:` blocks of imports; every other top-level statement (incl. `if __name__ == "__main__":`)
     is blanked, so line numbers are unchanged. A file tree-sitter cannot parse is passed through
     and Python reports the syntax error.
   - Java: `package` and the `public` of top-level types are blanked (same columns); file `Main.java`.
     A `static` nested class (`Main$Solution`) is accepted. The driver is precompiled in the image
     and calls the class by reflection, so its source never meets javac.
   - Then the class and every method are checked by name and arity (defaults, varargs,
     `@staticmethod`, inherited methods, unknown base classes) → `invalid_submission` with a message
     such as ``class `LRUCache` has no method `put` ``.
2. A container is created (see below), files are streamed in as a tar through the supervisor
   (`docker cp` cannot reach tmpfs), and the code is compiled (`g++ -std=c++23 -O2 -D_GLIBCXX_ASSERTIONS`,
   `javac` with a CDS archive). Diagnostics are rewritten: C++ diagnostics located in the harness or the
   support header lose their location and source snippet (`[test harness]: error: ...` plus a hint);
   javac's echoed source line is replaced by the candidate's original line.
3. **Tests**: one driver process runs the tests; the judge sends **one test at a time** on fd 3 and
   waits for its result before sending the next, so later (hidden) inputs are never in the sandbox
   early and expected outputs never enter it at all. Results come back on stdout as
   `"\x1eIPP" + nonce + "\x1f" + JSON + "\n"`; everything else on stdout/stderr between two frames is
   that test's output. Per test: watchdog `runMs + max(500, runMs/2)` (driver-measured time > `runMs`
   is also `time_limit`), output cap `outputBytes` per stream, peak RSS > `memoryMb` → `memory_limit`
   (the driver's own peak RSS, and the supervisor kills the driver once all sandbox processes
   together are resident in more than `memoryMb`).
   A result frame (the return values as JSON) may be at most 4 MiB (`runtime_error` "the return value
   is too large" otherwise), and a run keeps at most 4 MiB of `actual` values in total (beyond that
   `actual` is null and `message` says so). Every write to the supervisor times out after 5 s (the
   candidate can SIGSTOP it), so a wedged sandbox costs a test, never the judge's slot.
   A crash, kill, watchdog or overflow marks the in-flight test and a new driver resumes with the next
   test. If the program broke the sandbox itself (under gVisor, exhausting the container's memory
   stops the whole sandbox; or the program stopped its supervisor so it cannot be killed), that test
   gets its verdict (`memory_limit` when Docker reports an OOM kill, otherwise `runtime_error` "the
   program exceeded the sandbox's resource limits"), and the remaining tests continue in a fresh
   sandbox (recompiled). A job gets at most 2 fresh sandboxes this way: when the third one breaks,
   the remaining tests are `runtime_error` "not run: the program broke its sandbox 3 times". None of
   this is `internal_error`, and none of it uses the job's one retry for judge failures. Out of
   `totalMs` → `skipped`.
4. **Compare** outside the sandbox with `crates/judge-contracts/src/compare.rs` (same rules and JS
   number semantics as `packages/content/src/compare.ts`).
5. Result published, job acked, then the container is removed.

Run verdict (tests mode): the first test that is not `pass`/`ran` decides (`fail` → `wrong_answer`,
`skipped` → `time_limit`); otherwise `accepted` if any test passed, `ok` if all were custom.
`compile_error` / `invalid_submission` / `internal_error` results have an empty `tests` list. A Python
syntax error in tests mode is `compile_error` with `compile.ok = false` (documented in `judge.ts`).
File mode: `output_limit` > `time_limit` > `memory_limit` (kernel OOM kill, killed by the supervisor
over `memoryMb`, peak RSS > `memoryMb`, a Java `OutOfMemoryError`, or the sandbox OOM-killed) >
`runtime_error` (signal or non-zero exit, too many files, the sandbox stopped, the supervisor
killed) > `ok`. A program that stops its supervisor is `time_limit`.

### Driver protocol (version 1, label `ipp.sandbox.protocol`)

fd 3, JSON lines: header `{"nonce","className","ctorTypes","methodTypes"}`, then
`{"ctorArgs":[...],"calls":[{"method","args"}]}` per test. Frames on stdout:
`{"t":"ready"}`, `{"t":"result","ok":true,"values":[...],"ms":..,"rssKb":..}`,
`{"t":"result","ok":false,"kind":"exception"|"memory"|"input","error":"..."}`, and for Python/Java
`{"t":"compile_error"|"init_error","error":"..."}`. Exceptions are reported with the candidate's own
stack frames only (`solution.py` / `Main.java`); driver frames are filtered out.
Drivers: `infra/sandbox/cpp/support.{h,cpp}`, `infra/sandbox/python/driver.py`,
`infra/sandbox/java/IppDriver.java`. Changing any of them means bumping the image version.

## The sandbox

One container per job, created through the Docker API and force-removed afterwards:

| | |
|---|---|
| runtime | `SANDBOX_RUNTIME` (`runsc` required for strangers) |
| network | `NetworkMode=none`, `NetworkDisabled` (runc: only `lo` exists; gVisor: no interface at all) |
| filesystem | read-only rootfs; `/work` tmpfs 64 MB, 8192 inodes (`nosuid,nodev`, uid 10001, 0700); `/dev/shm` tmpfs 1 MB, 64 inodes; `/tmp` read-only empty tmpfs; no volumes, no Docker socket |
| identity | uid/gid 10001 for PID 1 and every exec; `CapDrop ALL`; `no-new-privileges`; Docker's default seccomp profile; setuid bits stripped in the images |
| cgroup | memory = swap = max(`memoryMb` + 64 + 64, compile need: C++ 768 / Java 640 MB), + 64 MB under gVisor for the sandbox kernel; 1 CPU; pids: runc 64 (Java 128), gVisor 1024 (see below) |
| ulimits | container: core 0, nofile 1024, fsize 64 MB; per program (supervisor): fsize 16 MB, nofile 128 (Java 512), stack = `memoryMb` (C++/Python), core 0; gVisor only: nproc 64 (Java 128) |
| supervisor | kills the program once all sandbox processes are resident in more than `memoryMb` (the compiler: the container limit − 64 MB), or once the tmpfs mounts hold more than 8256 inodes; polled every 50 ms, every 10 ms above half the memory cap |
| other | `oom_score_adj` 1000 (sandboxes die before anything else on the host), logging driver `none`, private IPC, hostname `sandbox`, empty environment (image defaults only) |

PID 1 is `ipp-run --idle` (reaps orphans; the kernel will not deliver SIGKILL to it from inside).
Each step is a `docker exec` of `ipp-run [limits] -- program`, which:
puts the program's input on the requested fd (stdin is `/dev/null` in tests mode, so a stray
`cin >>`/`input()` cannot eat the test stream), applies rlimits and `oom_score_adj=1000`, sets
`PR_SET_PDEATHSIG`, relays stdout/stderr in separate frames, enforces a wall-clock backstop and an
output backstop, polls the resident memory of all sandbox processes (`/proc/*/statm`) and the inodes
in use on the tmpfs mounts (every 50 ms; every 10 ms above half the memory cap), and on exit, `K` or any limit SIGKILLs **every process of
the sandbox uid** (`kill(-1)`) until none is left, then reports exit code/signal, wall and CPU time,
peak RSS (rusage and polled), which limit killed it, and whether the cgroup OOM killer fired
(`memory.events`, runc only). Nothing outlives a step.

### Enabling gVisor (`runsc`) — required before strangers can reach the service

No KVM is needed: gVisor's default `systrap` platform works in any VM.

```sh
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
  | sudo tee /etc/apt/sources.list.d/gvisor.list
sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install            # adds {"runtimes":{"runsc":{"path":"/usr/bin/runsc"}}} to /etc/docker/daemon.json
sudo systemctl restart docker
docker run --rm --runtime=runsc --network none ipp-sandbox-python:1 python3 -c 'import os; print(os.uname())'
```

If the daemon uses the systemd cgroup driver and containers fail to start under runsc with a cgroup
path error, add `"runtimeArgs": ["--systemd-cgroup"]` to the `runsc` entry in `daemon.json` and
restart Docker. With KVM available, `"runtimeArgs": ["--platform=kvm"]` is faster.

Then run with `SANDBOX_RUNTIME=runsc` (and without `JUDGE_ALLOW_INSECURE_RUNTIME`), run `judge check`,
and run the integration suite under gVisor on that host
(`SANDBOX_RUNTIME=runsc cargo test -p ipp-judge --test sandbox`). The suite passes under both
runtimes; tests branch on the runtime only where behaviour legitimately differs, and say why.
The default `runsc install` entry (no `runtimeArgs`) is what has been tested (runsc 20261116.0,
systrap, cgroup v2 with the systemd driver).

#### How gVisor differs, and what the judge does about it

gVisor runs every sandbox on its own user-space kernel (the "sentry"), which the host sees as a few
processes in the container's cgroup. Measured on the judge VM:

- **Memory.** Application memory lives inside the sentry, so when the container reaches its cgroup
  limit the host OOM-kills the sentry and the whole sandbox stops (Docker reports
  `State.OOMKilled`), where runc kills only the offending process. The supervisor therefore kills a
  program as soon as all sandbox processes are resident in more than `memoryMb` (~800 MB/s of
  growth is caught within a poll; the container has ≥128 MB of headroom above `memoryMb`), so
  ordinary over-use and runaway growth are `memory_limit` and the sandbox survives. If the sandbox
  dies anyway (the program stopped its supervisor first, or exhausted memory the sentry keeps for
  itself, such as pipe buffers), the judge detects it (`docker inspect`), gives the test
  `memory_limit` (OOM-killed) or `runtime_error`, and continues in a fresh sandbox, at most twice per
  job. `getrusage` peak RSS (`ru_maxrss`) and `/proc/<pid>/statm` work under gVisor;
  `/sys/fs/cgroup/memory.events` does not exist there (gVisor shows its own cgroup v1 hierarchy).
- **Processes.** The host pids limit counts the sentry's threads (~26 idle) and the host processes
  behind every application process (~3.7 per forking process; sleeping threads cost nothing), and
  the sentry dies when it cannot create a thread: with the runc limit of 64 a fork bomb stopped the
  sandbox. Under gVisor the host limit is 1024 and the program's limit is RLIMIT_NPROC 64 (Java 128)
  inside the sandbox, which gVisor enforces per sandbox (under runc RLIMIT_NPROC would be shared by
  every container with uid 10001, so it is not used there). Measured: 128 forking processes take
  ~480 host pids; a JVM uses ~20 tasks and can start ~110 more threads. A fork bomb gets `EAGAIN`
  like under runc and ends as `time_limit` (or `memory_limit`, when its copies together exceed
  `memoryMb`).
- **Files.** gVisor honours tmpfs `size=` but ignores `nr_inodes`, and each inode costs the sentry
  ~1.2 KiB of its own memory (200k empty files: 250 MB), so the supervisor kills a program once the
  tmpfs mounts hold more than 8256 inodes (`runtime_error` "too many files"; under runc it gets
  `ENOSPC`). Without a mount on `/tmp`, gVisor puts a writable, size-less, memory-backed tmpfs there,
  hence the explicit read-only one. `/dev/mqueue` does not exist under gVisor.
- **Network.** With `NetworkMode=none` there is no interface at all, not even `lo`.

Production isolation (ARCHITECTURE §6.3): run the judge on its own VM with only outbound Redis
access, a Redis ACL limited to `judge:*`, and no route to Postgres or the API. The judge has the
Docker socket, i.e. root on that VM — that VM is the blast radius, which is why gVisor matters.

### Known weaknesses

- **Under runc the boundary is the host kernel** (namespaces + seccomp + no caps). A kernel bug
  reachable through the default seccomp profile is a container escape. This is why runsc is required.
- Candidate code shares a uid with the supervisor and a process with the driver: it can forge result
  frames (it would need to know the expected output to gain anything), kill the supervisor (costs it
  that test; a new driver resumes), or lie about its own timing (bounded by the watchdog).
- Memory: the container limit is at least 768 MB (C++) / 640 MB (Java) so that compilers fit; a
  program over `memoryMb` is killed by the supervisor's poll (`memory_limit`), so it can briefly
  use more. Memory shared between forked processes counts once per process (gVisor has no
  `smaps`/PSS), which can only overstate. Java is also limited by `-Xmx = memoryMb - 256`. A
  program that stops its supervisor is no longer watched; the cgroup limit (runc: kernel OOM kill;
  gVisor: the whole sandbox) is the backstop, and costs a fresh sandbox.
- Under gVisor, memory the sentry keeps for itself (pipe and socket buffers, inode metadata) is not
  application memory and is only bounded by the container limit (losing the sandbox) and by the
  task, file and inode limits.
- CPU time is not limited separately from wall time (one CPU quota per container, wall-clock
  watchdogs), so a program that sleeps uses its time limit without using CPU.
- `/dev/mqueue` is writable (bounded by RLIMIT_MSGQUEUE, 800 KB); `/work` allows exec (needed).
- The supervisor's input buffer and the exec stream are trusted to the judge; the judge caps per-test
  output, the supervisor caps total output (256 MB backstop for the driver, 2 × `outputBytes` in file mode).
- Images are pinned by tag and digest at build time; rebuilding later picks up nothing new unless
  the Dockerfiles change. Base-image CVEs need a deliberate bump.

## Latency

Measured with `judge run-job` (release build, runc, WSL2 12 vCPU, load average ~15 from other builds),
5 runs each, median `timing.totalMs` and the logged phases. Small jobs: two-sum reference solution
with 3 tests, or hello-world reading stdin in file mode.

| job | total | container create+start | files in | compile | run / tests |
|---|---|---|---|---|---|
| C++ tests | ~2.8 s | ~0.38 s | ~0.08 s | ~2.3 s | ~0.09 s |
| C++ file | ~2.2 s | ~0.37 s | ~0.09 s | ~1.7 s | ~0.08 s |
| Python tests | ~0.62 s | ~0.39 s | ~0.08 s | — | ~0.15 s |
| Python file | ~0.60 s | ~0.40 s | ~0.09 s | — | ~0.10 s |
| Java tests | ~1.7 s | ~0.46 s | ~0.08 s | ~0.85 s | ~0.25 s |
| Java file | ~1.45 s | ~0.43 s | ~0.08 s | ~0.70 s | ~0.20 s |

Under gVisor, on the production judge VM (GCE e2-standard-2, runsc 20261116.0, systrap), same
jobs, median of 5 (runc on the same VM in brackets, median of 3):

| job | total | container create+start | files in | compile | run / tests |
|---|---|---|---|---|---|
| C++ tests | ~3.1 s (2.3) | ~0.22 s (0.21) | ~0.07 s | ~2.75 s (1.94) | ~0.06 s |
| C++ file | ~2.4 s (1.6) | ~0.22 s | ~0.08 s | ~2.0 s (1.28) | ~0.07 s |
| Python tests | ~0.50 s (0.44) | ~0.23 s | ~0.08 s | — | ~0.20 s (0.12) |
| Python file | ~0.40 s (0.37) | ~0.21 s | ~0.08 s | — | ~0.10 s (0.09) |
| Java tests | ~1.98 s (1.31) | ~0.21 s | ~0.08 s | ~1.38 s (0.86) | ~0.31 s (0.18) |
| Java file | ~1.95 s (1.27) | ~0.22 s | ~0.07 s | ~1.34 s (0.80) | ~0.31 s (0.19) |

gVisor costs nothing measurable in container creation; it makes the compilers ~40-70% slower
(GCC and javac are system-call and page-fault heavy, and every one goes through the systrap
platform) and JVM start-up ~0.12 s slower. With KVM (`--platform=kvm`, not available on this VM
type) that overhead is lower; no filesystem option helps here (the root is read-only and already
uses directfs, and the work directory is a sandbox-internal tmpfs). The supervisor's memory poll
costs ~0.4 ms of sandbox CPU per scan under gVisor, hence the adaptive 50/10 ms interval (~3% on a
compile).

Removing the container (~0.3 s) happens after the result is published. What dominates:

- **C++: GCC.** Even with `<bits/stdc++.h>` precompiled, GCC 15 spends ~1.3 s per translation unit in
  its "deferred" phase for the C++23 standard library (an empty `main` with the PCH takes 1.5 s;
  that phase takes ~0.2 s under `-std=c++17`), which a PCH does not save. The PCH saves ~3 s of
  parsing (4.9 s → 1.6 s for a small `<bits/stdc++.h>` program), and the driver's non-template code is
  prebuilt into a library so each job compiles only the candidate's code and a few instantiations.
- **Everything: container creation** (~0.4 s). A pool of pre-created, never-used containers per
  language would take this off the critical path (not implemented; containers must stay single-use).
- **Java: javac** (~0.8 s, of which ~0.25 s is saved by the class-data-sharing archive).

Re-measure with `RUST_LOG=info judge run-job job.json`; every job logs
`job phases container=… files=… compile=… run|tests=…`.
