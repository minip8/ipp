//! The shared fixtures in packages/contracts/fixtures must parse here exactly as they do in the
//! TypeScript test suite, and survive a serialize/parse round trip.

use ipp_judge_contracts::*;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::path::PathBuf;

fn fixture(name: &str) -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/fixtures")
        .join(format!("{name}.json"));
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

fn roundtrip<T: DeserializeOwned + serde::Serialize + PartialEq + std::fmt::Debug>(
    name: &str,
) -> T {
    let text = fixture(name);
    let v: T = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
    let again: T = serde_json::from_str(&serde_json::to_string(&v).unwrap()).unwrap();
    assert_eq!(v, again, "{name} round trip");
    v
}

#[test]
fn jobs() {
    let t: JudgeJob = roundtrip("judge-job-tests");
    assert_eq!(t.mode, JobMode::Tests);
    assert_eq!(t.language, Language::Python);
    let sig = t.signature.unwrap();
    assert_eq!(sig.methods[0].compare, Compare::Unordered);
    assert_eq!(
        sig.methods[0].params[0].ty,
        Ty::Array(Box::new(Ty::Prim(Primitive::Int)))
    );
    assert_eq!(t.tests[1].expected, None);
    let f: JudgeJob = roundtrip("judge-job-file");
    assert_eq!(f.mode, JobMode::File);
    assert_eq!(f.stdin, "world\n");
    assert!(f.signature.is_none());
}

#[test]
fn results() {
    let r: JudgeResult = roundtrip("judge-result-tests");
    assert_eq!(r.verdict, RunVerdict::Accepted);
    assert_eq!(r.tests[1].verdict, TestVerdict::Ran);
    let r: JudgeResult = roundtrip("judge-result-failures");
    assert_eq!(
        r.tests.iter().map(|t| t.verdict).collect::<Vec<_>>(),
        vec![
            TestVerdict::Fail,
            TestVerdict::TimeLimit,
            TestVerdict::RuntimeError,
            TestVerdict::Skipped
        ]
    );
    let r: JudgeResult = roundtrip("judge-result-file");
    assert_eq!(r.file.unwrap().exit_code, Some(0));
}

#[test]
fn progress() {
    let all: Vec<JudgeProgress> = serde_json::from_str(&fixture("judge-progress")).unwrap();
    assert_eq!(all[2].event, ProgressEvent::Running { done: 3, total: 12 });
    // Serializes back to the same JSON shape.
    let original: Value = serde_json::from_str(&fixture("judge-progress")).unwrap();
    assert_eq!(serde_json::to_value(&all).unwrap(), original);
}

#[test]
fn problems() {
    let p: ProblemContent = roundtrip("problem-lru-cache");
    assert_eq!(p.signature.kind, ProblemKind::Design);
    assert!(p.signature.method("put").unwrap().returns.is_void());
    assert_eq!(p.tests[0].expected[0], Value::Null);
    assert!(p.reference_solutions.contains_key(&Language::Cpp));
    let p: ProblemContent = roundtrip("problem-two-sum");
    assert_eq!(p.reference_solutions.len(), 3);
}

#[test]
fn rejects_bad_shapes() {
    let mut job: Value = serde_json::from_str(&fixture("judge-job-tests")).unwrap();
    job["v"] = 2.into();
    assert!(serde_json::from_value::<JudgeJob>(job.clone()).is_err());
    job["v"] = 1.into();
    job["signature"]["methods"][0]["returns"] = serde_json::json!({"array": "int", "extra": 1});
    assert!(
        serde_json::from_value::<JudgeJob>(job.clone()).is_err(),
        "Ty objects are strict"
    );
    job["signature"]["methods"][0]["returns"] = serde_json::json!({"list": {"array": "string"}});
    assert!(serde_json::from_value::<JudgeJob>(job).is_ok());
}

#[test]
fn limits_match_ts() {
    let p = ProblemLimits {
        time_ms: 1000,
        memory_mb: 256,
    };
    assert_eq!(limits_for_tests(Language::Python, p).run_ms, 4000);
    assert_eq!(limits_for_tests(Language::Cpp, p).run_ms, 1000);
    assert_eq!(limits_for_tests(Language::Java, p).memory_mb, 512);
    assert_eq!(limits_for_file(Language::Cpp).memory_mb, 256);
}
