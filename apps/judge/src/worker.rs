//! The Redis side: consume `JudgeJob`s from the jobs stream with a consumer group, publish
//! progress, write results, acknowledge. Protocol: packages/contracts/src/judge.ts and
//! docs/ARCHITECTURE.md section 6.
//!
//! - At-least-once: a job is acknowledged (and deleted from the stream, so XLEN stays a measure
//!   of the backlog) only after its result has been written.
//! - While a job runs its pending entry is re-claimed by its owner every `heartbeat_interval`
//!   (XCLAIM ... JUSTID resets the idle time without counting a delivery), so only jobs of dead
//!   judges go idle; those are taken over with XAUTOCLAIM after `reclaim_idle`.
//! - A job delivered more than twice is answered with `internal_error` instead of being run again
//!   (it probably kills the judge). Unparseable payloads are answered the same way when their
//!   runId can be recovered, and dropped otherwise.
//! - At most `concurrency` jobs run at once. On SIGTERM/SIGINT no new jobs are taken; running
//!   jobs get `shutdown_grace` to finish, then are abandoned unacknowledged (another judge will
//!   reclaim them) and their containers are removed.

use crate::config::Config;
use crate::runner::{Judge, Progress};
use anyhow::{Context, Result};
use ipp_judge_contracts::{JudgeProgress, JudgeResult, keys::PAYLOAD_FIELD};
use redis::AsyncCommands;
use redis::aio::{ConnectionManager, ConnectionManagerConfig};
use redis::streams::{
    StreamAutoClaimOptions, StreamAutoClaimReply, StreamId, StreamReadOptions, StreamReadReply,
};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Semaphore, mpsc, watch};
use tokio::task::JoinSet;
use tracing::Instrument;

const MAX_DELIVERIES: usize = 2;
const READ_BLOCK_MS: usize = 2000;

pub struct Worker {
    cfg: Config,
    judge: Arc<Judge>,
    conn: ConnectionManager,
    reader: ConnectionManager,
    progress_tx: mpsc::Sender<JudgeProgress>,
}

/// Best-effort progress: dropped when the publisher falls behind.
struct ChannelProgress(mpsc::Sender<JudgeProgress>);
impl Progress for ChannelProgress {
    fn send(&self, p: JudgeProgress) {
        let _ = self.0.try_send(p);
    }
}

pub async fn connect(url: &str, response_timeout: Duration) -> Result<ConnectionManager> {
    let client = redis::Client::open(url).context("REDIS_URL")?;
    let cfg = ConnectionManagerConfig::new()
        .set_connection_timeout(Duration::from_secs(5))
        .set_response_timeout(response_timeout);
    ConnectionManager::new_with_config(client, cfg)
        .await
        .context("connecting to Redis")
}

impl Worker {
    pub async fn new(cfg: Config, judge: Arc<Judge>) -> Result<Worker> {
        let conn = connect(&cfg.redis_url, Duration::from_secs(10)).await?;
        let reader = connect(
            &cfg.redis_url,
            Duration::from_millis(READ_BLOCK_MS as u64 + 10_000),
        )
        .await?;
        let (progress_tx, mut rx) = mpsc::channel::<JudgeProgress>(4096);
        let mut pub_conn = conn.clone();
        let channel = cfg.keys.progress_channel.clone();
        tokio::spawn(async move {
            while let Some(p) = rx.recv().await {
                if let Ok(json) = serde_json::to_string(&p) {
                    let _: Result<i64, _> = pub_conn.publish(&channel, json).await;
                }
            }
        });
        Ok(Worker {
            cfg,
            judge,
            conn,
            reader,
            progress_tx,
        })
    }

    pub async fn ensure_group(&self) -> Result<()> {
        let mut c = self.conn.clone();
        let r: redis::RedisResult<()> = c
            .xgroup_create_mkstream(&self.cfg.keys.jobs_stream, &self.cfg.keys.jobs_group, "0")
            .await;
        match r {
            Ok(()) => Ok(()),
            Err(e) if e.code() == Some("BUSYGROUP") => Ok(()),
            Err(e) => Err(e).context("creating the consumer group"),
        }
    }

    /// Runs until `shutdown` turns true, then drains.
    pub async fn run(self: Arc<Self>, mut shutdown: watch::Receiver<bool>) -> Result<()> {
        self.ensure_group().await?;
        let sem = Arc::new(Semaphore::new(self.cfg.concurrency));
        let mut tasks = JoinSet::new();
        let mut last_reclaim = Instant::now() - self.cfg.reclaim_interval;
        let mut claim_cursor = "0-0".to_string();
        // Entries this consumer owned before a restart come first (read once: re-reading the
        // PEL later would also return the jobs that are running right now).
        let mut backlog: std::collections::VecDeque<StreamId> =
            match self.read(&mut shutdown, "0", 1000).await {
                Ok(v) => v.into(),
                Err(e) => {
                    tracing::warn!(error = %e, "reading own pending entries");
                    Default::default()
                }
            };
        if !backlog.is_empty() {
            tracing::info!(
                count = backlog.len(),
                "resuming jobs this consumer had not finished"
            );
        }
        tracing::info!(
            consumer = %self.cfg.consumer, stream = %self.cfg.keys.jobs_stream, concurrency = self.cfg.concurrency,
            "judge worker started"
        );
        loop {
            while tasks.try_join_next().is_some() {}
            if *shutdown.borrow() {
                break;
            }
            let permit = tokio::select! {
                p = sem.clone().acquire_owned() => p.expect("semaphore"),
                _ = shutdown.changed() => break,
            };
            let mut entry = backlog.pop_front();
            if entry.is_none() && last_reclaim.elapsed() >= self.cfg.reclaim_interval {
                match self.reclaim(&mut claim_cursor).await {
                    Ok(Some(e)) => entry = Some(e),
                    Ok(None) => last_reclaim = Instant::now(),
                    Err(e) => {
                        tracing::warn!(error = %e, "XAUTOCLAIM failed");
                        last_reclaim = Instant::now();
                    }
                }
            }
            if entry.is_none() {
                match self.read(&mut shutdown, ">", 1).await {
                    Ok(e) => entry = e.into_iter().next(),
                    Err(e) => {
                        tracing::warn!(error = %e, "XREADGROUP failed; retrying");
                        tokio::select! {
                            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                            _ = shutdown.changed() => {}
                        }
                    }
                }
            }
            let Some(entry) = entry else { continue };
            let me = self.clone();
            tasks.spawn(async move {
                let _permit = permit;
                me.handle(entry).await;
            });
        }

        tracing::info!(
            running = tasks.len(),
            "shutting down: no new jobs; waiting for running jobs"
        );
        let drain = async { while tasks.join_next().await.is_some() {} };
        if tokio::time::timeout(self.cfg.shutdown_grace, drain)
            .await
            .is_err()
        {
            tracing::warn!(
                abandoned = tasks.len(),
                "grace period over; abandoning jobs (they will be reclaimed)"
            );
            tasks.abort_all();
            while tasks.join_next().await.is_some() {}
            // Containers of aborted jobs are removed by their sessions' Drop; give those tasks a moment.
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Ok(())
    }

    async fn read(
        &self,
        shutdown: &mut watch::Receiver<bool>,
        id: &str,
        count: usize,
    ) -> Result<Vec<StreamId>> {
        let mut c = self.reader.clone();
        let mut opts = StreamReadOptions::default()
            .group(&self.cfg.keys.jobs_group, &self.cfg.consumer)
            .count(count);
        if id == ">" {
            opts = opts.block(READ_BLOCK_MS);
        }
        let streams = [&self.cfg.keys.jobs_stream];
        let ids = [id];
        let fut = c.xread_options::<_, _, Option<StreamReadReply>>(&streams, &ids, &opts);
        let reply = tokio::select! {
            r = fut => r?,
            _ = shutdown.changed() => return Ok(vec![]),
        };
        Ok(reply
            .and_then(|r| r.keys.into_iter().next())
            .map(|k| k.ids)
            .unwrap_or_default())
    }

    async fn reclaim(&self, cursor: &mut String) -> Result<Option<StreamId>> {
        let mut c = self.conn.clone();
        let reply: StreamAutoClaimReply = c
            .xautoclaim_options(
                &self.cfg.keys.jobs_stream,
                &self.cfg.keys.jobs_group,
                &self.cfg.consumer,
                self.cfg.reclaim_idle.as_millis() as u64,
                cursor.as_str(),
                StreamAutoClaimOptions::default().count(1),
            )
            .await?;
        *cursor = reply.next_stream_id.clone();
        if let Some(e) = reply.claimed.into_iter().next() {
            tracing::info!(id = %e.id, "reclaimed a job from a dead consumer");
            return Ok(Some(e));
        }
        if *cursor != "0-0" {
            // More entries to scan; continue on the next round without waiting a full interval.
            return Ok(None);
        }
        Ok(None)
    }

    async fn deliveries(&self, id: &str) -> usize {
        let mut c = self.conn.clone();
        let r: redis::RedisResult<redis::streams::StreamPendingCountReply> = c
            .xpending_count(
                &self.cfg.keys.jobs_stream,
                &self.cfg.keys.jobs_group,
                id,
                id,
                1,
            )
            .await;
        r.ok()
            .and_then(|p| p.ids.into_iter().next())
            .map(|p| p.times_delivered)
            .unwrap_or(1)
    }

    async fn handle(self: Arc<Self>, entry: StreamId) {
        let id = entry.id.clone();
        let payload: Option<Vec<u8>> = entry
            .map
            .get(PAYLOAD_FIELD)
            .and_then(|v| redis::from_redis_value(v).ok());
        let payload = payload.unwrap_or_default();
        let deliveries = self.deliveries(&id).await;
        let parsed = crate::runner::parse_job(&payload);
        let run_id = match &parsed {
            Ok(j) => Some(j.run_id.clone()),
            Err(_) => crate::runner::run_id_of(&payload),
        };
        let span = tracing::info_span!("job", id = %id, run_id = run_id.as_deref().unwrap_or("?"));
        async move {
        let mut teardown_later = None;
        let result = if deliveries > MAX_DELIVERIES {
            tracing::error!(deliveries, "poison job: delivered too often; answering internal_error");
            run_id.as_ref().map(|r| {
                let lang = parsed.as_ref().ok().map(|j| j.language);
                self.judge.internal_error(
                    r,
                    lang,
                    "This submission could not be judged (it failed repeatedly inside the judge).",
                    0.0,
                )
            })
        } else {
            match &parsed {
                Ok(job) => {
                    let hb = self.clone().heartbeat(id.clone());
                    let progress = ChannelProgress(self.progress_tx.clone());
                    let (result, teardown) = self.judge.run_deferred(job, &progress).await;
                    hb.abort();
                    teardown_later = Some(teardown);
                    tracing::info!(
                        run_id = %job.run_id, verdict = ?result.verdict, total_ms = result.timing.total_ms as u64,
                        "job finished"
                    );
                    Some(result)
                }
                Err(e) => {
                    tracing::error!(error = format!("{e:#}"), "unparseable job");
                    run_id.as_ref().map(|r| self.judge.internal_error(r, None, "The run request was malformed.", 0.0))
                }
            }
        };

        if let Some(result) = result
            && !self.write_result(&result).await
        {
            // Leave it pending: it will be retried (and eventually answered as poison).
            if let Some(t) = teardown_later {
                t.finish().await;
            }
            return;
        }
        self.ack(&id).await;
        // The container is removed after the result is out (still inside this job's permit).
        if let Some(t) = teardown_later {
            t.finish().await;
        }
        }
        .instrument(span)
        .await
    }

    /// Keeps the pending entry fresh while the job runs, so it is not reclaimed.
    fn heartbeat(self: Arc<Self>, id: String) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(self.cfg.heartbeat_interval);
            tick.tick().await;
            loop {
                tick.tick().await;
                let mut c = self.conn.clone();
                // Only refresh while we still own it (never steal it back from a reclaimer).
                let owner: redis::RedisResult<redis::streams::StreamPendingCountReply> = c
                    .xpending_count(
                        &self.cfg.keys.jobs_stream,
                        &self.cfg.keys.jobs_group,
                        &id,
                        &id,
                        1,
                    )
                    .await;
                let ours = owner
                    .ok()
                    .and_then(|p| p.ids.into_iter().next())
                    .is_some_and(|p| p.consumer == self.cfg.consumer);
                if !ours {
                    tracing::warn!(id = %id, "job is no longer pending for this consumer");
                    return;
                }
                let r: redis::RedisResult<redis::Value> = redis::cmd("XCLAIM")
                    .arg(&self.cfg.keys.jobs_stream)
                    .arg(&self.cfg.keys.jobs_group)
                    .arg(&self.cfg.consumer)
                    .arg(0)
                    .arg(&id)
                    .arg("JUSTID")
                    .query_async(&mut c)
                    .await;
                if let Err(e) = r {
                    tracing::warn!(error = %e, "heartbeat failed");
                }
            }
        })
    }

    async fn write_result(&self, result: &JudgeResult) -> bool {
        let json = match serde_json::to_string(result) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!(error = %e, "serializing result");
                return false;
            }
        };
        for attempt in 0..8u32 {
            let mut c = self.conn.clone();
            let r: redis::RedisResult<String> = c
                .xadd_maxlen(
                    &self.cfg.keys.results_stream,
                    redis::streams::StreamMaxlen::Approx(self.cfg.results_maxlen),
                    "*",
                    &[(PAYLOAD_FIELD, json.as_str())],
                )
                .await;
            match r {
                Ok(_) => return true,
                Err(e) => {
                    tracing::warn!(error = %e, attempt, "writing result failed; retrying");
                    tokio::time::sleep(Duration::from_millis(250 * 2u64.pow(attempt.min(5)))).await;
                }
            }
        }
        false
    }

    async fn ack(&self, id: &str) {
        let mut c = self.conn.clone();
        let r: redis::RedisResult<()> = redis::pipe()
            .atomic()
            .xack(&self.cfg.keys.jobs_stream, &self.cfg.keys.jobs_group, &[id])
            .ignore()
            .xdel(&self.cfg.keys.jobs_stream, &[id])
            .ignore()
            .query_async(&mut c)
            .await;
        if let Err(e) = r {
            tracing::warn!(error = %e, id, "acknowledging failed (the job may be judged twice)");
        }
    }
}
