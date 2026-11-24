//! `judge` binary.
//!
//!   judge [serve]                       consume jobs from Redis until SIGTERM/SIGINT
//!   judge run-job <job.json> [--progress]
//!                                       run one JudgeJob locally and print the JudgeResult
//!   judge run-problem <problem.json> [--lang cpp,python,java] [--tests tests.json]
//!                                       run a problem's reference solutions against its tests
//!   judge check                         check the runtime and sandbox images, then exit

use anyhow::{Context, Result, bail};
use ipp_judge::config::Config;
use ipp_judge::runner::{Judge, NoProgress, Progress};
use ipp_judge::{build_judge, worker};
use ipp_judge_contracts::*;
use std::sync::Arc;
use std::time::Duration;

struct StderrProgress;
impl Progress for StderrProgress {
    fn send(&self, p: JudgeProgress) {
        eprintln!(
            "progress: {}",
            serde_json::to_string(&p.event).unwrap_or_default()
        );
    }
}

fn usage() -> ! {
    eprintln!(
        "usage:\n  judge [serve]\n  judge run-job <job.json> [--progress]\n  \
         judge run-problem <problem.json> [--lang cpp,python,java] [--tests tests.json]\n  judge check"
    );
    std::process::exit(2)
}

fn init_logging() {
    use tracing_subscriber::{EnvFilter, fmt};
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,bollard=warn"));
    let json = std::env::var("LOG_FORMAT").is_ok_and(|v| v == "json");
    let b = fmt().with_env_filter(filter).with_writer(std::io::stderr);
    if json { b.json().init() } else { b.init() }
}

#[tokio::main]
async fn main() {
    init_logging();
    if let Err(e) = real_main().await {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}

async fn real_main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cfg = Config::from_env()?;
    match args.first().map(String::as_str) {
        None | Some("serve") => serve(cfg).await,
        Some("run-job") => {
            let path = args.get(1).unwrap_or_else(|| usage());
            let progress = args.iter().any(|a| a == "--progress");
            let judge = build_judge(&cfg).await?;
            let text = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
            let job: JudgeJob = serde_json::from_str(&text)
                .with_context(|| format!("{path} is not a valid JudgeJob"))?;
            let result = if progress {
                judge.run(&job, &StderrProgress).await
            } else {
                judge.run(&job, &NoProgress).await
            };
            println!("{}", serde_json::to_string_pretty(&result)?);
            Ok(())
        }
        Some("run-problem") => {
            let path = args.get(1).unwrap_or_else(|| usage());
            let opt = |name: &str| {
                args.iter()
                    .position(|a| a == name)
                    .and_then(|i| args.get(i + 1))
                    .cloned()
            };
            let langs: Vec<Language> = match opt("--lang") {
                Some(l) => l
                    .split(',')
                    .map(|x| x.parse().map_err(anyhow::Error::msg))
                    .collect::<Result<_>>()?,
                None => Language::ALL.to_vec(),
            };
            let judge = build_judge(&cfg).await?;
            run_problem(&judge, path, opt("--tests").as_deref(), &langs).await
        }
        Some("check") => {
            build_judge(&cfg).await?;
            println!(
                "ok: runtime {} and images {:?} are usable",
                cfg.runtime,
                cfg.images.all()
            );
            Ok(())
        }
        _ => usage(),
    }
}

async fn serve(cfg: Config) -> Result<()> {
    let judge = Arc::new(build_judge(&cfg).await?);
    match ipp_judge_sandbox::sweep(&judge.docker, &cfg.consumer, Duration::from_secs(900)).await {
        Ok(n) if n > 0 => tracing::info!(removed = n, "removed leftover sandbox containers"),
        Ok(_) => {}
        Err(e) => tracing::warn!(error = %e, "container sweep failed"),
    }
    let w = Arc::new(worker::Worker::new(cfg.clone(), judge.clone()).await?);
    let (tx, rx) = tokio::sync::watch::channel(false);
    tokio::spawn(async move {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
        tracing::info!("shutdown requested");
        let _ = tx.send(true);
    });
    // Periodically remove containers orphaned by crashed judges on this host.
    let docker = judge.docker.clone();
    let consumer = format!("{}-unused-sweeper", cfg.consumer);
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(300));
        loop {
            tick.tick().await;
            let _ = ipp_judge_sandbox::sweep(&docker, &consumer, Duration::from_secs(900)).await;
        }
    });
    w.run(rx).await?;
    tracing::info!("judge stopped");
    Ok(())
}

/// Runs every reference solution of a problem (ProblemContent JSON) against all its tests.
async fn run_problem(
    judge: &Judge,
    path: &str,
    tests_path: Option<&str>,
    langs: &[Language],
) -> Result<()> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
    let mut problem: ProblemContent = serde_json::from_str(&text)
        .with_context(|| format!("{path} is not ProblemContent JSON"))?;
    if let Some(tp) = tests_path {
        problem.tests = serde_json::from_str(&std::fs::read_to_string(tp)?)
            .with_context(|| format!("{tp}: tests"))?;
    }
    let mut failed = false;
    for &lang in langs {
        let Some(source) = problem.reference_solutions.get(&lang) else {
            println!("{:<7} (no reference solution)", lang.as_str());
            continue;
        };
        let job = JudgeJob {
            v: Version,
            run_id: format!("00000000-0000-4000-8000-{:012x}", std::process::id()),
            language: lang,
            source: source.clone(),
            mode: JobMode::Tests,
            stdin: String::new(),
            signature: Some(problem.signature.clone()),
            tests: problem
                .tests
                .iter()
                .map(|t| JudgeTest {
                    id: t.id.clone(),
                    ctor_args: t.ctor_args.clone(),
                    calls: t.calls.clone(),
                    expected: Some(t.expected.clone()),
                })
                .collect(),
            limits: limits_for_tests(lang, problem.limits),
            enqueued_at: chrono::Utc::now().to_rfc3339(),
        };
        let r = judge.run(&job, &NoProgress).await;
        let passed = r
            .tests
            .iter()
            .filter(|t| t.verdict == TestVerdict::Pass)
            .count();
        println!(
            "{:<7} {:<18} {passed}/{} tests  {:.0} ms",
            lang.as_str(),
            format!("{:?}", r.verdict),
            r.tests.len(),
            r.timing.total_ms
        );
        if r.verdict != RunVerdict::Accepted {
            failed = true;
            if let Some(c) = r.compile.as_ref().filter(|c| !c.ok) {
                println!("{}", c.output);
            }
            if let Some(m) = &r.message {
                println!("  {m}");
            }
            for t in r.tests.iter().filter(|t| t.verdict != TestVerdict::Pass) {
                println!(
                    "  {} {:?}: {}",
                    t.id,
                    t.verdict,
                    t.message.as_deref().unwrap_or("")
                );
            }
        }
    }
    if failed {
        bail!("some reference solutions were not accepted");
    }
    Ok(())
}
