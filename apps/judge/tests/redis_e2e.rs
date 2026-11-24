//! End to end through Redis, on private key names (never the real `judge:*` keys): jobs in, progress
//! and results out, acknowledgement, reclaiming from a dead consumer, poison jobs, shutdown.
//! Needs Redis at REDIS_URL (default redis://127.0.0.1:6379) plus Docker and the sandbox images.

mod common;

use common::*;
use futures_util::StreamExt;
use ipp_judge::worker::Worker;
use ipp_judge_contracts::*;
use redis::AsyncCommands;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[tokio::test]
async fn jobs_progress_results_through_redis() {
    if common::skip() {
        return;
    }
    let prefix = format!("ipp-test-{}", uuid::Uuid::new_v4().simple());
    let mut cfg = config_for_tests(&prefix);
    cfg.concurrency = 2;
    cfg.reclaim_idle = Duration::from_millis(1500);
    cfg.reclaim_interval = Duration::from_millis(500);
    cfg.heartbeat_interval = Duration::from_millis(300);
    let keys = cfg.keys.clone();
    let client = redis::Client::open(cfg.redis_url.as_str()).unwrap();
    let mut conn = client
        .get_multiplexed_async_connection()
        .await
        .expect("redis");

    // Like the API: the group exists before the judge starts, created from 0.
    let _: () = conn
        .xgroup_create_mkstream(&keys.jobs_stream, &keys.jobs_group, "0")
        .await
        .unwrap();

    let mut pubsub = client.get_async_pubsub().await.unwrap();
    pubsub.subscribe(&keys.progress_channel).await.unwrap();
    let events: Arc<std::sync::Mutex<Vec<JudgeProgress>>> = Arc::default();
    let sink = events.clone();
    let progress_task = tokio::spawn(async move {
        let mut stream = pubsub.on_message();
        while let Some(msg) = stream.next().await {
            let payload: String = msg.get_payload().unwrap();
            let p: JudgeProgress =
                serde_json::from_str(&payload).expect("progress matches the contract");
            sink.lock().unwrap().push(p);
        }
    });

    let add_conn = conn.clone();
    let add = |payload: String| {
        let mut c = add_conn.clone();
        let stream = keys.jobs_stream.clone();
        async move {
            let id: String = c.xadd(&stream, "*", &[("payload", payload)]).await.unwrap();
            id
        }
    };

    // 1. A job taken by a consumer that then died, and a poison job delivered three times already.
    let orphan = file_job(Language::Python, "print('orphan')\n", "");
    let poison = file_job(Language::Python, "print('should never run')\n", "");
    add(serde_json::to_string(&orphan).unwrap()).await;
    let poison_id = add(serde_json::to_string(&poison).unwrap()).await;
    let _: redis::Value = redis::cmd("XREADGROUP")
        .arg("GROUP")
        .arg(&keys.jobs_group)
        .arg("dead-a")
        .arg("COUNT")
        .arg(2)
        .arg("STREAMS")
        .arg(&keys.jobs_stream)
        .arg(">")
        .query_async(&mut conn)
        .await
        .unwrap();
    for c in ["dead-b", "dead-c"] {
        let _: redis::Value = redis::cmd("XCLAIM")
            .arg(&keys.jobs_stream)
            .arg(&keys.jobs_group)
            .arg(c)
            .arg(0)
            .arg(&poison_id)
            .query_async(&mut conn)
            .await
            .unwrap();
    }
    // 2. A job this very consumer took before "crashing": resumed from its own pending list.
    let resumed = file_job(Language::Python, "print('resumed')\n", "");
    add(serde_json::to_string(&resumed).unwrap()).await;
    let _: redis::Value = redis::cmd("XREADGROUP")
        .arg("GROUP")
        .arg(&keys.jobs_group)
        .arg(&cfg.consumer)
        .arg("COUNT")
        .arg(1)
        .arg("STREAMS")
        .arg(&keys.jobs_stream)
        .arg(">")
        .query_async(&mut conn)
        .await
        .unwrap();
    // 3. A file-mode job and a tests-mode job, queued before the judge starts.
    let file = file_job(Language::Python, "print(input()[::-1])\n", "olleh\n");
    let tests = tests_job(
        Language::Python,
        "class Solution:\n    def twoSum(self, n, t):\n        return [0, 1]\n",
        two_sum_sig(),
        vec![
            call1("s1", "twoSum", json!([[2, 7], 9]), json!([1, 0])),
            call1("s2", "twoSum", json!([[1, 1], 5]), json!([0, 2])),
        ],
    );
    add(serde_json::to_string(&file).unwrap()).await;
    add(serde_json::to_string(&tests).unwrap()).await;
    // 4. Malformed payloads: one with a recoverable runId, one without.
    let bad_run = uuid::Uuid::new_v4().to_string();
    add(json!({"v": 1, "runId": bad_run, "language": "cobol"}).to_string()).await;
    add("not json".to_string()).await;

    let judge = Arc::new(judge().await);
    let worker = Arc::new(Worker::new(cfg.clone(), judge).await.unwrap());
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let handle = tokio::spawn(worker.run(stop_rx));

    // Collect results like the API does.
    let wanted = [
        file.run_id.clone(),
        tests.run_id.clone(),
        bad_run.clone(),
        orphan.run_id.clone(),
        poison.run_id.clone(),
        resumed.run_id.clone(),
    ];
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut results: HashMap<String, JudgeResult> = HashMap::new();
    let deadline = Instant::now() + Duration::from_secs(120);
    let mut last_id = "0".to_string();
    while results.len() < wanted.len() && Instant::now() < deadline {
        let reply: redis::streams::StreamReadReply = conn
            .xread_options(
                &[&keys.results_stream],
                &[&last_id],
                &redis::streams::StreamReadOptions::default().block(1000),
            )
            .await
            .unwrap();
        for k in reply.keys {
            for e in k.ids {
                last_id = e.id.clone();
                let payload: String = redis::from_redis_value(&e.map["payload"]).unwrap();
                let r: JudgeResult =
                    serde_json::from_str(&payload).expect("result matches the contract");
                *seen.entry(r.run_id.clone()).or_default() += 1;
                results.insert(r.run_id.clone(), r);
            }
        }
    }
    // The unparseable entry produces no result; wait for it to be acknowledged too.
    let drain_deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < drain_deadline {
        let len: usize = conn.xlen(&keys.jobs_stream).await.unwrap();
        if len == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let _ = stop_tx.send(true);
    tokio::time::timeout(Duration::from_secs(60), handle)
        .await
        .expect("graceful shutdown")
        .unwrap()
        .unwrap();

    let r = &results[&file.run_id];
    assert_eq!(r.verdict, RunVerdict::Ok, "{}", dump(r));
    assert_eq!(r.file.as_ref().unwrap().stdout, "hello\n");
    let r = &results[&tests.run_id];
    assert_eq!(r.verdict, RunVerdict::WrongAnswer, "{}", dump(r));
    assert_eq!(verdicts(r), vec![TestVerdict::Pass, TestVerdict::Fail]);
    assert_eq!(results[&bad_run].verdict, RunVerdict::InternalError);
    assert_eq!(results[&orphan.run_id].verdict, RunVerdict::Ok);
    assert_eq!(
        results[&resumed.run_id].file.as_ref().unwrap().stdout,
        "resumed\n"
    );
    // give a duplicate (re-dispatch) a chance to show up, then check every job was answered once
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        seen.values().all(|&n| n == 1),
        "duplicate results: {seen:?}"
    );
    let p = &results[&poison.run_id];
    assert_eq!(p.verdict, RunVerdict::InternalError, "{}", dump(p));
    assert!(p.message.as_deref().unwrap().contains("failed repeatedly"));

    // Everything acknowledged and deleted: the jobs stream is empty, nothing pending.
    let len: usize = conn.xlen(&keys.jobs_stream).await.unwrap();
    assert_eq!(len, 0, "jobs stream not drained");
    let pending: redis::streams::StreamPendingReply = conn
        .xpending(&keys.jobs_stream, &keys.jobs_group)
        .await
        .unwrap();
    assert_eq!(pending.count(), 0);

    // Progress arrived for the file job (no compile step for Python) and the tests job.
    tokio::time::sleep(Duration::from_millis(300)).await;
    progress_task.abort();
    let events = events.lock().unwrap().clone();
    let of = |run: &str| {
        events
            .iter()
            .filter(|e| e.run_id == run)
            .map(|e| e.event.clone())
            .collect::<Vec<_>>()
    };
    let fe = of(&file.run_id);
    assert_eq!(fe.first(), Some(&ProgressEvent::Started), "{fe:?}");
    assert!(
        fe.contains(&ProgressEvent::Output {
            stream: OutputStream::Stdout,
            chunk: "hello\n".into()
        }),
        "{fe:?}"
    );
    let te = of(&tests.run_id);
    assert!(
        te.contains(&ProgressEvent::Running { done: 2, total: 2 }),
        "{te:?}"
    );
    assert!(of(&poison.run_id).is_empty(), "the poison job must not run");

    let _: () = redis::pipe()
        .del(&keys.jobs_stream)
        .ignore()
        .del(&keys.results_stream)
        .ignore()
        .query_async(&mut conn)
        .await
        .unwrap();
}
