//! One hardened, throwaway Docker container per job, driven through the in-sandbox supervisor
//! `ipp-run` (`infra/sandbox/common/ipp-run.c`).
//!
//! The container itself only runs `ipp-run --idle` as PID 1. Every step (unpacking files,
//! compiling, running) is a `docker exec` of `ipp-run [limits] -- program`, which talks a framed
//! protocol on its stdin/stdout so that the judge can feed input, receive stdout/stderr
//! separately, kill the program, and get an exit status with resource usage — without anything
//! secret ever being written into the container.

mod protocol;

pub use bollard::Docker;
pub use protocol::{ExitStatus, signal_name};

use anyhow::{Context, Result, anyhow, bail};
use bollard::container::LogOutput;
use bollard::exec::{CreateExecOptions, StartExecOptions, StartExecResults};
use bollard::models::{ContainerCreateBody, HostConfig, HostConfigLogConfig, ResourcesUlimits};
use bollard::query_parameters::{
    CreateContainerOptions, InspectContainerOptions, ListContainersOptions, RemoveContainerOptions,
};
use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use std::collections::{HashMap, VecDeque};
use std::pin::Pin;
use std::time::Duration;
use tokio::io::{AsyncWrite, AsyncWriteExt};

/// uid:gid every sandboxed process runs as (created in the images; no privileges anywhere).
pub const SANDBOX_USER: &str = "10001:10001";
pub const SUPERVISOR: &str = "/opt/ipp/ipp-run";
pub const WORKDIR: &str = "/work";
/// Image label that must match, so a judge never runs against images with another driver protocol.
pub const PROTOCOL_LABEL: &str = "ipp.sandbox.protocol";
pub const PROTOCOL_VERSION: &str = "1";
pub const LABEL_JUDGE: &str = "ipp.judge";
pub const LABEL_CONSUMER: &str = "ipp.judge.consumer";
pub const LABEL_RUN: &str = "ipp.run";
/// Inode caps of the writable tmpfs mounts. Linux (runc) enforces them (ENOSPC); gVisor ignores
/// `nr_inodes`, so the supervisor enforces their sum (`ExecSpec::max_files`). Without a cap, empty
/// files cost gVisor ~1.2 KiB of its own memory each (200k files: 250 MB) with no size limit.
pub const WORK_INODES: i64 = 8192;
pub const SHM_INODES: i64 = 64;
pub const MAX_FILES: i64 = WORK_INODES + SHM_INODES;
/// Under gVisor the host cgroup's pids limit counts the sandbox kernel's own threads and the
/// host processes behind every application process (~26 idle, ~3.7 per busy application
/// process), and the sandbox kernel dies when it cannot create a thread. So the host limit is
/// generous and the program's task limit is RLIMIT_NPROC inside the sandbox instead
/// (`ExecSpec::nproc`), which gVisor enforces per sandbox. Measured: 128 forking processes take
/// ~480 host pids.
pub const GVISOR_HOST_PIDS: i64 = 1024;
/// Extra container memory under gVisor for the sandbox kernel itself (~10 MB idle, ~60-100 MB
/// with a hundred processes), which the host cgroup counts.
pub const GVISOR_OVERHEAD_MB: i64 = 64;

/// Settings shared by every container this judge creates.
#[derive(Debug, Clone)]
pub struct SandboxSettings {
    /// OCI runtime: `runsc` (gVisor) in production.
    pub runtime: String,
    /// Size of the tmpfs work directory (also counts against the container's memory).
    pub workdir_mb: i64,
    pub cpus: f64,
    /// Identifies this judge's containers, for cleanup after a crash.
    pub consumer: String,
}

impl SandboxSettings {
    /// gVisor: a user-space kernel per sandbox. Some limits work differently there (see the
    /// judge's README, "gVisor").
    pub fn gvisor(&self) -> bool {
        self.runtime.starts_with("runsc")
    }
}

/// Per-container settings.
#[derive(Debug, Clone)]
pub struct ContainerSpec {
    pub image: String,
    /// cgroup memory (= memory + swap) of the whole container.
    pub memory_mb: i64,
    /// cgroup pids limit of the whole container (under gVisor this also counts the sandbox
    /// kernel's own threads).
    pub pids: i64,
    pub run_id: String,
}

pub struct Sandbox {
    docker: Docker,
    pub id: String,
    pub image: String,
    pub runtime: String,
}

/// Options for one supervised program.
#[derive(Debug, Clone)]
pub struct ExecSpec {
    pub argv: Vec<String>,
    pub env: Vec<String>,
    /// fd where the program reads judge-provided input (0 = stdin, 3 = driver channel, -1 = none).
    pub in_fd: i32,
    pub wall_ms: i64,
    pub cpu_s: i64,
    pub stack_mb: i64,
    pub fsize_mb: i64,
    pub nofile: i64,
    /// Total stdout+stderr bytes after which the supervisor kills the program.
    pub max_output: i64,
    /// RLIMIT_NPROC for the program (0 = not set; only meaningful under gVisor).
    pub nproc: i64,
    /// The supervisor kills the program once all sandbox processes together are resident in more
    /// than this many MiB (0 = not watched).
    pub max_rss_mb: i64,
    /// The supervisor kills the program once the tmpfs mounts hold more inodes (0 = not watched).
    pub max_files: i64,
}

impl ExecSpec {
    fn supervisor_argv(&self) -> Vec<String> {
        let mut v = vec![SUPERVISOR.to_string()];
        let mut opt = |k: &str, val: i64| {
            v.push(k.to_string());
            v.push(val.to_string());
        };
        opt("--in-fd", self.in_fd as i64);
        opt("--wall-ms", self.wall_ms);
        if self.cpu_s > 0 {
            opt("--cpu-s", self.cpu_s);
        }
        opt("--stack-mb", self.stack_mb);
        opt("--fsize-mb", self.fsize_mb);
        opt("--nofile", self.nofile);
        opt("--max-output", self.max_output);
        if self.nproc > 0 {
            opt("--nproc", self.nproc);
        }
        if self.max_rss_mb > 0 {
            opt("--max-rss-mb", self.max_rss_mb);
        }
        if self.max_files > 0 {
            opt("--max-files", self.max_files);
        }
        v.push("--cwd".into());
        v.push(WORKDIR.into());
        v.push("--".into());
        v.extend(self.argv.iter().cloned());
        v
    }
}

#[derive(Debug)]
pub enum ExecEvent {
    Stdout(Bytes),
    Stderr(Bytes),
    Exit(ExitStatus),
}

type OutputStream = Pin<Box<dyn Stream<Item = Result<LogOutput, bollard::errors::Error>> + Send>>;

/// A running supervised program.
pub struct Exec {
    input: Pin<Box<dyn AsyncWrite + Send>>,
    output: OutputStream,
    decoder: protocol::Decoder,
    queue: VecDeque<ExecEvent>,
    finished: bool,
    /// A write to the supervisor timed out part-way: the input stream is unusable.
    broken: bool,
    /// The supervisor's own stderr (only ever written on internal errors).
    pub supervisor_stderr: Vec<u8>,
    /// The exec stream failed (a Docker connection problem), as opposed to ending cleanly
    /// without a status (the supervisor or the whole sandbox died).
    pub stream_error: Option<String>,
}

/// How long one write to the supervisor may block. The supervisor reads its input eagerly (it
/// buffers up to 64 MiB), so a write only blocks when the supervisor is not running at all — the
/// sandboxed program shares its uid and can SIGSTOP it. Without a bound the judge's send blocks
/// forever and the job's slot is lost for good (its heartbeat keeps it claimed).
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

impl Exec {
    /// Next event. Cancel-safe: state only changes after the underlying stream yields.
    /// `None` = the exec stream ended (after `Exit`, or because the supervisor died).
    pub async fn next(&mut self) -> Option<ExecEvent> {
        loop {
            if let Some(e) = self.queue.pop_front() {
                if matches!(e, ExecEvent::Exit(_)) {
                    self.finished = true;
                }
                return Some(e);
            }
            if self.finished {
                return None;
            }
            match self.output.next().await {
                Some(Ok(LogOutput::StdOut { message })) => match self.decoder.push(&message) {
                    Ok(evs) => self.queue.extend(evs),
                    Err(e) => {
                        tracing::warn!(error = %e, "supervisor protocol error");
                        self.finished = true;
                        return None;
                    }
                },
                Some(Ok(LogOutput::StdErr { message })) => {
                    if self.supervisor_stderr.len() < 64 * 1024 {
                        self.supervisor_stderr.extend_from_slice(&message);
                    }
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => {
                    tracing::warn!(error = %e, "exec stream error");
                    self.stream_error = Some(e.to_string());
                    self.finished = true;
                    return None;
                }
                None => {
                    self.finished = true;
                    return None;
                }
            }
        }
    }

    async fn frame(&mut self, kind: u8, data: &[u8]) -> Result<()> {
        if self.broken {
            bail!("the supervisor stopped reading its input");
        }
        let mut buf = Vec::with_capacity(5 + data.len());
        buf.push(kind);
        buf.extend_from_slice(&(data.len() as u32).to_be_bytes());
        buf.extend_from_slice(data);
        let input = &mut self.input;
        let write = async {
            input
                .write_all(&buf)
                .await
                .context("writing to supervisor")?;
            input.flush().await.context("flushing supervisor input")
        };
        match tokio::time::timeout(WRITE_TIMEOUT, write).await {
            Ok(r) => r,
            Err(_) => {
                // Part of a frame may have been written: nothing more can be sent on this stream.
                self.broken = true;
                bail!("the supervisor stopped reading its input (timed out)")
            }
        }
    }

    /// Sends bytes to the program's input fd.
    pub async fn send(&mut self, data: &[u8]) -> Result<()> {
        for chunk in data.chunks(protocol::MAX_FRAME) {
            self.frame(b'D', chunk).await?;
        }
        Ok(())
    }

    pub async fn close_input(&mut self) -> Result<()> {
        self.frame(b'C', &[]).await
    }

    /// Kills the program and everything it started; an `Exit` event follows.
    pub async fn kill(&mut self) -> Result<()> {
        self.frame(b'K', &[]).await
    }

    /// Runs to completion, collecting output (each stream capped at `cap` bytes).
    pub async fn collect(mut self, cap: usize) -> Result<Collected> {
        let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
        while let Some(ev) = self.next().await {
            match ev {
                ExecEvent::Stdout(b) => append_capped(&mut stdout, &b, cap),
                ExecEvent::Stderr(b) => append_capped(&mut stderr, &b, cap),
                ExecEvent::Exit(status) => {
                    return Ok(Collected {
                        stdout,
                        stderr,
                        status,
                    });
                }
            }
        }
        Err(anyhow!(
            "supervisor exited without a status: {}",
            String::from_utf8_lossy(&self.supervisor_stderr).trim()
        ))
    }
}

pub fn append_capped(buf: &mut Vec<u8>, data: &[u8], cap: usize) {
    let room = cap.saturating_sub(buf.len());
    buf.extend_from_slice(&data[..data.len().min(room)]);
}

#[derive(Debug)]
pub struct Collected {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub status: ExitStatus,
}

/// What Docker knows about a sandbox container.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContainerState {
    pub running: bool,
    /// The kernel OOM killer fired in the container's cgroup at some point. Under gVisor that
    /// kills the sandbox kernel itself (application memory lives inside it), so the container
    /// stops; under runc it kills one process and the container keeps running.
    pub oom_killed: bool,
    pub exit_code: Option<i64>,
}

pub fn connect() -> Result<Docker> {
    Docker::connect_with_defaults().context("connecting to the Docker daemon")
}

/// Startup checks: the runtime is registered with the daemon and every image exists with the
/// expected driver protocol.
pub async fn check_environment(docker: &Docker, runtime: &str, images: &[&str]) -> Result<()> {
    let info = docker.info().await.context("docker info")?;
    let runtimes = info.runtimes.unwrap_or_default();
    if !runtimes.contains_key(runtime) {
        bail!(
            "Docker runtime {runtime:?} is not registered with the daemon (available: {:?}); see apps/judge/README.md",
            runtimes.keys().collect::<Vec<_>>()
        );
    }
    for image in images {
        let inspect = docker.inspect_image(image).await.with_context(|| {
            format!("sandbox image {image} not found; build it with infra/sandbox/build.sh")
        })?;
        let labels = inspect.config.and_then(|c| c.labels).unwrap_or_default();
        let proto = labels.get(PROTOCOL_LABEL).map(String::as_str);
        if proto != Some(PROTOCOL_VERSION) {
            bail!(
                "sandbox image {image} speaks driver protocol {proto:?}, this judge needs {PROTOCOL_VERSION:?}"
            );
        }
    }
    Ok(())
}

/// Removes containers left behind by a previous run of this consumer, and any judge container
/// older than `max_age` (a judge that died on this host without cleaning up).
pub async fn sweep(docker: &Docker, consumer: &str, max_age: Duration) -> Result<usize> {
    let mut filters = HashMap::new();
    filters.insert("label".to_string(), vec![LABEL_JUDGE.to_string()]);
    let list = docker
        .list_containers(Some(ListContainersOptions {
            all: true,
            filters: Some(filters),
            ..Default::default()
        }))
        .await
        .context("listing sandbox containers")?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let mut removed = 0;
    for c in list {
        let labels = c.labels.unwrap_or_default();
        let mine = labels.get(LABEL_CONSUMER).map(String::as_str) == Some(consumer);
        let old = c
            .created
            .is_some_and(|t| now - t > max_age.as_secs() as i64);
        if (mine || old)
            && let Some(id) = c.id
        {
            let _ = docker
                .remove_container(
                    &id,
                    Some(RemoveContainerOptions {
                        force: true,
                        v: true,
                        ..Default::default()
                    }),
                )
                .await;
            removed += 1;
        }
    }
    Ok(removed)
}

impl Sandbox {
    pub async fn create(
        docker: &Docker,
        settings: &SandboxSettings,
        spec: &ContainerSpec,
    ) -> Result<Sandbox> {
        let memory = spec.memory_mb * 1024 * 1024;
        let mut tmpfs = HashMap::new();
        tmpfs.insert(
            WORKDIR.to_string(),
            format!(
                "rw,exec,nosuid,nodev,size={}m,nr_inodes={WORK_INODES},uid=10001,gid=10001,mode=0700",
                settings.workdir_mb
            ),
        );
        // Explicit, so it is the same under both runtimes: with no mount on /tmp, gVisor puts a
        // writable, size-less, memory-backed tmpfs there (runc leaves it part of the read-only
        // root). TMPDIR points at /work/.tmp.
        tmpfs.insert(
            "/tmp".to_string(),
            "ro,nosuid,nodev,noexec,size=4k,nr_inodes=16".to_string(),
        );
        // Replaces Docker's IPC /dev/shm mount so that it gets an inode cap too.
        tmpfs.insert(
            "/dev/shm".to_string(),
            format!("rw,nosuid,nodev,noexec,size=1m,nr_inodes={SHM_INODES},mode=1777"),
        );
        let ulimit = |name: &str, v: i64| ResourcesUlimits {
            name: Some(name.into()),
            soft: Some(v),
            hard: Some(v),
        };
        let mut labels = HashMap::new();
        labels.insert(LABEL_JUDGE.to_string(), "1".to_string());
        labels.insert(LABEL_CONSUMER.to_string(), settings.consumer.clone());
        labels.insert(LABEL_RUN.to_string(), spec.run_id.clone());
        let host = HostConfig {
            runtime: Some(settings.runtime.clone()),
            network_mode: Some("none".into()),
            readonly_rootfs: Some(true),
            tmpfs: Some(tmpfs),
            cap_drop: Some(vec!["ALL".into()]),
            security_opt: Some(vec!["no-new-privileges:true".into()]),
            memory: Some(memory),
            memory_swap: Some(memory),
            nano_cpus: Some((settings.cpus * 1e9) as i64),
            pids_limit: Some(spec.pids),
            ulimits: Some(vec![
                ulimit("core", 0),
                ulimit("nofile", 1024),
                ulimit("fsize", settings.workdir_mb * 1024 * 1024),
            ]),
            ipc_mode: Some("private".into()),
            oom_score_adj: Some(1000),
            log_config: Some(HostConfigLogConfig {
                typ: Some("none".into()),
                config: None,
            }),
            init: Some(false),
            privileged: Some(false),
            auto_remove: Some(false),
            ..Default::default()
        };
        let body = ContainerCreateBody {
            image: Some(spec.image.clone()),
            cmd: Some(vec![SUPERVISOR.into(), "--idle".into()]),
            user: Some(SANDBOX_USER.into()),
            working_dir: Some(WORKDIR.into()),
            hostname: Some("sandbox".into()),
            network_disabled: Some(true),
            env: Some(vec![]),
            labels: Some(labels),
            stop_timeout: Some(0),
            host_config: Some(host),
            ..Default::default()
        };
        let created = docker
            .create_container(None::<CreateContainerOptions>, body)
            .await
            .context("creating sandbox container")?;
        let sb = Sandbox {
            docker: docker.clone(),
            id: created.id,
            image: spec.image.clone(),
            runtime: settings.runtime.clone(),
        };
        if let Err(e) = docker
            .start_container(
                &sb.id,
                None::<bollard::query_parameters::StartContainerOptions>,
            )
            .await
        {
            sb.destroy().await;
            return Err(e).context("starting sandbox container");
        }
        Ok(sb)
    }

    pub async fn exec(&self, spec: &ExecSpec) -> Result<Exec> {
        let created = self
            .docker
            .create_exec(
                &self.id,
                CreateExecOptions {
                    attach_stdin: Some(true),
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    tty: Some(false),
                    env: Some(spec.env.clone()),
                    cmd: Some(spec.supervisor_argv()),
                    user: Some(SANDBOX_USER.to_string()),
                    working_dir: Some(WORKDIR.to_string()),
                    privileged: Some(false),
                    ..Default::default()
                },
            )
            .await
            .context("creating exec")?;
        let started = self
            .docker
            .start_exec(
                &created.id,
                Some(StartExecOptions {
                    detach: false,
                    tty: false,
                    output_capacity: Some(64 * 1024),
                }),
            )
            .await
            .context("starting exec")?;
        match started {
            StartExecResults::Attached { output, input } => Ok(Exec {
                input,
                output,
                decoder: protocol::Decoder::default(),
                queue: VecDeque::new(),
                finished: false,
                broken: false,
                supervisor_stderr: Vec::new(),
                stream_error: None,
            }),
            StartExecResults::Detached => bail!("exec started detached"),
        }
    }

    /// Writes files (and the directories `dirs`) into the tmpfs work directory by streaming a tar
    /// archive to `tar -x` through the supervisor (`docker cp` cannot reach a tmpfs mount).
    pub async fn put_files(
        &self,
        files: &[(String, Vec<u8>)],
        dirs: &[&str],
        env: &[String],
    ) -> Result<()> {
        let mut ar = tar::Builder::new(Vec::new());
        for d in dirs {
            let mut h = tar::Header::new_gnu();
            h.set_entry_type(tar::EntryType::Directory);
            h.set_mode(0o700);
            h.set_size(0);
            h.set_mtime(0);
            ar.append_data(&mut h, d, std::io::empty())?;
        }
        for (name, data) in files {
            let mut h = tar::Header::new_gnu();
            h.set_mode(0o600);
            h.set_size(data.len() as u64);
            h.set_mtime(0);
            ar.append_data(&mut h, name, data.as_slice())?;
        }
        let archive = ar.into_inner()?;
        let spec = ExecSpec {
            argv: vec![
                "tar".into(),
                "-x".into(),
                "-f".into(),
                "-".into(),
                "-C".into(),
                WORKDIR.into(),
            ],
            env: env.to_vec(),
            in_fd: 0,
            wall_ms: 15_000,
            cpu_s: 0,
            stack_mb: 8,
            fsize_mb: 32,
            nofile: 64,
            max_output: 16 * 1024,
            nproc: 0,
            max_rss_mb: 0,
            max_files: MAX_FILES,
        };
        let mut ex = self.exec(&spec).await?;
        ex.send(&archive).await?;
        ex.close_input().await?;
        let out = ex.collect(16 * 1024).await?;
        if out.status.exit_code != Some(0) {
            bail!(
                "unpacking files failed ({:?}): {}",
                out.status,
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        Ok(())
    }

    pub async fn state(&self) -> Result<ContainerState> {
        let inspect = self
            .docker
            .inspect_container(&self.id, None::<InspectContainerOptions>)
            .await
            .context("inspecting sandbox container")?;
        let st = inspect.state.unwrap_or_default();
        Ok(ContainerState {
            running: st.running.unwrap_or(false),
            oom_killed: st.oom_killed.unwrap_or(false),
            exit_code: st.exit_code,
        })
    }

    /// The container's state once it has stopped, or (if it is still running after `within`)
    /// its current state. Docker records a dead sandbox within ~50 ms of the exec streams ending.
    pub async fn wait_stopped(&self, within: Duration) -> Result<ContainerState> {
        let until = tokio::time::Instant::now() + within;
        loop {
            let st = self.state().await?;
            if !st.running || tokio::time::Instant::now() >= until {
                return Ok(st);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// Force-removes the container (killing everything in it). Never fails; errors are logged.
    pub async fn destroy(&self) {
        let r = self
            .docker
            .remove_container(
                &self.id,
                Some(RemoveContainerOptions {
                    force: true,
                    v: true,
                    ..Default::default()
                }),
            )
            .await;
        if let Err(e) = r {
            tracing::warn!(container = %self.id, error = %e, "removing sandbox container failed");
        }
    }
}
