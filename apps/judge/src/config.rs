//! Configuration from the environment (the repo-root `.env` is loaded first, like every app).

use anyhow::{Result, bail};
use ipp_judge_contracts::{Language, keys};
use std::time::Duration;

pub const DEFAULT_IMAGE_VERSION: &str = "1";

#[derive(Debug, Clone)]
pub struct Images {
    pub cpp: String,
    pub python: String,
    pub java: String,
}

impl Images {
    pub fn get(&self, l: Language) -> &str {
        match l {
            Language::Cpp => &self.cpp,
            Language::Python => &self.python,
            Language::Java => &self.java,
        }
    }
    pub fn all(&self) -> [&str; 3] {
        [&self.cpp, &self.python, &self.java]
    }
}

#[derive(Debug, Clone)]
pub struct Keys {
    pub jobs_stream: String,
    pub jobs_group: String,
    pub results_stream: String,
    pub progress_channel: String,
}

impl Default for Keys {
    fn default() -> Self {
        Keys {
            jobs_stream: keys::JOBS_STREAM.into(),
            jobs_group: keys::JOBS_GROUP.into(),
            results_stream: keys::RESULTS_STREAM.into(),
            progress_channel: keys::PROGRESS_CHANNEL.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub redis_url: String,
    pub concurrency: usize,
    pub runtime: String,
    pub allow_insecure_runtime: bool,
    pub images: Images,
    pub keys: Keys,
    pub consumer: String,
    /// A pending job idle this long (its judge stopped heartbeating) is reclaimed.
    pub reclaim_idle: Duration,
    pub reclaim_interval: Duration,
    pub heartbeat_interval: Duration,
    pub shutdown_grace: Duration,
    /// Approximate cap on the results stream length (MAXLEN ~).
    pub results_maxlen: usize,
    pub workdir_mb: i64,
    pub cpus: f64,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn parse<T: std::str::FromStr>(name: &str, default: T) -> Result<T> {
    match var(name) {
        None => Ok(default),
        Some(v) => v
            .trim()
            .parse()
            .map_err(|_| anyhow::anyhow!("{name}: cannot parse {v:?}")),
    }
}

fn flag(name: &str) -> bool {
    matches!(
        var(name).as_deref().map(str::trim),
        Some("1" | "true" | "yes")
    )
}

impl Config {
    /// Loads `.env` (searching upwards from the working directory) without overriding variables
    /// already set, then reads the environment.
    pub fn from_env() -> Result<Config> {
        let _ = dotenvy::dotenv();
        let production = var("NODE_ENV").as_deref() == Some("production");
        if production {
            for required in ["REDIS_URL", "SANDBOX_RUNTIME"] {
                if var(required).is_none() {
                    bail!("{required} must be set when NODE_ENV=production");
                }
            }
        }
        let image = |lang: &str| {
            var(&format!("JUDGE_IMAGE_{}", lang.to_uppercase()))
                .unwrap_or_else(|| format!("ipp-sandbox-{lang}:{DEFAULT_IMAGE_VERSION}"))
        };
        let defaults = Keys::default();
        let hostname = var("HOSTNAME")
            .or_else(|| {
                std::fs::read_to_string("/etc/hostname")
                    .ok()
                    .map(|s| s.trim().to_string())
            })
            .unwrap_or_else(|| "judge".into());
        let concurrency: usize = parse("JUDGE_CONCURRENCY", 2)?;
        if concurrency == 0 {
            bail!("JUDGE_CONCURRENCY must be at least 1");
        }
        Ok(Config {
            redis_url: var("REDIS_URL").unwrap_or_else(|| "redis://127.0.0.1:6379".into()),
            concurrency,
            runtime: var("SANDBOX_RUNTIME").unwrap_or_else(|| "runsc".into()),
            allow_insecure_runtime: flag("JUDGE_ALLOW_INSECURE_RUNTIME"),
            images: Images {
                cpp: image("cpp"),
                python: image("python"),
                java: image("java"),
            },
            keys: Keys {
                jobs_stream: var("JUDGE_JOBS_STREAM").unwrap_or(defaults.jobs_stream),
                jobs_group: var("JUDGE_JOBS_GROUP").unwrap_or(defaults.jobs_group),
                results_stream: var("JUDGE_RESULTS_STREAM").unwrap_or(defaults.results_stream),
                progress_channel: var("JUDGE_PROGRESS_CHANNEL")
                    .unwrap_or(defaults.progress_channel),
            },
            consumer: var("JUDGE_CONSUMER").unwrap_or_else(|| format!("judge-{hostname}")),
            reclaim_idle: Duration::from_millis(parse("JUDGE_RECLAIM_IDLE_MS", 60_000)?),
            reclaim_interval: Duration::from_millis(parse("JUDGE_RECLAIM_INTERVAL_MS", 15_000)?),
            heartbeat_interval: Duration::from_millis(parse("JUDGE_HEARTBEAT_MS", 10_000)?),
            shutdown_grace: Duration::from_millis(parse("JUDGE_SHUTDOWN_GRACE_MS", 120_000)?),
            results_maxlen: parse("JUDGE_RESULTS_MAXLEN", 100_000)?,
            workdir_mb: parse("JUDGE_WORKDIR_MB", 64)?,
            cpus: parse("JUDGE_SANDBOX_CPUS", 1.0)?,
        })
    }

    pub fn check_runtime(&self) -> Result<()> {
        check_runtime(&self.runtime, self.allow_insecure_runtime)
    }

    pub fn insecure(&self) -> bool {
        self.runtime != "runsc"
    }
}

/// gVisor is the security boundary. Anything else is refused unless explicitly allowed.
pub fn check_runtime(runtime: &str, allow_insecure: bool) -> Result<()> {
    {
        if runtime == "runsc" {
            return Ok(());
        }
        if !allow_insecure {
            bail!(
                "refusing to start: SANDBOX_RUNTIME={:?} is not gVisor (runsc). Untrusted code would run directly \
                 on the host kernel. Install runsc (apps/judge/README.md) or, for local development only, set \
                 JUDGE_ALLOW_INSECURE_RUNTIME=1",
                runtime
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::check_runtime;

    #[test]
    fn insecure_runtimes_need_the_flag() {
        assert!(check_runtime("runsc", false).is_ok());
        assert!(
            check_runtime("runc", false)
                .unwrap_err()
                .to_string()
                .contains("refusing to start")
        );
        assert!(check_runtime("io.containerd.runc.v2", false).is_err());
        assert!(check_runtime("runc", true).is_ok());
    }
}
