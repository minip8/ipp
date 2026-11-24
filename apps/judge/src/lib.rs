//! interview++ judge: consumes `JudgeJob`s from Redis, runs them in hardened per-job sandboxes and
//! writes `JudgeResult`s. See apps/judge/README.md.

pub mod config;
pub mod runner;
pub mod worker;

use anyhow::Result;
use config::Config;
use ipp_judge_sandbox::SandboxSettings;
use runner::Judge;

/// Connects to Docker and checks the runtime and images.
pub async fn build_judge(cfg: &Config) -> Result<Judge> {
    cfg.check_runtime()?;
    if cfg.insecure() {
        tracing::warn!(
            runtime = %cfg.runtime,
            "!!! INSECURE SANDBOX RUNTIME: untrusted code runs directly on the host kernel (no gVisor). \
             JUDGE_ALLOW_INSECURE_RUNTIME=1 is for local development only; never expose this judge to real users. !!!"
        );
    }
    let docker = ipp_judge_sandbox::connect()?;
    ipp_judge_sandbox::check_environment(&docker, &cfg.runtime, &cfg.images.all()).await?;
    Ok(Judge {
        docker,
        settings: SandboxSettings {
            runtime: cfg.runtime.clone(),
            workdir_mb: cfg.workdir_mb,
            cpus: cfg.cpus,
            consumer: cfg.consumer.clone(),
        },
        images: cfg.images.clone(),
    })
}
