//! Running one job: provision a sandbox, compile, run (file mode or the test driver), compare
//! outside the sandbox, and build the `JudgeResult`. Never fails: anything unexpected becomes an
//! `internal_error` result (and is logged).

use crate::config::Images;
use anyhow::{Context, Result, anyhow};
use ipp_judge_contracts::compare::results_equal;
use ipp_judge_contracts::*;
use ipp_judge_harness::frames::{FrameParser, Piece};
use ipp_judge_harness::{self as harness, toolchain};
use ipp_judge_sandbox::{
    ContainerSpec, ContainerState, Exec, ExecEvent, ExecSpec, ExitStatus, GVISOR_HOST_PIDS,
    GVISOR_OVERHEAD_MB, MAX_FILES, Sandbox, SandboxSettings, append_capped,
};
use serde_json::Value;
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tokio::time::{sleep_until, timeout};

/// Receives progress events. Must not block (best effort).
pub trait Progress: Send + Sync {
    fn send(&self, p: JudgeProgress);
}

/// Progress callback used inside a job.
type SendFn<'a> = dyn Fn(ProgressEvent) + Send + Sync + 'a;

pub struct NoProgress;
impl Progress for NoProgress {
    fn send(&self, _: JudgeProgress) {}
}

pub struct Judge {
    pub docker: ipp_judge_sandbox::Docker,
    pub settings: SandboxSettings,
    pub images: Images,
}

/// Job limits after clamping to sane bounds (the API is trusted, but not blindly).
#[derive(Debug, Clone, Copy)]
struct Lim {
    compile: Duration,
    run_ms: i64,
    total: Duration,
    memory_mb: i64,
    output: usize,
}

impl Lim {
    fn from(l: &JudgeLimits) -> Lim {
        Lim {
            compile: Duration::from_millis(l.compile_ms.clamp(1_000, 120_000) as u64),
            run_ms: l.run_ms.clamp(50, 60_000),
            total: Duration::from_millis(l.total_ms.clamp(1_000, 300_000) as u64),
            memory_mb: l.memory_mb.clamp(32, 4096),
            output: l.output_bytes.clamp(1024, 16 << 20) as usize,
        }
    }
    /// How long after sending a test the judge gives up on it (the driver's own timing decides
    /// time_limit when the test does finish; this is the backstop for infinite loops).
    fn watchdog(&self) -> Duration {
        Duration::from_millis((self.run_ms + (self.run_ms / 2).max(500)) as u64)
    }
}

struct Outcome {
    verdict: RunVerdict,
    compile: Option<CompileOutcome>,
    file: Option<FileOutcome>,
    tests: Vec<JudgeTestResult>,
    message: Option<String>,
}

impl Outcome {
    fn simple(verdict: RunVerdict, message: impl Into<String>) -> Outcome {
        Outcome {
            verdict,
            compile: None,
            file: None,
            tests: vec![],
            message: Some(message.into()),
        }
    }
}

fn lossy(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

fn nonce() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("OS randomness");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Milliseconds between `enqueuedAt` and now.
fn queue_ms(enqueued_at: &str) -> f64 {
    chrono::DateTime::parse_from_rfc3339(enqueued_at)
        .map(|t| {
            ((chrono::Utc::now() - t.with_timezone(&chrono::Utc))
                .num_microseconds()
                .unwrap_or(0) as f64
                / 1000.0)
                .max(0.0)
        })
        .unwrap_or(0.0)
}

/// Largest result frame the judge accepts from the driver. A return value is otherwise only bounded
/// by the driver's 256 MiB output backstop, and every byte of JSON costs the judge ~30 bytes once
/// parsed and compared (and then travels through Redis, the API and Postgres): one candidate
/// returning a 60 MB array took the judge to gigabytes. The largest expected value in the problem
/// bank is ~200 KiB.
pub const MAX_RESULT_FRAME: usize = 4 << 20;
/// Total JSON size of `actual` values kept in one run's result; beyond it they are dropped (the
/// verdict and the first mismatch in `message` are unaffected).
pub const MAX_ACTUAL_BYTES: usize = 4 << 20;

pub const INTERNAL_ERROR_MESSAGE: &str =
    "The judge could not run this submission. Please try again.";

/// How many times one job may get a fresh sandbox (and recompile) because its program broke the
/// previous one: killed it (under gVisor, exhausting the container's memory stops the whole
/// sandbox) or wedged it (stopped its supervisor). Beyond this, the remaining tests are not run,
/// so a program that breaks the sandbox on every test costs at most three sandboxes.
pub const MAX_SANDBOX_REPLACEMENTS: usize = 2;
/// How long to wait for Docker to report a sandbox as stopped after its exec stream ended
/// without a status (measured: ~50 ms under gVisor).
const LOSS_WAIT: Duration = Duration::from_millis(500);

const SANDBOX_LIMITS_MESSAGE: &str =
    "the program exceeded the sandbox's resource limits and the sandbox was stopped";

impl Judge {
    /// Builds the result for a job that could not even be parsed or was delivered too often.
    pub fn internal_error(
        &self,
        run_id: &str,
        language: Option<Language>,
        message: &str,
        queue: f64,
    ) -> JudgeResult {
        JudgeResult {
            v: Version,
            run_id: run_id.to_string(),
            verdict: RunVerdict::InternalError,
            compile: None,
            file: None,
            tests: vec![],
            message: Some(message.to_string()),
            timing: Timing {
                queue_ms: queue,
                total_ms: 0.0,
            },
            sandbox: SandboxInfo {
                runtime: self.settings.runtime.clone(),
                image: language
                    .map(|l| self.images.get(l).to_string())
                    .unwrap_or_default(),
            },
        }
    }

    /// Runs a job and removes its sandbox.
    pub async fn run(&self, job: &JudgeJob, progress: &dyn Progress) -> JudgeResult {
        let (result, teardown) = self.run_deferred(job, progress).await;
        teardown.finish().await;
        result
    }

    /// Runs a job; the sandbox is removed by `Teardown::finish`, so the caller can publish the
    /// result first (removing a container takes a few hundred milliseconds).
    pub async fn run_deferred(
        &self,
        job: &JudgeJob,
        progress: &dyn Progress,
    ) -> (JudgeResult, Teardown) {
        let started = Instant::now();
        let queue = queue_ms(&job.enqueued_at);
        // Whether program output has already been streamed to the client (file mode).
        let output_sent = std::sync::atomic::AtomicBool::new(false);
        let send = |event: ProgressEvent| {
            if matches!(event, ProgressEvent::Output { .. }) {
                output_sent.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            progress.send(JudgeProgress {
                run_id: job.run_id.clone(),
                event,
            })
        };
        send(ProgressEvent::Started);
        let mut session = Session::new(self, job);
        let mut outcome = match job.mode {
            JobMode::File => session.run_file(&send).await,
            JobMode::Tests => session.run_tests(&send).await,
        };
        // An `Err` here is the judge's own infrastructure failing (a Docker call, the sandbox
        // protocol), never the candidate's program, which is reported through `Ok`. Try once more
        // in a fresh sandbox, unless output was already streamed (it would appear twice) or the
        // first attempt used most of the job's time budget.
        if let Err(e) = &outcome {
            let streamed = output_sent.load(std::sync::atomic::Ordering::Relaxed);
            let budget_left =
                started.elapsed() < Duration::from_millis(job.limits.total_ms.max(0) as u64 / 2);
            if !streamed && budget_left {
                tracing::warn!(run_id = %job.run_id, error = format!("{e:#}"), "job failed inside the judge; retrying once in a fresh sandbox");
                Teardown {
                    sandbox: session.sandbox.take(),
                }
                .finish()
                .await;
                session = Session::new(self, job);
                outcome = match job.mode {
                    JobMode::File => session.run_file(&send).await,
                    JobMode::Tests => session.run_tests(&send).await,
                };
            }
        }
        let teardown = Teardown {
            sandbox: session.sandbox.take(),
        };
        tracing::info!(
            run_id = %job.run_id,
            language = job.language.as_str(),
            phases = %session.phases.iter().map(|(k, v)| format!("{k}={v:.0}ms")).collect::<Vec<_>>().join(" "),
            "job phases"
        );
        let outcome = outcome.unwrap_or_else(|e| {
            tracing::error!(run_id = %job.run_id, error = format!("{e:#}"), "job failed inside the judge");
            Outcome::simple(RunVerdict::InternalError, INTERNAL_ERROR_MESSAGE)
        });
        let result = JudgeResult {
            v: Version,
            run_id: job.run_id.clone(),
            verdict: outcome.verdict,
            compile: outcome.compile,
            file: outcome.file,
            tests: outcome.tests,
            message: outcome.message,
            timing: Timing {
                queue_ms: queue,
                total_ms: started.elapsed().as_secs_f64() * 1000.0,
            },
            sandbox: SandboxInfo {
                runtime: self.settings.runtime.clone(),
                image: self.images.get(job.language).to_string(),
            },
        };
        (result, teardown)
    }
}

/// Removes a finished job's container.
pub struct Teardown {
    sandbox: Option<Sandbox>,
}

impl Teardown {
    pub async fn finish(mut self) {
        if let Some(sb) = self.sandbox.take() {
            sb.destroy().await;
        }
    }
}

impl Drop for Teardown {
    fn drop(&mut self) {
        if let Some(sb) = self.sandbox.take() {
            tokio::spawn(async move { sb.destroy().await });
        }
    }
}

/// Files and commands for one job, plus its sandbox once provisioned.
struct Session<'a> {
    judge: &'a Judge,
    job: &'a JudgeJob,
    lim: Lim,
    started: Instant,
    env: Vec<String>,
    files: Vec<(String, Vec<u8>)>,
    compile_cmd: Option<Vec<String>>,
    sandbox: Option<Sandbox>,
    /// The current sandbox's container OOM flag was already accounted for (it stays set).
    oom_seen: bool,
    /// (phase, ms) for the log line that explains where a job's time went
    phases: Vec<(&'static str, f64)>,
    /// Bytes of `actual` values that may still be kept in this run's result.
    actual_budget: usize,
}

impl Drop for Session<'_> {
    fn drop(&mut self) {
        // Only reached with a live sandbox if the job future was cancelled (shutdown).
        if let Some(sb) = self.sandbox.take() {
            tokio::spawn(async move { sb.destroy().await });
        }
    }
}

enum Provisioned {
    Ready(Option<CompileOutcome>),
    CompileFailed(CompileOutcome),
}

impl<'a> Session<'a> {
    fn new(judge: &'a Judge, job: &'a JudgeJob) -> Self {
        Session {
            judge,
            job,
            lim: Lim::from(&job.limits),
            started: Instant::now(),
            env: toolchain::env(job.language),
            files: vec![],
            compile_cmd: None,
            sandbox: None,
            oom_seen: false,
            phases: vec![],
            actual_budget: MAX_ACTUAL_BYTES,
        }
    }

    fn phase(&mut self, name: &'static str, since: Instant) {
        self.phases
            .push((name, since.elapsed().as_secs_f64() * 1000.0));
    }

    fn deadline(&self) -> tokio::time::Instant {
        tokio::time::Instant::from_std(self.started + self.lim.total)
    }

    fn sandbox(&self) -> &Sandbox {
        self.sandbox.as_ref().expect("provisioned")
    }

    async fn teardown(&mut self) {
        if let Some(sb) = self.sandbox.take() {
            sb.destroy().await;
        }
    }

    fn gvisor(&self) -> bool {
        self.judge.settings.gvisor()
    }

    /// Container memory: the program's limit, the tmpfs and 64 MB of slack (or what the compiler
    /// needs, if more), plus the sandbox kernel under gVisor.
    fn container_memory_mb(&self) -> i64 {
        let lang = self.job.language;
        let base = (self.lim.memory_mb + self.judge.settings.workdir_mb + 64)
            .max(toolchain::compile_memory_mb(lang));
        base + if self.gvisor() { GVISOR_OVERHEAD_MB } else { 0 }
    }

    /// RLIMIT_NPROC for programs: gVisor only (see `GVISOR_HOST_PIDS`).
    fn nproc(&self) -> i64 {
        if self.gvisor() {
            toolchain::pids_limit(self.job.language)
        } else {
            0
        }
    }

    /// Supervisor limits shared by every program of the candidate (driver or file-mode program):
    /// killed in the sandbox once over `memoryMb` resident, long before the container limit.
    fn program_spec(&self, argv: Vec<String>, in_fd: i32, wall_ms: i64, stack_mb: i64) -> ExecSpec {
        ExecSpec {
            argv,
            env: self.env.clone(),
            in_fd,
            wall_ms,
            cpu_s: 0,
            stack_mb,
            fsize_mb: 16,
            nofile: toolchain::nofile(self.job.language),
            max_output: 0,
            nproc: self.nproc(),
            max_rss_mb: self.lim.memory_mb,
            max_files: MAX_FILES,
        }
    }

    /// A Docker-reported OOM kill that has not been attributed yet (the flag stays set for the
    /// container's lifetime).
    fn fresh_oom(&mut self, st: &ContainerState) -> bool {
        let fresh = st.oom_killed && !self.oom_seen;
        self.oom_seen |= st.oom_killed;
        fresh
    }

    /// Verdict for a sandbox that stopped (or wedged) while the candidate's program ran in it.
    fn broken_sandbox_verdict(&mut self, st: &ContainerState) -> (TestVerdict, String) {
        if self.fresh_oom(st) {
            (
                TestVerdict::MemoryLimit,
                format!(
                    "memory limit exceeded ({} MB): the program used up the sandbox's memory",
                    self.lim.memory_mb
                ),
            )
        } else {
            (TestVerdict::RuntimeError, SANDBOX_LIMITS_MESSAGE.into())
        }
    }

    /// Creates the container, writes the files and compiles. Called again if the sandbox breaks.
    async fn provision(&mut self, send: &SendFn<'_>) -> Result<Provisioned> {
        self.teardown().await;
        let lang = self.job.language;
        let memory_mb = self.container_memory_mb();
        let spec = ContainerSpec {
            image: self.judge.images.get(lang).to_string(),
            memory_mb,
            pids: if self.gvisor() {
                GVISOR_HOST_PIDS
            } else {
                toolchain::pids_limit(lang)
            },
            run_id: self.job.run_id.clone(),
        };
        let t = Instant::now();
        let sb = Sandbox::create(&self.judge.docker, &self.judge.settings, &spec).await?;
        self.sandbox = Some(sb);
        self.oom_seen = false;
        self.phase("container", t);
        let t = Instant::now();
        self.sandbox()
            .put_files(&self.files, &[".tmp", "classes"], &self.env)
            .await?;
        self.phase("files", t);
        let Some(cmd) = self.compile_cmd.clone() else {
            return Ok(Provisioned::Ready(None));
        };
        send(ProgressEvent::Compiling);
        let spec = ExecSpec {
            argv: cmd,
            env: self.env.clone(),
            in_fd: -1,
            wall_ms: self.lim.compile.as_millis() as i64,
            cpu_s: 0,
            stack_mb: 64,
            fsize_mb: 64,
            nofile: 1024,
            max_output: 4 << 20,
            nproc: self.nproc(),
            // the compiler gets the container minus the tmpfs slack (and the sandbox kernel)
            max_rss_mb: memory_mb - 64 - if self.gvisor() { GVISOR_OVERHEAD_MB } else { 0 },
            max_files: MAX_FILES,
        };
        let t = Instant::now();
        let collected = self
            .sandbox()
            .exec(&spec)
            .await?
            .collect(self.lim.output.max(64 * 1024))
            .await;
        self.phase("compile", t);
        let out = match collected {
            Ok(out) => out,
            Err(e) => {
                // No status: if the compiler took the whole sandbox down (under gVisor, by
                // exhausting its memory), that is the candidate's code; anything else is ours.
                let st = self.sandbox().wait_stopped(LOSS_WAIT).await?;
                if st.running {
                    return Err(e);
                }
                let msg = if st.oom_killed {
                    "the compiler ran out of memory\n"
                } else {
                    "the compiler exceeded the sandbox's resource limits\n"
                };
                return Ok(Provisioned::CompileFailed(CompileOutcome {
                    ok: false,
                    output: msg.into(),
                    time_ms: t.elapsed().as_secs_f64() * 1000.0,
                }));
            }
        };
        let st = &out.status;
        if let Some(e) = &st.spawn_error {
            return Err(anyhow!("compiler could not start: {e}"));
        }
        let mut text = lossy(&out.stderr);
        text.push_str(&lossy(&out.stdout));
        let mut text = harness::rewrite_diagnostics(lang, &text, &self.job.source);
        if st.timed_out {
            text.push_str(&format!(
                "compilation timed out after {} s\n",
                self.lim.compile.as_secs()
            ));
        } else if st.oom_killed || st.memory_limit {
            text.push_str("the compiler ran out of memory\n");
        } else if st.file_limit {
            text.push_str("the compiler created too many files\n");
        }
        truncate_utf8(&mut text, self.lim.output);
        let outcome = CompileOutcome {
            ok: st.success(),
            output: text,
            time_ms: st.wall_ms,
        };
        Ok(if outcome.ok {
            Provisioned::Ready(Some(outcome))
        } else {
            Provisioned::CompileFailed(outcome)
        })
    }

    // ------------------------------------------------------------------ file mode

    async fn run_file(&mut self, send: &SendFn<'_>) -> Result<Outcome> {
        let lang = self.job.language;
        let prepared = harness::prepare_file(lang, &self.job.source);
        self.compile_cmd = toolchain::compile(
            lang,
            JobMode::File,
            &prepared.files[0].0,
            prepared.use_stdcxx_pch,
        );
        self.files = prepared.files.clone();
        let compile = match self.provision(send).await? {
            Provisioned::CompileFailed(c) => {
                return Ok(Outcome {
                    verdict: RunVerdict::CompileError,
                    compile: Some(c),
                    file: None,
                    tests: vec![],
                    message: None,
                });
            }
            Provisioned::Ready(c) => c,
        };
        send(ProgressEvent::Running { done: 0, total: 1 });
        let entry = match lang {
            Language::Java => prepared.entry.clone(),
            _ => prepared.files[0].0.clone(),
        };
        let cap = self.lim.output;
        let stack_mb = if lang == Language::Java {
            64
        } else {
            self.lim.memory_mb.min(1024)
        };
        let remaining = self
            .deadline()
            .saturating_duration_since(tokio::time::Instant::now());
        let wall = (self.lim.run_ms as u128).min(remaining.as_millis().max(1)) as i64;
        let mut spec = self.program_spec(
            toolchain::run(lang, JobMode::File, &entry, self.lim.memory_mb, stack_mb),
            0,
            wall,
            stack_mb,
        );
        // the judge enforces the per-stream cap; this is the supervisor's backstop
        spec.max_output = 2 * cap as i64 + 2;
        let run_started = Instant::now();
        let mut ex = self.sandbox().exec(&spec).await?;
        ex.send(self.job.stdin.as_bytes()).await?;
        ex.close_input().await?;

        let mut fwd = Forwarder::new(send);
        let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
        let mut truncated = false;
        let mut tick = tokio::time::interval(Duration::from_millis(50));
        let hard_deadline = tokio::time::Instant::now()
            + Duration::from_millis(wall as u64)
            + Duration::from_secs(5);
        let end = loop {
            tokio::select! {
                ev = ex.next() => match ev {
                    Some(ExecEvent::Stdout(b)) | Some(ExecEvent::Stderr(b)) if truncated => { let _ = b; }
                    Some(ExecEvent::Stdout(b)) => {
                        let room = cap.saturating_sub(stdout.len());
                        fwd.push(OutputStream::Stdout, &b[..b.len().min(room)]);
                        append_capped(&mut stdout, &b, cap);
                        if b.len() > room {
                            truncated = true;
                            // a stopped supervisor cannot be told; the container goes at teardown
                            if ex.kill().await.is_err() { break FileEnd::Stuck }
                        }
                    }
                    Some(ExecEvent::Stderr(b)) => {
                        let room = cap.saturating_sub(stderr.len());
                        fwd.push(OutputStream::Stderr, &b[..b.len().min(room)]);
                        append_capped(&mut stderr, &b, cap);
                        if b.len() > room {
                            truncated = true;
                            if ex.kill().await.is_err() { break FileEnd::Stuck }
                        }
                    }
                    Some(ExecEvent::Exit(st)) => break FileEnd::Status(st),
                    None => {
                        let st = self.sandbox().wait_stopped(LOSS_WAIT).await?;
                        if st.running && let Some(e) = &ex.stream_error {
                            return Err(anyhow!("exec stream failed: {e}"));
                        }
                        break if st.running { FileEnd::SupervisorLost } else { FileEnd::SandboxDied(st) };
                    }
                },
                _ = tick.tick() => fwd.flush(false),
                // The program can SIGSTOP its supervisor (same uid), which then enforces nothing.
                _ = sleep_until(hard_deadline) => break FileEnd::Stuck,
            }
        };
        fwd.flush(true);
        self.phase("run", run_started);
        let status = match &end {
            FileEnd::Status(st) => {
                if let Some(e) = &st.spawn_error {
                    return Err(anyhow!("program could not start: {e}"));
                }
                st.clone()
            }
            _ => ExitStatus {
                wall_ms: run_started.elapsed().as_secs_f64() * 1000.0,
                ..Default::default()
            },
        };
        truncated |= status.output_limit;
        let stderr_text = lossy(&stderr);
        // -XX:+ExitOnOutOfMemoryError prints "Terminating due to java.lang.OutOfMemoryError" (on stdout)
        let java_oom = lang == Language::Java
            && (stderr_text.contains("java.lang.OutOfMemoryError")
                || lossy(&stdout).contains("java.lang.OutOfMemoryError"));
        let memory_message = format!("memory limit exceeded ({} MB)", self.lim.memory_mb);
        let (verdict, message) = if truncated {
            (
                RunVerdict::OutputLimit,
                Some(format!("output limit exceeded ({} bytes per stream)", cap)),
            )
        } else {
            match &end {
                FileEnd::SandboxDied(st) => {
                    let (v, m) = self.broken_sandbox_verdict(st);
                    let v = if v == TestVerdict::MemoryLimit {
                        RunVerdict::MemoryLimit
                    } else {
                        RunVerdict::RuntimeError
                    };
                    (v, Some(m))
                }
                FileEnd::SupervisorLost => (
                    RunVerdict::RuntimeError,
                    Some("the program killed its supervisor".into()),
                ),
                FileEnd::Stuck => (
                    RunVerdict::TimeLimit,
                    Some(format!(
                        "time limit exceeded ({} ms; the program stopped its supervisor)",
                        self.lim.run_ms
                    )),
                ),
                FileEnd::Status(_) if status.timed_out => (
                    RunVerdict::TimeLimit,
                    Some(format!("time limit exceeded ({} ms)", self.lim.run_ms)),
                ),
                FileEnd::Status(_)
                    if status.oom_killed
                        || status.memory_limit
                        || java_oom
                        || (lang != Language::Java
                            && status.max_rss_kb > self.lim.memory_mb * 1024) =>
                {
                    (RunVerdict::MemoryLimit, Some(memory_message))
                }
                FileEnd::Status(_) if status.file_limit => {
                    (RunVerdict::RuntimeError, Some(too_many_files_message()))
                }
                FileEnd::Status(_) if status.signal == Some(24) => (
                    RunVerdict::TimeLimit,
                    Some(format!("time limit exceeded ({} ms)", self.lim.run_ms)),
                ),
                FileEnd::Status(_) if !status.success() => {
                    (RunVerdict::RuntimeError, status.signal.map(signal_message))
                }
                FileEnd::Status(_) => (RunVerdict::Ok, None),
            }
        };
        let file = FileOutcome {
            exit_code: status.exit_code,
            signal: status.signal_name(),
            stdout: lossy(&stdout),
            stderr: stderr_text,
            truncated,
            time_ms: status.wall_ms,
        };
        Ok(Outcome {
            verdict,
            compile,
            file: Some(file),
            tests: vec![],
            message,
        })
    }

    // ------------------------------------------------------------------ tests mode

    async fn run_tests(&mut self, send: &SendFn<'_>) -> Result<Outcome> {
        let job = self.job;
        let lang = job.language;
        let Some(sig) = job.signature.as_ref() else {
            return Ok(Outcome::simple(
                RunVerdict::InternalError,
                "tests mode requires a signature",
            ));
        };
        let prepared = match harness::prepare_tests(lang, &job.source, sig) {
            Ok(p) => p,
            Err(msg) => return Ok(Outcome::simple(RunVerdict::InvalidSubmission, msg)),
        };
        self.compile_cmd = toolchain::compile(lang, JobMode::Tests, &prepared.files[0].0, false);
        self.files = prepared.files.clone();
        let mut compile = match self.provision(send).await? {
            Provisioned::CompileFailed(c) => {
                return Ok(Outcome {
                    verdict: RunVerdict::CompileError,
                    compile: Some(c),
                    file: None,
                    tests: vec![],
                    message: None,
                });
            }
            Provisioned::Ready(c) => c,
        };

        let n = job.tests.len();
        let mut results: Vec<Option<JudgeTestResult>> = vec![None; n];
        // Tests that cannot be sent as they are (unknown method, wrong argument count).
        for (i, t) in job.tests.iter().enumerate() {
            if let Some(msg) = invalid_test(sig, t) {
                results[i] = Some(test_result(
                    t,
                    TestVerdict::RuntimeError,
                    0.0,
                    None,
                    "",
                    "",
                    Some(msg),
                ));
            }
        }
        let nonce_str = nonce();
        let header = harness::driver_header(sig, &prepared.class_ref, &nonce_str);
        let mut driver: Option<Driver> = None;
        // Sandboxes replaced because the program broke one (MAX_SANDBOX_REPLACEMENTS).
        let mut replaced = 0usize;
        // The current test was already retried after its input could not be delivered.
        let mut send_retried = false;
        // A sandbox was already recreated because a driver could not be started.
        let mut start_retried = false;
        let mut pending_out: Vec<u8> = Vec::new();
        let deadline = self.deadline();
        let mut last_progress = Instant::now() - Duration::from_secs(1);
        send(ProgressEvent::Running {
            done: 0,
            total: n as i64,
        });
        let run_started = Instant::now();

        let mut i = 0;
        while i < n {
            let test = &job.tests[i];
            if results[i].is_some() {
                i += 1;
                continue;
            }
            if tokio::time::Instant::now() >= deadline {
                results[i] = Some(test_result(
                    test,
                    TestVerdict::Skipped,
                    0.0,
                    None,
                    "",
                    "",
                    None,
                ));
                i += 1;
                continue;
            }
            if driver.is_none() {
                match self.start_driver(&header, &nonce_str, deadline).await {
                    Ok(Start::Ready(d, pre)) => {
                        pending_out.extend(pre);
                        driver = Some(d);
                    }
                    Ok(Start::CompileError(msg, ms)) => {
                        let mut out = msg;
                        truncate_utf8(&mut out, self.lim.output);
                        compile = Some(CompileOutcome {
                            ok: false,
                            output: out,
                            time_ms: ms,
                        });
                        return Ok(Outcome {
                            verdict: RunVerdict::CompileError,
                            compile,
                            file: None,
                            tests: vec![],
                            message: None,
                        });
                    }
                    Ok(Start::Failed {
                        verdict,
                        message,
                        stdout,
                        stderr,
                    }) => {
                        // The candidate's file fails before any test can run (module-level code,
                        // static initialisers): every remaining test fails the same way.
                        for (j, slot) in results.iter_mut().enumerate().skip(i) {
                            if slot.is_none() {
                                let (o, e) = if j == i {
                                    (lossy(&stdout), lossy(&stderr))
                                } else {
                                    (String::new(), String::new())
                                };
                                *slot = Some(test_result(
                                    &job.tests[j],
                                    verdict,
                                    0.0,
                                    None,
                                    &o,
                                    &e,
                                    Some(message.clone()),
                                ));
                            }
                        }
                        break;
                    }
                    Err(e) => {
                        // Not the program's doing (Docker could not start the exec, or the sandbox
                        // was gone before the driver started): one more sandbox, then give up.
                        tracing::warn!(run_id = %job.run_id, error = format!("{e:#}"), "driver start failed; recreating the sandbox");
                        if start_retried {
                            return Err(e);
                        }
                        start_retried = true;
                        self.reprovision(send).await?;
                        continue;
                    }
                }
            }
            let d = driver.as_mut().expect("driver");
            let mut cap = Capture::new(self.lim.output, std::mem::take(&mut pending_out));
            let sent = Instant::now();
            if let Err(e) = d.exec.send(harness::test_line(test).as_bytes()).await {
                // The supervisor stopped reading (the program can SIGSTOP it) or the sandbox is
                // gone (a background thread of the program, after its last result).
                tracing::warn!(error = %e, "sending a test failed");
                driver = None;
                let st = self.sandbox().wait_stopped(LOSS_WAIT).await?;
                if !st.running {
                    let _ = self.fresh_oom(&st);
                    if !self.replace_sandbox(send, &mut replaced).await? {
                        not_run(&mut results, &job.tests, i);
                        break;
                    }
                }
                if !send_retried {
                    send_retried = true;
                    continue; // a new driver (a new supervisor kills the old one) retries this test
                }
                results[i] = Some(test_result(
                    test,
                    TestVerdict::RuntimeError,
                    0.0,
                    None,
                    "",
                    "",
                    Some("the sandbox stopped responding".into()),
                ));
                send_retried = false;
                i += 1;
                continue;
            }
            send_retried = false;
            let test_deadline = (tokio::time::Instant::now() + self.lim.watchdog()).min(deadline);
            let end = loop {
                tokio::select! {
                    ev = d.next() => match ev {
                        DriverEvent::Out(t) => if !cap.stdout(&t) { break End::Overflow },
                        DriverEvent::Err(t) => if !cap.stderr(&t) { break End::Overflow },
                        DriverEvent::Frame(f) => break End::Frame(f),
                        DriverEvent::Exit(st) => break End::Exit(st),
                        DriverEvent::Lost => break End::Lost,
                    },
                    _ = sleep_until(test_deadline) => break End::Watchdog,
                }
            };
            let elapsed = sent.elapsed().as_secs_f64() * 1000.0;
            let mut restart = false;
            // The program broke the sandbox: the remaining tests need a fresh one.
            let mut broken = false;
            let result = match end {
                End::Frame(Ok(frame)) => {
                    let (r, needs_restart) = self.evaluate_frame(test, sig, frame, &cap);
                    restart = needs_restart;
                    r
                }
                End::Frame(Err(e)) => {
                    restart = true;
                    let msg = if e.contains("too large") {
                        format!(
                            "the return value is too large (over {} MiB as JSON)",
                            MAX_RESULT_FRAME >> 20
                        )
                    } else {
                        format!("unreadable result: {e}")
                    };
                    test_result(
                        test,
                        TestVerdict::RuntimeError,
                        elapsed,
                        None,
                        &cap.out(),
                        &cap.err(),
                        Some(msg),
                    )
                }
                End::Exit(st) => {
                    driver = None;
                    self.oom_seen |= st.oom_killed;
                    let (verdict, msg) = classify_exit(&st, self.lim.memory_mb);
                    let t = if verdict == TestVerdict::TimeLimit {
                        self.lim.run_ms as f64
                    } else {
                        elapsed
                    };
                    test_result(test, verdict, t, None, &cap.out(), &cap.err(), Some(msg))
                }
                End::Lost => {
                    let d = driver.take().expect("driver");
                    let st = self.sandbox().wait_stopped(LOSS_WAIT).await?;
                    let (verdict, msg) = if !st.running {
                        // Under gVisor, exhausting the container's memory (or another host
                        // limit) stops the whole sandbox, not just the program.
                        broken = true;
                        self.broken_sandbox_verdict(&st)
                    } else if let Some(e) = &d.exec.stream_error {
                        return Err(anyhow!("exec stream failed: {e}"));
                    } else {
                        // The program killed its supervisor (same uid).
                        (
                            TestVerdict::RuntimeError,
                            "the program was lost by the sandbox".to_string(),
                        )
                    };
                    test_result(
                        test,
                        verdict,
                        elapsed,
                        None,
                        &cap.out(),
                        &cap.err(),
                        Some(msg),
                    )
                }
                End::Watchdog | End::Overflow => {
                    let d = driver.take().expect("driver");
                    let st = kill_and_drain(d, &mut cap).await;
                    let (mut verdict, mut msg) = if matches!(end, End::Overflow) {
                        (
                            TestVerdict::OutputLimit,
                            format!("output limit exceeded ({} bytes)", self.lim.output),
                        )
                    } else if st.as_ref().is_some_and(|s| s.oom_killed || s.memory_limit) {
                        (
                            TestVerdict::MemoryLimit,
                            format!("memory limit exceeded ({} MB)", self.lim.memory_mb),
                        )
                    } else {
                        (
                            TestVerdict::TimeLimit,
                            format!("time limit exceeded ({} ms)", self.lim.run_ms),
                        )
                    };
                    if let Some(st) = &st {
                        self.oom_seen |= st.oom_killed;
                    } else {
                        // It could not be killed: the sandbox is dead, or wedged (the program
                        // stopped its supervisor). Either way the next test needs a new one.
                        broken = true;
                        let cs = self.sandbox().wait_stopped(LOSS_WAIT).await?;
                        if verdict != TestVerdict::OutputLimit && self.fresh_oom(&cs) {
                            (verdict, msg) = (
                                TestVerdict::MemoryLimit,
                                format!("memory limit exceeded ({} MB)", self.lim.memory_mb),
                            );
                        }
                    }
                    let t = if verdict == TestVerdict::TimeLimit {
                        self.lim.run_ms as f64
                    } else {
                        elapsed
                    };
                    test_result(test, verdict, t, None, &cap.out(), &cap.err(), Some(msg))
                }
            };
            if restart && let Some(d) = driver.take() {
                let mut sink = Capture::new(0, vec![]);
                if kill_and_drain(d, &mut sink).await.is_none() {
                    broken = true;
                }
            }
            results[i] = Some(result);
            i += 1;
            if broken && i < n && !self.replace_sandbox(send, &mut replaced).await? {
                not_run(&mut results, &job.tests, i);
                break;
            }
            if last_progress.elapsed() >= Duration::from_millis(100) || i == n {
                send(ProgressEvent::Running {
                    done: i as i64,
                    total: n as i64,
                });
                last_progress = Instant::now();
            }
        }
        if let Some(mut d) = driver.take() {
            let _ = d.exec.close_input().await;
        }

        self.phase("tests", run_started);
        let tests: Vec<JudgeTestResult> = results
            .into_iter()
            .zip(&job.tests)
            .map(|(r, t)| {
                r.unwrap_or_else(|| test_result(t, TestVerdict::Skipped, 0.0, None, "", "", None))
            })
            .collect();
        let verdict = run_verdict(&tests);
        Ok(Outcome {
            verdict,
            compile,
            file: None,
            tests,
            message: None,
        })
    }

    /// Provisions a fresh sandbox for the remaining tests; recompiling must succeed again.
    async fn reprovision(&mut self, send: &SendFn<'_>) -> Result<()> {
        match self.provision(send).await? {
            Provisioned::Ready(_) => Ok(()),
            Provisioned::CompileFailed(_) => Err(anyhow!("recompiling in a new sandbox failed")),
        }
    }

    /// A fresh sandbox after the program broke the current one. `false`: the job has used up
    /// `MAX_SANDBOX_REPLACEMENTS`. Out of time, nothing is provisioned (the remaining tests are
    /// skipped by the caller).
    async fn replace_sandbox(&mut self, send: &SendFn<'_>, replaced: &mut usize) -> Result<bool> {
        if *replaced >= MAX_SANDBOX_REPLACEMENTS {
            return Ok(false);
        }
        if tokio::time::Instant::now() >= self.deadline() {
            return Ok(true);
        }
        *replaced += 1;
        tracing::info!(run_id = %self.job.run_id, replaced = *replaced, "the program broke its sandbox; continuing in a new one");
        self.reprovision(send).await?;
        Ok(true)
    }

    async fn start_driver(
        &mut self,
        header: &str,
        nonce: &str,
        deadline: tokio::time::Instant,
    ) -> Result<Start> {
        let lang = self.job.language;
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let stack_mb = self.lim.memory_mb.clamp(64, 1024);
        let mut spec = self.program_spec(
            toolchain::run(
                lang,
                JobMode::Tests,
                "",
                self.lim.memory_mb,
                stack_mb.min(512),
            ),
            3,
            remaining.as_millis() as i64 + 5_000,
            if lang == Language::Java { 64 } else { stack_mb },
        );
        spec.max_output = 256 << 20;
        let started = Instant::now();
        let exec = self.sandbox().exec(&spec).await?;
        let mut d = Driver {
            exec,
            parser: FrameParser::new(nonce, MAX_RESULT_FRAME),
            queue: VecDeque::new(),
        };
        d.exec.send(header.as_bytes()).await?;
        let mut cap = Capture::new(self.lim.output, vec![]);
        // Startup (JVM boot, Python import of the candidate's module) gets its own allowance,
        // bounded by the job's total budget.
        let start_deadline = (tokio::time::Instant::now() + Duration::from_secs(20))
            .min(deadline + Duration::from_secs(1));
        loop {
            let ev = tokio::select! {
                ev = d.next() => ev,
                _ = sleep_until(start_deadline) => {
                    let st = kill_and_drain(d, &mut cap).await;
                    let _ = st;
                    return Ok(Start::Failed {
                        verdict: TestVerdict::TimeLimit,
                        message: "the program did not start in time (module-level code or static initialisers)".into(),
                        stdout: cap.stdout,
                        stderr: cap.stderr,
                    });
                }
            };
            match ev {
                DriverEvent::Out(t) => {
                    cap.stdout(&t);
                }
                DriverEvent::Err(t) => {
                    cap.stderr(&t);
                }
                DriverEvent::Frame(Ok(f)) => match f["t"].as_str() {
                    Some("ready") => return Ok(Start::Ready(d, cap.stdout)),
                    Some("compile_error") => {
                        let msg = f["error"].as_str().unwrap_or("syntax error").to_string();
                        return Ok(Start::CompileError(
                            msg,
                            started.elapsed().as_secs_f64() * 1000.0,
                        ));
                    }
                    Some("init_error") => {
                        let mut sink = Capture::new(0, vec![]);
                        let _ = kill_and_drain(d, &mut sink).await;
                        return Ok(Start::Failed {
                            verdict: TestVerdict::RuntimeError,
                            message: f["error"]
                                .as_str()
                                .unwrap_or("initialisation failed")
                                .to_string(),
                            stdout: cap.stdout,
                            stderr: cap.stderr,
                        });
                    }
                    _ => return Err(anyhow!("unexpected frame from the driver at startup: {f}")),
                },
                DriverEvent::Frame(Err(e)) => {
                    return Err(anyhow!("bad frame at driver startup: {e}"));
                }
                DriverEvent::Exit(st) => {
                    if let Some(e) = st.spawn_error {
                        return Err(anyhow!("driver could not start: {e}"));
                    }
                    let (verdict, message) = classify_exit(&st, self.lim.memory_mb);
                    return Ok(Start::Failed {
                        verdict,
                        message,
                        stdout: cap.stdout,
                        stderr: cap.stderr,
                    });
                }
                DriverEvent::Lost => {
                    let st = self.sandbox().wait_stopped(LOSS_WAIT).await?;
                    let (verdict, message) = if !st.running {
                        // Startup (module-level code, static initialisers) took the sandbox down.
                        self.broken_sandbox_verdict(&st)
                    } else if let Some(e) = &d.exec.stream_error {
                        return Err(anyhow!("driver exec stream failed at startup: {e}"));
                    } else {
                        (
                            TestVerdict::RuntimeError,
                            "the program killed its supervisor while starting".to_string(),
                        )
                    };
                    return Ok(Start::Failed {
                        verdict,
                        message,
                        stdout: cap.stdout,
                        stderr: cap.stderr,
                    });
                }
            }
        }
    }

    /// Turns a result frame into a test result; the bool says the driver should be restarted.
    fn evaluate_frame(
        &mut self,
        test: &JudgeTest,
        sig: &ProblemSignature,
        mut f: Value,
        cap: &Capture,
    ) -> (JudgeTestResult, bool) {
        let ms = f["ms"].as_f64().unwrap_or(0.0);
        let (out, err) = (cap.out(), cap.err());
        if f["t"].as_str() != Some("result") {
            return (
                test_result(
                    test,
                    TestVerdict::RuntimeError,
                    ms,
                    None,
                    &out,
                    &err,
                    Some("unexpected output from the test driver".into()),
                ),
                true,
            );
        }
        let over_memory = f["rssKb"]
            .as_i64()
            .is_some_and(|kb| kb > self.lim.memory_mb * 1024);
        if f["ok"].as_bool() != Some(true) {
            let error = f["error"].as_str().unwrap_or("error").to_string();
            return match f["kind"].as_str() {
                Some("memory") => (
                    test_result(
                        test,
                        TestVerdict::MemoryLimit,
                        ms,
                        None,
                        &out,
                        &err,
                        Some(format!("memory limit exceeded: {error}")),
                    ),
                    true,
                ),
                _ if over_memory => (
                    test_result(
                        test,
                        TestVerdict::MemoryLimit,
                        ms,
                        None,
                        &out,
                        &err,
                        Some(format!("memory limit exceeded ({} MB)", self.lim.memory_mb)),
                    ),
                    true,
                ),
                _ => (
                    test_result(
                        test,
                        TestVerdict::RuntimeError,
                        ms,
                        None,
                        &out,
                        &err,
                        Some(error),
                    ),
                    false,
                ),
            };
        }
        let values = match f.get_mut("values").map(Value::take) {
            Some(Value::Array(v)) if v.len() == test.calls.len() => v,
            _ => {
                return (
                    test_result(
                        test,
                        TestVerdict::RuntimeError,
                        ms,
                        None,
                        &out,
                        &err,
                        Some("malformed result from the test driver".into()),
                    ),
                    true,
                );
            }
        };
        let (verdict, message, restart) = if over_memory {
            let msg = format!("memory limit exceeded ({} MB)", self.lim.memory_mb);
            (TestVerdict::MemoryLimit, Some(msg), true)
        } else if ms > self.lim.run_ms as f64 {
            let msg = format!("time limit exceeded ({} ms)", self.lim.run_ms);
            (TestVerdict::TimeLimit, Some(msg), false)
        } else {
            let (v, m) = compare_test(test, sig, &values);
            (v, m, false)
        };
        let (actual, message) = self.keep_actual(values, message);
        (
            test_result(test, verdict, ms, actual, &out, &err, message),
            restart,
        )
    }

    /// Keeps a test's return values in the result while the run's budget lasts.
    fn keep_actual(
        &mut self,
        values: Vec<Value>,
        message: Option<String>,
    ) -> (Option<Vec<Value>>, Option<String>) {
        let size = serde_json::to_string(&values).map_or(usize::MAX, |s| s.len());
        if size <= self.actual_budget {
            self.actual_budget -= size;
            return (Some(values), message);
        }
        let note = format!("the return value ({size} bytes as JSON) is too large to include");
        let message = match message {
            Some(m) => format!("{m}; {note}"),
            None => note,
        };
        (None, Some(message))
    }
}

/// How a file-mode program ended.
enum FileEnd {
    Status(ExitStatus),
    /// The exec stream ended without a status and the container stopped.
    SandboxDied(ContainerState),
    /// The exec stream ended without a status; the container is still running.
    SupervisorLost,
    /// The supervisor stopped responding (the program can SIGSTOP it).
    Stuck,
}

fn too_many_files_message() -> String {
    format!("the program created too many files (the sandbox allows {MAX_FILES})")
}

enum Start {
    /// Ready, with anything the program printed while starting.
    Ready(Driver, Vec<u8>),
    /// Python: the file does not compile.
    CompileError(String, f64),
    Failed {
        verdict: TestVerdict,
        message: String,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
    },
}

enum End {
    Frame(Result<Value, String>),
    Exit(ExitStatus),
    Lost,
    Watchdog,
    Overflow,
}

enum DriverEvent {
    Out(Vec<u8>),
    Err(Vec<u8>),
    Frame(Result<Value, String>),
    Exit(ExitStatus),
    Lost,
}

struct Driver {
    exec: Exec,
    parser: FrameParser,
    queue: VecDeque<DriverEvent>,
}

impl Driver {
    /// Cancel-safe.
    async fn next(&mut self) -> DriverEvent {
        loop {
            if let Some(e) = self.queue.pop_front() {
                return e;
            }
            match self.exec.next().await {
                Some(ExecEvent::Stdout(b)) => {
                    for p in self.parser.push(&b) {
                        self.queue.push_back(match p {
                            Piece::Text(t) => DriverEvent::Out(t),
                            Piece::Frame(f) => DriverEvent::Frame(f),
                        });
                    }
                }
                Some(ExecEvent::Stderr(b)) => self.queue.push_back(DriverEvent::Err(b.to_vec())),
                Some(ExecEvent::Exit(st)) => {
                    let rest = self.parser.finish();
                    if !rest.is_empty() {
                        self.queue.push_back(DriverEvent::Out(rest));
                    }
                    self.queue.push_back(DriverEvent::Exit(st));
                }
                None => return DriverEvent::Lost,
            }
        }
    }
}

/// Kills the driver and collects what it printed until it is gone. None = it did not report an
/// exit within a few seconds (the sandbox is unusable).
async fn kill_and_drain(mut d: Driver, cap: &mut Capture) -> Option<ExitStatus> {
    if d.exec.kill().await.is_err() {
        return None;
    }
    let r = timeout(Duration::from_secs(5), async {
        loop {
            match d.next().await {
                DriverEvent::Out(t) => {
                    cap.stdout(&t);
                }
                DriverEvent::Err(t) => {
                    cap.stderr(&t);
                }
                DriverEvent::Frame(_) => {}
                DriverEvent::Exit(st) => return Some(st),
                DriverEvent::Lost => return None,
            }
        }
    })
    .await;
    r.ok().flatten()
}

/// Per-test captured output, capped at the job's limit.
struct Capture {
    cap: usize,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl Capture {
    fn new(cap: usize, pre: Vec<u8>) -> Self {
        let mut c = Capture {
            cap,
            stdout: Vec::new(),
            stderr: Vec::new(),
        };
        c.stdout(&pre);
        c
    }
    /// false once the cap is exceeded
    fn stdout(&mut self, b: &[u8]) -> bool {
        let over = self.stdout.len() + b.len() > self.cap;
        append_capped(&mut self.stdout, b, self.cap);
        !over
    }
    fn stderr(&mut self, b: &[u8]) -> bool {
        let over = self.stderr.len() + b.len() > self.cap;
        append_capped(&mut self.stderr, b, self.cap);
        !over
    }
    fn out(&self) -> String {
        lossy(&self.stdout)
    }
    fn err(&self) -> String {
        lossy(&self.stderr)
    }
}

fn test_result(
    t: &JudgeTest,
    verdict: TestVerdict,
    time_ms: f64,
    actual: Option<Vec<Value>>,
    stdout: &str,
    stderr: &str,
    message: Option<String>,
) -> JudgeTestResult {
    JudgeTestResult {
        id: t.id.clone(),
        verdict,
        time_ms: (time_ms * 1000.0).round() / 1000.0,
        actual,
        stdout: stdout.to_string(),
        stderr: stderr.to_string(),
        message,
    }
}

fn invalid_test(sig: &ProblemSignature, t: &JudgeTest) -> Option<String> {
    let want_ctor = if sig.kind == ProblemKind::Design {
        sig.ctor_params.len()
    } else {
        0
    };
    if t.ctor_args.len() != want_ctor {
        return Some(format!(
            "the test passes {} constructor argument(s), the class takes {want_ctor}",
            t.ctor_args.len()
        ));
    }
    if t.calls.is_empty() {
        return Some("the test makes no calls".into());
    }
    for (k, c) in t.calls.iter().enumerate() {
        match sig.method(&c.method) {
            None => return Some(format!("call {} uses unknown method `{}`", k + 1, c.method)),
            Some(m) if m.params.len() != c.args.len() => {
                return Some(format!(
                    "call {} ({}) passes {} argument(s), the method takes {}",
                    k + 1,
                    c.method,
                    c.args.len(),
                    m.params.len()
                ));
            }
            _ => {}
        }
    }
    None
}

fn short_json(v: &Value) -> String {
    let mut s = v.to_string();
    if s.len() > 200 {
        let mut cut = 200;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
        s.push('…');
    }
    s
}

fn compare_test(
    t: &JudgeTest,
    sig: &ProblemSignature,
    values: &[Value],
) -> (TestVerdict, Option<String>) {
    let Some(expected) = &t.expected else {
        return (TestVerdict::Ran, None);
    };
    for (k, call) in t.calls.iter().enumerate() {
        let mode = sig
            .method(&call.method)
            .map(|m| m.compare)
            .unwrap_or_default();
        let exp = expected.get(k).unwrap_or(&Value::Null);
        if !results_equal(&values[k], exp, mode) {
            return (
                TestVerdict::Fail,
                Some(format!(
                    "call {} ({}): expected {}, got {}",
                    k + 1,
                    call.method,
                    short_json(exp),
                    short_json(&values[k])
                )),
            );
        }
    }
    (TestVerdict::Pass, None)
}

fn signal_message(sig: i32) -> String {
    let name = ipp_judge_sandbox::ExitStatus {
        signal: Some(sig),
        ..Default::default()
    }
    .signal_name()
    .unwrap_or_default();
    let hint = match sig {
        11 => " (invalid memory access or stack overflow)",
        6 => " (abort: failed assertion, uncaught exception or out-of-range access)",
        8 => " (arithmetic error, e.g. division by zero)",
        7 => " (bus error)",
        25 => " (file size limit exceeded)",
        24 => " (CPU time limit exceeded)",
        _ => "",
    };
    format!("terminated by {name}{hint}")
}

/// Marks every test from `from` on that has no result as not run (the program broke its
/// sandbox `MAX_SANDBOX_REPLACEMENTS + 1` times).
fn not_run(results: &mut [Option<JudgeTestResult>], tests: &[JudgeTest], from: usize) {
    let msg = format!(
        "not run: the program broke its sandbox {} times, so the remaining tests were not run",
        MAX_SANDBOX_REPLACEMENTS + 1
    );
    for (slot, t) in results.iter_mut().zip(tests).skip(from) {
        if slot.is_none() {
            *slot = Some(test_result(
                t,
                TestVerdict::RuntimeError,
                0.0,
                None,
                "",
                "",
                Some(msg.clone()),
            ));
        }
    }
}

fn classify_exit(st: &ExitStatus, memory_mb: i64) -> (TestVerdict, String) {
    if st.oom_killed
        || st.memory_limit
        || (st.signal == Some(9) && st.max_rss_kb > memory_mb * 1024)
    {
        return (
            TestVerdict::MemoryLimit,
            format!("memory limit exceeded ({memory_mb} MB)"),
        );
    }
    if st.timed_out || st.signal == Some(24) {
        return (TestVerdict::TimeLimit, "time limit exceeded".into());
    }
    if st.output_limit {
        return (TestVerdict::OutputLimit, "output limit exceeded".into());
    }
    if st.file_limit {
        return (TestVerdict::RuntimeError, too_many_files_message());
    }
    if let Some(sig) = st.signal {
        return (TestVerdict::RuntimeError, signal_message(sig));
    }
    (
        TestVerdict::RuntimeError,
        format!(
            "the program exited with code {} while running this test",
            st.exit_code.unwrap_or(-1)
        ),
    )
}

fn run_verdict(tests: &[JudgeTestResult]) -> RunVerdict {
    for t in tests {
        let v = match t.verdict {
            TestVerdict::Pass | TestVerdict::Ran => continue,
            TestVerdict::Fail => RunVerdict::WrongAnswer,
            TestVerdict::RuntimeError => RunVerdict::RuntimeError,
            TestVerdict::TimeLimit | TestVerdict::Skipped => RunVerdict::TimeLimit,
            TestVerdict::MemoryLimit => RunVerdict::MemoryLimit,
            TestVerdict::OutputLimit => RunVerdict::OutputLimit,
        };
        return v;
    }
    if tests.iter().any(|t| t.verdict == TestVerdict::Pass) {
        RunVerdict::Accepted
    } else {
        RunVerdict::Ok
    }
}

fn truncate_utf8(s: &mut String, max: usize) {
    if s.len() > max {
        let mut cut = max;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
        s.push_str("\n[output truncated]\n");
    }
}

/// Coalesces file-mode output into progress chunks (at most every 50 ms or 8 KiB), never splitting
/// a UTF-8 character.
struct Forwarder<'a> {
    send: &'a SendFn<'a>,
    pending: [(OutputStream, Vec<u8>); 2],
    since: Option<Instant>,
}

impl<'a> Forwarder<'a> {
    fn new(send: &'a SendFn<'a>) -> Self {
        Forwarder {
            send,
            pending: [
                (OutputStream::Stdout, vec![]),
                (OutputStream::Stderr, vec![]),
            ],
            since: None,
        }
    }
    fn push(&mut self, stream: OutputStream, b: &[u8]) {
        if b.is_empty() {
            return;
        }
        let idx = if stream == OutputStream::Stdout { 0 } else { 1 };
        self.pending[idx].1.extend_from_slice(b);
        self.since.get_or_insert_with(Instant::now);
        if self.pending[idx].1.len() >= 8192 {
            self.flush(false);
        }
    }
    fn flush(&mut self, all: bool) {
        let due = all
            || self
                .since
                .is_some_and(|t| t.elapsed() >= Duration::from_millis(50))
            || self.pending.iter().any(|p| p.1.len() >= 8192);
        if !due {
            return;
        }
        for (stream, buf) in &mut self.pending {
            let n = if all {
                buf.len()
            } else {
                complete_utf8_len(buf)
            };
            if n == 0 {
                continue;
            }
            let chunk: Vec<u8> = buf.drain(..n).collect();
            (self.send)(ProgressEvent::Output {
                stream: *stream,
                chunk: lossy(&chunk),
            });
        }
        self.since = if self.pending.iter().any(|p| !p.1.is_empty()) {
            Some(Instant::now())
        } else {
            None
        };
    }
}

/// Length of the prefix that does not end inside a multi-byte UTF-8 sequence.
fn complete_utf8_len(b: &[u8]) -> usize {
    let n = b.len();
    for back in 1..=3.min(n) {
        let c = b[n - back];
        if c & 0xC0 == 0x80 {
            continue; // continuation byte; keep looking for the lead byte
        }
        let need = if c >= 0xF0 {
            4
        } else if c >= 0xE0 {
            3
        } else if c >= 0xC0 {
            2
        } else {
            1
        };
        return if need > back { n - back } else { n };
    }
    n
}

pub fn parse_job(payload: &[u8]) -> Result<JudgeJob> {
    serde_json::from_slice(payload).context("invalid JudgeJob payload")
}

/// The `runId` of a payload that is not a valid job, so it can still be answered with an
/// `internal_error` instead of being dropped (the API would wait for its watchdog). Parsing into a
/// `Value` fails on anything nested deeper than serde_json's recursion limit (128), e.g. a custom
/// test argument; skipping the other fields does not recurse.
pub fn run_id_of(payload: &[u8]) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct RunIdOnly {
        #[serde(rename = "runId")]
        run_id: String,
    }
    serde_json::from_slice::<RunIdOnly>(payload)
        .ok()
        .map(|r| r.run_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_id_of_deeply_nested_payload() {
        let deep = format!("{}1{}", "[".repeat(300), "]".repeat(300));
        let payload =
            format!(r#"{{"v":1,"tests":[{{"calls":[{{"args":[{deep}]}}]}}],"runId":"r-1"}}"#);
        assert!(parse_job(payload.as_bytes()).is_err());
        assert_eq!(run_id_of(payload.as_bytes()).as_deref(), Some("r-1"));
        assert_eq!(run_id_of(b"not json"), None);
    }

    #[test]
    fn utf8_boundaries() {
        assert_eq!(complete_utf8_len(b"abc"), 3);
        let e = "é".as_bytes();
        assert_eq!(complete_utf8_len(&[b'a', e[0]]), 1);
        assert_eq!(complete_utf8_len(&[b'a', e[0], e[1]]), 3);
        let s = "😀".as_bytes();
        assert_eq!(complete_utf8_len(&s[..3]), 0);
        assert_eq!(complete_utf8_len(s), 4);
    }

    #[test]
    fn verdict_is_first_failure() {
        let t = |id: &str, v| JudgeTestResult {
            id: id.into(),
            verdict: v,
            time_ms: 0.0,
            actual: None,
            stdout: String::new(),
            stderr: String::new(),
            message: None,
        };
        assert_eq!(
            run_verdict(&[t("a", TestVerdict::Pass), t("b", TestVerdict::Pass)]),
            RunVerdict::Accepted
        );
        assert_eq!(run_verdict(&[t("a", TestVerdict::Ran)]), RunVerdict::Ok);
        assert_eq!(
            run_verdict(&[t("a", TestVerdict::Pass), t("c", TestVerdict::Ran)]),
            RunVerdict::Accepted
        );
        assert_eq!(
            run_verdict(&[
                t("a", TestVerdict::Fail),
                t("b", TestVerdict::TimeLimit),
                t("c", TestVerdict::RuntimeError)
            ]),
            RunVerdict::WrongAnswer
        );
        assert_eq!(
            run_verdict(&[t("a", TestVerdict::Pass), t("b", TestVerdict::Skipped)]),
            RunVerdict::TimeLimit
        );
    }

    #[test]
    fn exit_classification() {
        let st = |f: fn(&mut ExitStatus)| {
            let mut s = ExitStatus::default();
            f(&mut s);
            s
        };
        assert_eq!(
            classify_exit(&st(|s| s.oom_killed = true), 256).0,
            TestVerdict::MemoryLimit
        );
        assert_eq!(
            classify_exit(&st(|s| s.signal = Some(11)), 256).0,
            TestVerdict::RuntimeError
        );
        assert!(
            classify_exit(&st(|s| s.signal = Some(25)), 256)
                .1
                .contains("SIGXFSZ")
        );
        assert_eq!(
            classify_exit(&st(|s| s.signal = Some(24)), 256).0,
            TestVerdict::TimeLimit
        );
        assert_eq!(
            classify_exit(&st(|s| s.exit_code = Some(3)), 256).0,
            TestVerdict::RuntimeError
        );
    }
}
