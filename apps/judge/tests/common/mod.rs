//! Helpers for the integration tests, which run real jobs in real sandbox containers.
//!
//! Requirements: a Docker daemon and the images from `infra/sandbox/build.sh`. The runtime is
//! `SANDBOX_RUNTIME` (default `runc` here, with JUDGE_ALLOW_INSECURE_RUNTIME implied for tests).
//! Set IPP_JUDGE_SKIP_SANDBOX_TESTS=1 to skip them on machines without Docker.
#![allow(dead_code)]

use ipp_judge::config::{Config, Images};
use ipp_judge::runner::{Judge, NoProgress};
use ipp_judge_contracts::*;
use ipp_judge_sandbox::SandboxSettings;
use serde_json::{Value, json};
use std::path::PathBuf;
use tokio::sync::{Semaphore, SemaphorePermit};

/// Jobs running at once across all tests (each holds a container; the machine is small).
static SLOTS: Semaphore = Semaphore::const_new(3);

pub fn skip() -> bool {
    std::env::var("IPP_JUDGE_SKIP_SANDBOX_TESTS").is_ok_and(|v| v == "1")
}

pub fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn images() -> Images {
    let img = |l: &str| {
        std::env::var(format!("JUDGE_IMAGE_{}", l.to_uppercase()))
            .unwrap_or(format!("ipp-sandbox-{l}:1"))
    };
    Images {
        cpp: img("cpp"),
        python: img("python"),
        java: img("java"),
    }
}

pub fn runtime() -> String {
    std::env::var("SANDBOX_RUNTIME").unwrap_or_else(|_| "runc".into())
}

/// The suite runs under gVisor (`SANDBOX_RUNTIME=runsc`). Tests branch on this only where the
/// two runtimes legitimately differ, and say why.
pub fn gvisor() -> bool {
    runtime().starts_with("runsc")
}

pub fn message(t: &JudgeTestResult) -> &str {
    t.message.as_deref().unwrap_or("")
}

pub async fn judge() -> Judge {
    let docker = ipp_judge_sandbox::connect().expect("docker");
    let images = images();
    ipp_judge_sandbox::check_environment(&docker, &runtime(), &images.all())
        .await
        .expect("sandbox images missing: run infra/sandbox/build.sh (or set IPP_JUDGE_SKIP_SANDBOX_TESTS=1)");
    Judge {
        docker,
        settings: SandboxSettings {
            runtime: runtime(),
            workdir_mb: 64,
            cpus: 1.0,
            consumer: "judge-integration-tests".into(),
        },
        images,
    }
}

pub fn config_for_tests(prefix: &str) -> Config {
    // SAFETY-free: build from env defaults, then override keys.
    let mut c = Config::from_env().expect("config");
    c.runtime = runtime();
    c.allow_insecure_runtime = true;
    c.keys.jobs_stream = format!("{prefix}:jobs");
    c.keys.jobs_group = format!("{prefix}-judge");
    c.keys.results_stream = format!("{prefix}:results");
    c.keys.progress_channel = format!("{prefix}:progress");
    c.consumer = format!("{prefix}-consumer");
    c
}

pub async fn run(job: &JudgeJob) -> JudgeResult {
    let _slot: SemaphorePermit = SLOTS.acquire().await.unwrap();
    let j = judge().await;
    j.run(job, &NoProgress).await
}

pub fn sig(v: Value) -> ProblemSignature {
    serde_json::from_value(v).expect("signature")
}

pub fn two_sum_sig() -> ProblemSignature {
    sig(
        json!({"className":"Solution","kind":"function","methods":[{"name":"twoSum",
        "params":[{"name":"nums","type":{"array":"int"}},{"name":"target","type":"int"}],
        "returns":{"array":"int"},"compare":"unordered"}]}),
    )
}

pub fn test(id: &str, ctor: Value, calls: &[(&str, Value)], expected: Option<Value>) -> JudgeTest {
    JudgeTest {
        id: id.into(),
        ctor_args: serde_json::from_value(ctor).unwrap(),
        calls: calls
            .iter()
            .map(|(m, a)| Call {
                method: m.to_string(),
                args: serde_json::from_value(a.clone()).unwrap(),
            })
            .collect(),
        expected: expected.map(|e| serde_json::from_value(e).unwrap()),
    }
}

/// A single-call test of a function problem.
pub fn call1(id: &str, method: &str, args: Value, expected: Value) -> JudgeTest {
    test(id, json!([]), &[(method, args)], Some(json!([expected])))
}

pub fn tests_job(
    lang: Language,
    source: &str,
    sig: ProblemSignature,
    tests: Vec<JudgeTest>,
) -> JudgeJob {
    tests_job_limits(
        lang,
        source,
        sig,
        tests,
        ProblemLimits {
            time_ms: 1000,
            memory_mb: 256,
        },
    )
}

pub fn tests_job_limits(
    lang: Language,
    source: &str,
    sig: ProblemSignature,
    tests: Vec<JudgeTest>,
    p: ProblemLimits,
) -> JudgeJob {
    JudgeJob {
        v: Version,
        run_id: uuid::Uuid::new_v4().to_string(),
        language: lang,
        source: source.into(),
        mode: JobMode::Tests,
        stdin: String::new(),
        signature: Some(sig),
        tests,
        limits: limits_for_tests(lang, p),
        enqueued_at: chrono_now(),
    }
}

pub fn file_job(lang: Language, source: &str, stdin: &str) -> JudgeJob {
    JudgeJob {
        v: Version,
        run_id: uuid::Uuid::new_v4().to_string(),
        language: lang,
        source: source.into(),
        mode: JobMode::File,
        stdin: stdin.into(),
        signature: None,
        tests: vec![],
        limits: limits_for_file(lang),
        enqueued_at: chrono_now(),
    }
}

pub fn chrono_now() -> String {
    // RFC 3339 without pulling chrono into the test crate's direct deps.
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let secs = d.as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    // civil-from-days (Howard Hinnant)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let dd = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{dd:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        d.subsec_millis()
    )
}

pub fn dump(r: &JudgeResult) -> String {
    serde_json::to_string_pretty(r).unwrap()
}

pub fn verdicts(r: &JudgeResult) -> Vec<TestVerdict> {
    r.tests.iter().map(|t| t.verdict).collect()
}

#[macro_export]
macro_rules! check {
    ($r:expr, $cond:expr) => {
        assert!(
            $cond,
            "condition `{}` failed for result:\n{}",
            stringify!($cond),
            common::dump(&$r)
        );
    };
}
