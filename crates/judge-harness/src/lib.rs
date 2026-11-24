//! Everything about turning a candidate's file into something the sandbox can run, and making
//! sense of what comes back: class extraction (tree-sitter), the generated C++ harness, the
//! driver protocol (header/test lines, nonce frames) and compiler-diagnostic rewriting.
//!
//! Image layout this crate relies on (see `infra/sandbox`): `/opt/ipp/ipp-run` (supervisor),
//! `/opt/ipp/include/ipp/{support,stdcxx}.h[.gch]` + `/opt/ipp/lib/libippdriver.a` (C++), `/opt/ipp/driver.py` (Python),
//! `/opt/ipp/ipp-driver.jar` + `/opt/ipp/{javac,driver}.jsa` (Java). Work directory `/work`.

pub mod cpp;
pub mod frames;
pub mod java;
pub mod python;
pub mod ts;
pub mod verify;

use ipp_judge_contracts::{JudgeTest, Language, ProblemSignature};
use serde_json::{Value, json};

/// Files for tests mode, ready to be put in the work directory.
#[derive(Debug, Clone)]
pub struct Prepared {
    pub files: Vec<(String, Vec<u8>)>,
    /// How the driver finds the class (Java binary name, e.g. `Main$Solution` for a nested class).
    pub class_ref: String,
}

/// Files for file mode.
#[derive(Debug, Clone)]
pub struct PreparedFile {
    pub files: Vec<(String, Vec<u8>)>,
    /// C++/Python: the source file; Java: the class with `main`.
    pub entry: String,
    pub use_stdcxx_pch: bool,
}

/// Builds the tests-mode files, or returns the `invalid_submission` message.
pub fn prepare_tests(
    lang: Language,
    source: &str,
    sig: &ProblemSignature,
) -> Result<Prepared, String> {
    match lang {
        Language::Cpp => cpp::prepare_tests(source, sig),
        Language::Python => python::prepare_tests(source, sig),
        Language::Java => java::prepare_tests(source, sig),
    }
}

pub fn prepare_file(lang: Language, source: &str) -> PreparedFile {
    match lang {
        Language::Cpp => cpp::prepare_file(source),
        Language::Python => python::prepare_file(source),
        Language::Java => java::prepare_file(source),
    }
}

/// First line the driver reads on fd 3.
pub fn driver_header(sig: &ProblemSignature, class_ref: &str, nonce: &str) -> String {
    let method_types: serde_json::Map<String, Value> = sig
        .methods
        .iter()
        .map(|m| {
            (
                m.name.clone(),
                json!(m.params.iter().map(|p| &p.ty).collect::<Vec<_>>()),
            )
        })
        .collect();
    let ctor: Vec<_> = sig.ctor_params.iter().map(|p| &p.ty).collect();
    let mut s = json!({
        "nonce": nonce,
        "className": class_ref,
        "ctorTypes": ctor,
        "methodTypes": method_types,
    })
    .to_string();
    s.push('\n');
    s
}

/// One test as the driver reads it (expected values are never sent).
pub fn test_line(t: &JudgeTest) -> String {
    let mut s = json!({ "ctorArgs": t.ctor_args, "calls": t.calls }).to_string();
    s.push('\n');
    s
}

pub fn rewrite_diagnostics(lang: Language, output: &str, original_source: &str) -> String {
    match lang {
        Language::Cpp => cpp::rewrite_diagnostics(output),
        Language::Java => java::rewrite_diagnostics(output, original_source),
        Language::Python => output.to_string(),
    }
}

/// Commands and resource settings per language. These must match the images in `infra/sandbox`.
pub mod toolchain {
    use ipp_judge_contracts::{JobMode, Language};

    pub const WORKDIR: &str = "/work";
    pub const SUPERVISOR: &str = "/opt/ipp/ipp-run";
    /// Must match the flags the precompiled headers were built with (infra/sandbox/cpp/Dockerfile).
    pub const CXXFLAGS: &[&str] = &["-std=c++23", "-O2", "-D_GLIBCXX_ASSERTIONS", "-pipe"];

    pub fn env(lang: Language) -> Vec<String> {
        let mut e = vec![
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string(),
            "HOME=/work".to_string(),
            "LANG=C.UTF-8".to_string(),
            "TMPDIR=/work/.tmp".to_string(),
        ];
        match lang {
            Language::Java => e.push("JAVA_HOME=/opt/java/openjdk".into()),
            Language::Python => e.push("PYTHONDONTWRITEBYTECODE=1".into()),
            Language::Cpp => {}
        }
        if lang == Language::Java {
            e[0] = "PATH=/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".into();
        }
        e
    }

    /// Compile command (run in WORKDIR), or None when the language has no compile step.
    pub fn compile(
        lang: Language,
        mode: JobMode,
        file: &str,
        use_stdcxx_pch: bool,
    ) -> Option<Vec<String>> {
        let s = |x: &str| x.to_string();
        match lang {
            Language::Cpp => {
                let mut v = vec![s("g++")];
                v.extend(CXXFLAGS.iter().map(|f| s(f)));
                v.extend(
                    [
                        "-fdiagnostics-color=never",
                        "-fmax-errors=20",
                        "-I/opt/ipp/include",
                    ]
                    .map(s),
                );
                match mode {
                    JobMode::Tests => v.extend(["-include", "ipp/support.h"].map(s)),
                    JobMode::File if use_stdcxx_pch => {
                        v.extend(["-include", "ipp/stdcxx.h"].map(s))
                    }
                    JobMode::File => {}
                }
                v.extend(["-o", "main", file].map(s));
                if mode == JobMode::Tests {
                    // non-template driver code, prebuilt with the same flags (infra/sandbox/cpp/support.cpp)
                    v.push("/opt/ipp/lib/libippdriver.a".into());
                }
                Some(v)
            }
            Language::Java => Some(
                [
                    "javac",
                    "-J-XX:SharedArchiveFile=/opt/ipp/javac.jsa",
                    "-J-Xshare:auto",
                    // the CDS archive is usable but logs module-property mismatches to stdout
                    "-J-Xlog:disable",
                    "-J-Xlog:all=off",
                    "-J-XX:+UseSerialGC",
                    "-J-XX:TieredStopAtLevel=1",
                    "-J-Xmx384m",
                    "-J-XX:-UsePerfData",
                    "-J-XX:ActiveProcessorCount=1",
                    "-encoding",
                    "UTF-8",
                    "-proc:none",
                    "-Xmaxerrs",
                    "50",
                    "-d",
                    "classes",
                    file,
                ]
                .map(s)
                .to_vec(),
            ),
            Language::Python => None,
        }
    }

    /// Java heap: the language allowance (limits.ts adds 256 MB for Java) goes to the JVM itself.
    pub fn java_heap_mb(memory_mb: i64) -> i64 {
        (memory_mb - 256).max(64)
    }

    fn java(memory_mb: i64, shared_archive: bool) -> Vec<String> {
        let mut v = vec!["java".to_string()];
        if shared_archive {
            v.push("-XX:SharedArchiveFile=/opt/ipp/driver.jsa".into());
        }
        v.extend(
            [
                "-Xshare:auto",
                "-XX:+UseSerialGC",
                "-XX:-UsePerfData",
                "-XX:ActiveProcessorCount=1",
                "-XX:MaxMetaspaceSize=128m",
                "-XX:ReservedCodeCacheSize=64m",
                "-XX:+ExitOnOutOfMemoryError",
            ]
            .map(String::from),
        );
        v.push(format!("-Xmx{}m", java_heap_mb(memory_mb)));
        v
    }

    /// Program command (run in WORKDIR). Tests mode reads tests on fd 3.
    pub fn run(
        lang: Language,
        mode: JobMode,
        entry: &str,
        memory_mb: i64,
        stack_mb: i64,
    ) -> Vec<String> {
        let s = |x: &str| x.to_string();
        match (lang, mode) {
            (Language::Cpp, _) => vec![s("./main")],
            (Language::Python, JobMode::Tests) => {
                ["python3", "-I", "/opt/ipp/driver.py"].map(s).to_vec()
            }
            (Language::Python, JobMode::File) => vec![s("python3"), s("-I"), s("-u"), s(entry)],
            (Language::Java, JobMode::Tests) => {
                let mut v = java(memory_mb, true);
                // OutOfMemoryError is caught per test by the driver; exiting would lose the rest.
                v.retain(|a| a != "-XX:+ExitOnOutOfMemoryError");
                v.extend(["-cp", "/opt/ipp/ipp-driver.jar:classes", "IppDriver"].map(s));
                v.push(stack_mb.to_string());
                v
            }
            (Language::Java, JobMode::File) => {
                let mut v = java(memory_mb, false);
                v.push("-Xss64m".into());
                v.extend(["-cp", "classes", entry].map(s));
                v
            }
        }
    }

    /// cgroup pids limit (threads count too: the JVM needs a few dozen).
    pub fn pids_limit(lang: Language) -> i64 {
        match lang {
            Language::Java => 128,
            _ => 64,
        }
    }

    /// Container memory needed to compile, independent of the job's run limit.
    pub fn compile_memory_mb(lang: Language) -> i64 {
        match lang {
            Language::Cpp => 768,
            Language::Java => 640,
            Language::Python => 0,
        }
    }

    pub fn nofile(lang: Language) -> i64 {
        match lang {
            Language::Java => 512,
            _ => 128,
        }
    }
}

#[cfg(test)]
mod tests;
