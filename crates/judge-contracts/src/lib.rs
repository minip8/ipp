//! serde mirror of the judge wire contract in `packages/contracts/src/judge.ts` (and the parts of
//! `problem.ts` / `limits.ts` it depends on). The TypeScript side is the source of truth; the tests
//! in `tests/fixtures.rs` parse the shared fixtures in `packages/contracts/fixtures` so the two
//! definitions cannot drift silently.

pub mod compare;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Redis keys from `JUDGE_KEYS`.
pub mod keys {
    pub const JOBS_STREAM: &str = "judge:jobs";
    pub const JOBS_GROUP: &str = "judge";
    pub const RESULTS_STREAM: &str = "judge:results";
    pub const RESULTS_GROUP: &str = "api";
    pub const PROGRESS_CHANNEL: &str = "judge:progress";
    /// Stream entry field holding the JSON document.
    pub const PAYLOAD_FIELD: &str = "payload";
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Cpp,
    Python,
    Java,
}

impl Language {
    pub const ALL: [Language; 3] = [Language::Cpp, Language::Python, Language::Java];
    pub fn as_str(self) -> &'static str {
        match self {
            Language::Cpp => "cpp",
            Language::Python => "python",
            Language::Java => "java",
        }
    }
}

impl std::str::FromStr for Language {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "cpp" | "c++" => Ok(Language::Cpp),
            "python" | "py" => Ok(Language::Python),
            "java" => Ok(Language::Java),
            _ => Err(format!("unknown language {s:?} (cpp, python, java)")),
        }
    }
}

// ---------------------------------------------------------------- problem.ts

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Primitive {
    Int,
    Long,
    Double,
    Bool,
    String,
    Char,
    Void,
}

/// `Ty = Primitive | { array: Ty } | { list: Ty }`
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Ty {
    Prim(Primitive),
    Array(Box<Ty>),
    List(Box<Ty>),
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum TyRepr {
    Prim(Primitive),
    Array(ArrayRepr),
    List(ListRepr),
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArrayRepr {
    array: Box<Ty>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ListRepr {
    list: Box<Ty>,
}

impl Serialize for Ty {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Ty::Prim(p) => TyRepr::Prim(*p),
            Ty::Array(t) => TyRepr::Array(ArrayRepr { array: t.clone() }),
            Ty::List(t) => TyRepr::List(ListRepr { list: t.clone() }),
        }
        .serialize(s)
    }
}

impl<'de> Deserialize<'de> for Ty {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match TyRepr::deserialize(d)? {
            TyRepr::Prim(p) => Ty::Prim(p),
            TyRepr::Array(a) => Ty::Array(a.array),
            TyRepr::List(l) => Ty::List(l.list),
        })
    }
}

impl Ty {
    pub fn is_void(&self) -> bool {
        matches!(self, Ty::Prim(Primitive::Void))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Param {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: Ty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Compare {
    #[default]
    Exact,
    Unordered,
    UnorderedDeep,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Method {
    pub name: String,
    pub params: Vec<Param>,
    pub returns: Ty,
    #[serde(default)]
    pub compare: Compare,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProblemKind {
    Function,
    Design,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemSignature {
    pub class_name: String,
    pub kind: ProblemKind,
    #[serde(default)]
    pub ctor_params: Vec<Param>,
    pub methods: Vec<Method>,
}

impl ProblemSignature {
    pub fn method(&self, name: &str) -> Option<&Method> {
        self.methods.iter().find(|m| m.name == name)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Call {
    pub method: String,
    pub args: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    pub id: String,
    pub hidden: bool,
    #[serde(default)]
    pub ctor_args: Vec<Value>,
    pub calls: Vec<Call>,
    pub expected: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemLimits {
    pub time_ms: i64,
    pub memory_mb: i64,
}

/// Authoring format of a problem (`ProblemContent`); used by the CLI to verify reference solutions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemContent {
    pub slug: String,
    pub title: String,
    pub signature: ProblemSignature,
    #[serde(default = "default_problem_limits")]
    pub limits: ProblemLimits,
    pub tests: Vec<TestCase>,
    #[serde(default)]
    pub reference_solutions: BTreeMap<Language, String>,
}

fn default_problem_limits() -> ProblemLimits {
    ProblemLimits {
        time_ms: 1000,
        memory_mb: 256,
    }
}

// ---------------------------------------------------------------- limits.ts

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeLimits {
    pub compile_ms: i64,
    pub run_ms: i64,
    pub total_ms: i64,
    pub memory_mb: i64,
    pub output_bytes: i64,
}

pub const FILE_RUN_MS: i64 = 10_000;
pub const FILE_RUN_MEMORY_MB: i64 = 256;
pub const OUTPUT_BYTES: i64 = 64 * 1024;
pub const TOTAL_MS: i64 = 60_000;

fn time_factor(l: Language) -> i64 {
    match l {
        Language::Cpp => 1,
        Language::Java => 2,
        Language::Python => 4,
    }
}
fn memory_extra_mb(l: Language) -> i64 {
    match l {
        Language::Cpp => 0,
        Language::Java => 256,
        Language::Python => 64,
    }
}
fn compile_ms(l: Language) -> i64 {
    match l {
        Language::Cpp | Language::Java => 20_000,
        Language::Python => 5_000,
    }
}

/// Mirror of `limitsForTests`.
pub fn limits_for_tests(l: Language, p: ProblemLimits) -> JudgeLimits {
    JudgeLimits {
        compile_ms: compile_ms(l),
        run_ms: p.time_ms * time_factor(l),
        total_ms: TOTAL_MS,
        memory_mb: p.memory_mb + memory_extra_mb(l),
        output_bytes: OUTPUT_BYTES,
    }
}

/// Mirror of `limitsForFile`.
pub fn limits_for_file(l: Language) -> JudgeLimits {
    JudgeLimits {
        compile_ms: compile_ms(l),
        run_ms: FILE_RUN_MS,
        total_ms: TOTAL_MS,
        memory_mb: FILE_RUN_MEMORY_MB + memory_extra_mb(l),
        output_bytes: OUTPUT_BYTES,
    }
}

// ---------------------------------------------------------------- judge.ts

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeTest {
    pub id: String,
    pub ctor_args: Vec<Value>,
    pub calls: Vec<Call>,
    /// None = custom test: run it and report the output, no pass/fail.
    pub expected: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobMode {
    File,
    Tests,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeJob {
    pub v: Version,
    pub run_id: String,
    pub language: Language,
    pub source: String,
    pub mode: JobMode,
    #[serde(default)]
    pub stdin: String,
    pub signature: Option<ProblemSignature>,
    pub tests: Vec<JudgeTest>,
    pub limits: JudgeLimits,
    pub enqueued_at: String,
}

/// The literal `1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Version;

impl Serialize for Version {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u8(1)
    }
}
impl<'de> Deserialize<'de> for Version {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = u64::deserialize(d)?;
        if v == 1 {
            Ok(Version)
        } else {
            Err(serde::de::Error::custom(format!(
                "unsupported contract version {v}"
            )))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TestVerdict {
    Pass,
    Fail,
    Ran,
    RuntimeError,
    TimeLimit,
    MemoryLimit,
    OutputLimit,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeTestResult {
    pub id: String,
    pub verdict: TestVerdict,
    pub time_ms: f64,
    pub actual: Option<Vec<Value>>,
    pub stdout: String,
    pub stderr: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunVerdict {
    Accepted,
    WrongAnswer,
    CompileError,
    RuntimeError,
    TimeLimit,
    MemoryLimit,
    OutputLimit,
    InvalidSubmission,
    Ok,
    InternalError,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileOutcome {
    pub ok: bool,
    pub output: String,
    pub time_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOutcome {
    pub exit_code: Option<i64>,
    pub signal: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub time_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timing {
    pub queue_ms: f64,
    pub total_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SandboxInfo {
    pub runtime: String,
    pub image: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeResult {
    pub v: Version,
    pub run_id: String,
    pub verdict: RunVerdict,
    pub compile: Option<CompileOutcome>,
    pub file: Option<FileOutcome>,
    pub tests: Vec<JudgeTestResult>,
    pub message: Option<String>,
    pub timing: Timing,
    pub sandbox: SandboxInfo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ProgressEvent {
    Started,
    Compiling,
    Running { done: i64, total: i64 },
    Output { stream: OutputStream, chunk: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeProgress {
    pub run_id: String,
    pub event: ProgressEvent,
}
