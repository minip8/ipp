//! End-to-end judging through real sandbox containers: reference solutions, every type shape,
//! every failure verdict, and attacks on the sandbox.

mod common;

use common::*;
use ipp_judge_contracts::*;
use serde_json::{Value, json};

use Language::{Cpp, Java, Python};

macro_rules! skip_if_disabled {
    () => {
        if common::skip() {
            eprintln!("skipped: IPP_JUDGE_SKIP_SANDBOX_TESTS=1");
            return;
        }
    };
}

fn problem(name: &str) -> ProblemContent {
    let p = repo()
        .join("packages/contracts/fixtures")
        .join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn content_tests(t: &[TestCase]) -> Vec<JudgeTest> {
    t.iter()
        .map(|t| JudgeTest {
            id: t.id.clone(),
            ctor_args: t.ctor_args.clone(),
            calls: t.calls.clone(),
            expected: Some(t.expected.clone()),
        })
        .collect()
}

// ------------------------------------------------------------------ reference solutions

#[tokio::test]
async fn two_sum_reference_solutions_are_accepted() {
    skip_if_disabled!();
    let p = problem("problem-two-sum");
    let tests: Vec<TestCase> = serde_json::from_str(
        &std::fs::read_to_string(repo().join("packages/content/problems/two-sum/tests.json"))
            .unwrap(),
    )
    .unwrap();
    assert!(tests.len() >= 10);
    let dir = repo().join("packages/content/problems/two-sum");
    let jobs: Vec<JudgeJob> = [
        (Cpp, "solution.cpp"),
        (Python, "solution.py"),
        (Java, "solution.java"),
    ]
    .iter()
    .map(|(l, f)| {
        tests_job(
            *l,
            &std::fs::read_to_string(dir.join(f)).unwrap(),
            p.signature.clone(),
            content_tests(&tests),
        )
    })
    .collect();
    let results = futures_util::future::join_all(jobs.iter().map(run)).await;
    for r in results {
        check!(r, r.verdict == RunVerdict::Accepted);
        check!(
            r,
            r.tests.len() == tests.len() && r.tests.iter().all(|t| t.verdict == TestVerdict::Pass)
        );
    }
}

const LRU_JAVA: &str = r#"import java.util.*;

public class LRUCache {
    private final int cap;
    private final LinkedHashMap<Integer, Integer> map = new LinkedHashMap<>(16, 0.75f, true);

    public LRUCache(int capacity) { cap = capacity; }

    public int get(int key) { return map.getOrDefault(key, -1); }

    public void put(int key, int value) {
        map.put(key, value);
        if (map.size() > cap) map.remove(map.keySet().iterator().next());
    }

    public static void main(String[] args) {
        LRUCache c = new LRUCache(1);
        c.put(1, 1);
        System.out.println(c.get(1));
    }
}
"#;

#[tokio::test]
async fn design_problem_lru_cache_in_all_languages() {
    skip_if_disabled!();
    let p = problem("problem-lru-cache");
    let mut tests = content_tests(&p.tests);
    tests.push(test(
        "update-refreshes",
        json!([2]),
        &[
            ("put", json!([1, 1])),
            ("put", json!([2, 2])),
            ("put", json!([1, 10])),
            ("put", json!([3, 3])),
            ("get", json!([2])),
            ("get", json!([1])),
        ],
        Some(json!([null, null, null, null, -1, 10])),
    ));
    let mut sources = vec![
        (Cpp, p.reference_solutions[&Cpp].clone()),
        (Python, p.reference_solutions[&Python].clone()),
    ];
    sources.push((Java, LRU_JAVA.to_string()));
    let jobs: Vec<JudgeJob> = sources
        .iter()
        .map(|(l, s)| tests_job(*l, s, p.signature.clone(), tests.clone()))
        .collect();
    for r in futures_util::future::join_all(jobs.iter().map(run)).await {
        check!(r, r.verdict == RunVerdict::Accepted);
        check!(
            r,
            r.tests[0].actual
                == Some(vec![
                    json!(null),
                    json!(null),
                    json!(1),
                    json!(null),
                    json!(-1)
                ])
        );
    }
    // A wrong implementation (never evicts) fails on the right call.
    let wrong = "class LRUCache:\n    def __init__(self, capacity):\n        self.d = {}\n    def get(self, key):\n        return self.d.get(key, -1)\n    def put(self, key, value):\n        self.d[key] = value\n";
    let r = run(&tests_job(Python, wrong, p.signature.clone(), tests)).await;
    check!(r, r.verdict == RunVerdict::WrongAnswer);
    check!(
        r,
        r.tests[0].message.as_deref() == Some("call 5 (get): expected -1, got 2")
    );
}

// ------------------------------------------------------------------ every type shape

fn types_sig() -> ProblemSignature {
    let m = |name: &str, params: Vec<Value>, returns: Value| json!({"name": name, "params": params, "returns": returns});
    let p = |name: &str, ty: Value| json!({"name": name, "type": ty});
    sig(json!({
        "className": "Echo", "kind": "design",
        "ctorParams": [p("tag", json!("string"))],
        "methods": [
            m("fInt", vec![p("x", json!("int"))], json!("int")),
            m("fLong", vec![p("x", json!("long"))], json!("long")),
            m("fDouble", vec![p("x", json!("double")), p("y", json!("double"))], json!("double")),
            m("fBool", vec![p("x", json!("bool"))], json!("bool")),
            m("fString", vec![p("x", json!("string"))], json!("string")),
            m("fChar", vec![p("x", json!("char"))], json!("char")),
            m("fArr", vec![p("x", json!({"array": "int"}))], json!({"array": "int"})),
            m("fNested", vec![p("x", json!({"array": {"array": "long"}}))], json!({"array": {"array": "long"}})),
            m("fListStr", vec![p("x", json!({"list": {"list": "string"}}))], json!({"list": {"list": "string"}})),
            m("fListDbl", vec![p("x", json!({"list": {"array": "double"}}))], json!({"list": {"array": "double"}})),
            m("fChars", vec![p("x", json!({"array": "char"}))], json!({"array": "char"})),
            m("fBools", vec![p("x", json!({"list": "bool"}))], json!({"list": "bool"})),
            m("setTag", vec![p("t", json!("string"))], json!("void")),
            m("getTag", vec![], json!("string")),
        ]
    }))
}

const TYPES_CPP: &str = r#"#include <bits/stdc++.h>
using namespace std;
class Echo {
    string tag;
public:
    Echo(string t) : tag(t) {}
    int fInt(int x) { return x + 1; }
    long long fLong(long long x) { return x - 1; }
    double fDouble(double x, double y) { return x + y; }
    bool fBool(bool x) { return !x; }
    string fString(const string& x) { return x + "|" + x; }
    char fChar(char x) { return x; }
    vector<int> fArr(vector<int>& x) { reverse(x.begin(), x.end()); return x; }
    vector<vector<long long>> fNested(vector<vector<long long>> x) { x.push_back({}); return x; }
    vector<vector<string>> fListStr(const vector<vector<string>>& x) { return x; }
    vector<vector<double>> fListDbl(vector<vector<double>> x) { for (auto& r : x) for (auto& v : r) v *= 2; return x; }
    vector<char> fChars(vector<char> x) { sort(x.begin(), x.end()); return x; }
    vector<bool> fBools(vector<bool> x) { x.flip(); return x; }
    void setTag(string t) { tag = t; }
    string getTag() const { return tag; }
};
"#;

const TYPES_PY: &str = r#"class Echo:
    def __init__(self, tag: str):
        self.tag = tag
    def fInt(self, x): return x + 1
    def fLong(self, x): return x - 1
    def fDouble(self, x, y): return x + y
    def fBool(self, x): return not x
    def fString(self, x): return x + "|" + x
    def fChar(self, x): return x
    def fArr(self, x): return x[::-1]
    def fNested(self, x): return x + [[]]
    def fListStr(self, x): return x
    def fListDbl(self, x): return [[v * 2 for v in r] for r in x]
    def fChars(self, x): return sorted(x)
    def fBools(self, x): return tuple(not b for b in x)
    def setTag(self, t): self.tag = t
    def getTag(self): return self.tag
"#;

const TYPES_JAVA: &str = r#"import java.util.*;
class Echo {
    private String tag;
    public Echo(String t) { tag = t; }
    public int fInt(int x) { return x + 1; }
    public long fLong(long x) { return x - 1; }
    public double fDouble(double x, double y) { return x + y; }
    public boolean fBool(boolean x) { return !x; }
    public String fString(String x) { return x + "|" + x; }
    public char fChar(char x) { return x; }
    public int[] fArr(int[] x) { int[] r = new int[x.length]; for (int i = 0; i < x.length; i++) r[i] = x[x.length - 1 - i]; return r; }
    public long[][] fNested(long[][] x) { long[][] r = Arrays.copyOf(x, x.length + 1); r[x.length] = new long[0]; return r; }
    public List<List<String>> fListStr(List<List<String>> x) { return x; }
    public List<double[]> fListDbl(List<double[]> x) { for (double[] r : x) for (int i = 0; i < r.length; i++) r[i] *= 2; return x; }
    public char[] fChars(char[] x) { Arrays.sort(x); return x; }
    public List<Boolean> fBools(List<Boolean> x) { List<Boolean> r = new ArrayList<>(); for (Boolean b : x) r.add(!b); return r; }
    public void setTag(String t) { tag = t; }
    public String getTag() { return tag; }
}
"#;

#[tokio::test]
async fn every_type_shape_round_trips() {
    skip_if_disabled!();
    let unicode = "héllo \"q\" \\ / \n\t\u{1}😀 中文";
    let t = test(
        "all",
        json!(["tag-é"]),
        &[
            ("fInt", json!([41])),
            ("fInt", json!([-2147483648i64 + 1])),
            ("fLong", json!([9007199254740991i64])),
            ("fLong", json!([-9007199254740990i64])),
            ("fDouble", json!([0.1, 0.2])),
            ("fDouble", json!([1e-7, 0])),
            ("fDouble", json!([-2.5, 1e300])),
            ("fBool", json!([true])),
            ("fString", json!([unicode])),
            ("fString", json!([""])),
            ("fChar", json!(["x"])),
            ("fChar", json!(["\""])),
            ("fArr", json!([[1, 2, 3]])),
            ("fArr", json!([[]])),
            ("fNested", json!([[[1, 2], [], [9007199254740991i64]]])),
            ("fListStr", json!([[["a", "ü"], [], ["\n"]]])),
            ("fListDbl", json!([[[0.25, 1.5], []]])),
            ("fChars", json!([["c", "a", "b"]])),
            ("fBools", json!([[true, false]])),
            ("getTag", json!([])),
            ("setTag", json!(["new\ttag"])),
            ("getTag", json!([])),
        ],
        Some(json!([
            42,
            -2147483646,
            9007199254740990i64,
            -9007199254740991i64,
            0.3,
            1e-7,
            1e300,
            false,
            format!("{unicode}|{unicode}"),
            "|",
            "x",
            "\"",
            [3, 2, 1],
            [],
            [[1, 2], [], [9007199254740991i64], []],
            [["a", "ü"], [], ["\n"]],
            [[0.5, 3.0], []],
            ["a", "b", "c"],
            [false, true],
            "tag-é",
            null,
            "new\ttag"
        ])),
    );
    let jobs: Vec<JudgeJob> = [(Cpp, TYPES_CPP), (Python, TYPES_PY), (Java, TYPES_JAVA)]
        .iter()
        .map(|(l, s)| tests_job(*l, s, types_sig(), vec![t.clone()]))
        .collect();
    for r in futures_util::future::join_all(jobs.iter().map(run)).await {
        check!(r, r.verdict == RunVerdict::Accepted);
        let actual = r.tests[0].actual.as_ref().unwrap();
        check!(r, actual[8] == json!(format!("{unicode}|{unicode}")));
        check!(r, actual[20] == Value::Null);
    }
}

// ------------------------------------------------------------------ verdicts

#[tokio::test]
async fn wrong_answer_custom_tests_and_captured_prints() {
    skip_if_disabled!();
    let src = "class Solution:\n    def twoSum(self, nums, target):\n        print('debug', len(nums))\n        import sys; print('warn', file=sys.stderr)\n        return [0, 1]\n";
    let tests = vec![
        call1("s1", "twoSum", json!([[2, 7, 11, 15], 9]), json!([1, 0])),
        call1("s2", "twoSum", json!([[3, 2, 4], 6]), json!([1, 2])),
        test("c1", json!([]), &[("twoSum", json!([[5, 5], 10]))], None),
    ];
    let r = run(&tests_job(Python, src, two_sum_sig(), tests)).await;
    check!(r, r.verdict == RunVerdict::WrongAnswer);
    check!(
        r,
        verdicts(&r) == vec![TestVerdict::Pass, TestVerdict::Fail, TestVerdict::Ran]
    );
    check!(
        r,
        r.tests[1].message.as_deref() == Some("call 1 (twoSum): expected [1,2], got [0,1]")
    );
    check!(
        r,
        r.tests[0].stdout == "debug 4\n"
            && r.tests[1].stdout == "debug 3\n"
            && r.tests[2].stdout == "debug 2\n"
    );
    check!(r, r.tests[0].stderr == "warn\n");
    check!(r, r.compile.is_none());
    // only custom tests -> ok
    let r = run(&tests_job(
        Python,
        src,
        two_sum_sig(),
        vec![test("c1", json!([]), &[("twoSum", json!([[1], 1]))], None)],
    ))
    .await;
    check!(
        r,
        r.verdict == RunVerdict::Ok && r.tests[0].actual == Some(vec![json!([0, 1])])
    );
}

#[tokio::test]
async fn compile_errors_point_at_candidate_lines() {
    skip_if_disabled!();
    // C++: error on line 6 of the candidate's file; main and a macro are present.
    let cpp = "#include <bits/stdc++.h>\nusing namespace std;\n#define ll long long\nclass Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) { return undefined_name; }\n};\nint main() { return 0; }\n";
    let r = run(&tests_job(
        Cpp,
        cpp,
        two_sum_sig(),
        vec![call1("s1", "twoSum", json!([[1, 2], 3]), json!([0, 1]))],
    ))
    .await;
    check!(r, r.verdict == RunVerdict::CompileError);
    let out = &r.compile.as_ref().unwrap().output;
    check!(
        r,
        out.contains("solution.cpp:6:") && out.contains("undefined_name")
    );
    check!(
        r,
        !out.contains("__ipp") && !out.contains("harness") && !out.contains("support.h")
    );
    check!(r, r.tests.is_empty());

    // C++: the candidate's types do not fit the signature -> error in the harness, source hidden.
    let cpp_sig = "#include <map>\nclass Solution { public: int twoSum(std::map<int, int> nums, int target) { return 0; } };\n";
    let r = run(&tests_job(
        Cpp,
        cpp_sig,
        two_sum_sig(),
        vec![call1("s1", "twoSum", json!([[1, 2], 3]), json!([0, 1]))],
    ))
    .await;
    check!(r, r.verdict == RunVerdict::CompileError);
    let out = &r.compile.as_ref().unwrap().output;
    check!(
        r,
        out.contains("[test harness]")
            && out.contains("could not call your class")
            && out.contains("unsupported parameter type")
    );
    check!(
        r,
        !out.contains("::__ipp::invoke(o") && !out.contains("[harness]:")
    );

    // Java: error on line 4; `public` was stripped but the original line is echoed.
    let java = "import java.util.*;\n\npublic class Solution {\n    public int[] twoSum(int[] nums, int target) { return nums.lenght; }\n}\n";
    let r = run(&tests_job(
        Java,
        java,
        two_sum_sig(),
        vec![call1("s1", "twoSum", json!([[1, 2], 3]), json!([0, 1]))],
    ))
    .await;
    check!(r, r.verdict == RunVerdict::CompileError);
    let out = &r.compile.as_ref().unwrap().output;
    check!(
        r,
        out.contains("Main.java:4: error")
            && out.contains(
                "    public int[] twoSum(int[] nums, int target) { return nums.lenght; }"
            )
    );

    // Python: syntax error on line 3, reported as a compile error with the right line.
    let py = "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1\n\nprint('x')\n";
    let r = run(&tests_job(
        Python,
        py,
        two_sum_sig(),
        vec![call1("s1", "twoSum", json!([[1, 2], 3]), json!([0, 1]))],
    ))
    .await;
    check!(r, r.verdict == RunVerdict::CompileError);
    let out = &r.compile.as_ref().unwrap().output;
    check!(
        r,
        out.contains("line 3") && out.contains("SyntaxError") && !out.contains("driver")
    );
}

/// Test "boom" crashes the process (or throws); the tests after it must still be judged.
#[tokio::test]
async fn runtime_error_mid_batch_keeps_later_tests() {
    skip_if_disabled!();
    let sig = two_sum_sig();
    let tests = vec![
        call1("ok1", "twoSum", json!([[2, 7], 9]), json!([0, 1])),
        call1("boom", "twoSum", json!([[-1, 0], -1]), json!([0, 1])),
        call1("throw", "twoSum", json!([[-2, 0], -2]), json!([0, 1])),
        call1("ok2", "twoSum", json!([[1, 3], 4]), json!([0, 1])),
    ];
    let cpp = r#"#include <bits/stdc++.h>
using namespace std;
class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        if (target == -1) { int* p = nullptr; volatile int x = *p; (void)x; }
        if (target == -2) return {nums.at(5)};
        return {0, 1};
    }
};
"#;
    let py = "class Solution:\n    def twoSum(self, nums, target):\n        if target == -1:\n            import os; os._exit(3)\n        if target == -2:\n            return [nums[5]]\n        return [0, 1]\n";
    let java = "class Solution {\n    int[] twoSum(int[] nums, int target) {\n        if (target == -1) Runtime.getRuntime().halt(9);\n        if (target == -2) return new int[] { nums[5] };\n        return new int[] { 0, 1 };\n    }\n}\n";
    let jobs: Vec<JudgeJob> = [(Cpp, cpp), (Python, py), (Java, java)]
        .iter()
        .map(|(l, s)| tests_job(*l, s, sig.clone(), tests.clone()))
        .collect();
    for r in futures_util::future::join_all(jobs.iter().map(run)).await {
        check!(r, r.verdict == RunVerdict::RuntimeError);
        check!(
            r,
            verdicts(&r)
                == vec![
                    TestVerdict::Pass,
                    TestVerdict::RuntimeError,
                    TestVerdict::RuntimeError,
                    TestVerdict::Pass
                ]
        );
        let boom = r.tests[1].message.clone().unwrap_or_default();
        let throw = r.tests[2].message.clone().unwrap_or_default();
        match r.sandbox.image.as_str() {
            i if i.contains("cpp") => {
                check!(r, boom.contains("SIGSEGV"));
                check!(r, throw.contains("std::out_of_range"));
            }
            i if i.contains("python") => {
                check!(r, boom.contains("exited with code 3"));
                check!(
                    r,
                    throw.contains("IndexError")
                        && throw.contains("solution.py\", line 6")
                        && !throw.contains("driver.py")
                );
            }
            _ => {
                check!(r, boom.contains("exited with code 9"));
                check!(
                    r,
                    throw.contains("ArrayIndexOutOfBoundsException")
                        && throw.contains("Main.java:4")
                        && !throw.contains("IppDriver")
                );
            }
        }
    }
}

#[tokio::test]
async fn infinite_loop_is_time_limit_and_later_tests_run() {
    skip_if_disabled!();
    let sig = two_sum_sig();
    let tests = vec![
        call1("ok1", "twoSum", json!([[2, 7], 9]), json!([0, 1])),
        call1("loop", "twoSum", json!([[1, 1], -1]), json!([0, 1])),
        call1("ok2", "twoSum", json!([[1, 3], 4]), json!([0, 1])),
    ];
    let cpp = "#include <bits/stdc++.h>\nusing namespace std;\nclass Solution { public: vector<int> twoSum(vector<int>& n, int t) { volatile long long x = 0; if (t == -1) for (;;) x++; return {0, 1}; } };\n";
    let py = "class Solution:\n    def twoSum(self, n, t):\n        while t == -1:\n            pass\n        return [0, 1]\n";
    let java = "class Solution { int[] twoSum(int[] n, int t) { while (t == -1) { Thread.onSpinWait(); } return new int[] {0, 1}; } }\n";
    let jobs: Vec<JudgeJob> = [(Cpp, cpp), (Python, py), (Java, java)]
        .iter()
        .map(|(l, s)| tests_job(*l, s, sig.clone(), tests.clone()))
        .collect();
    for r in futures_util::future::join_all(jobs.iter().map(run)).await {
        check!(r, r.verdict == RunVerdict::TimeLimit);
        check!(
            r,
            verdicts(&r) == vec![TestVerdict::Pass, TestVerdict::TimeLimit, TestVerdict::Pass]
        );
    }
}

#[tokio::test]
async fn memory_blowup_is_memory_limit() {
    skip_if_disabled!();
    let sig = two_sum_sig();
    let tests = vec![
        call1("hog", "twoSum", json!([[1, 1], -1]), json!([0, 1])),
        call1("ok", "twoSum", json!([[1, 3], 4]), json!([0, 1])),
    ];
    // C++: grows until the kernel kills it (no RLIMIT_AS): cgroup OOM -> memory_limit.
    let cpp = "#include <bits/stdc++.h>\nusing namespace std;\nclass Solution { public: vector<int> twoSum(vector<int>& n, int t) { if (t == -1) { vector<vector<char>> v; for (;;) v.emplace_back(1 << 20, 'x'); } return {0, 1}; } };\n";
    // Python: grows past the limit in chunks.
    let py = "class Solution:\n    def twoSum(self, n, t):\n        if t == -1:\n            hog = []\n            while True:\n                hog.append(bytearray(16 << 20))\n        return [0, 1]\n";
    // Java: OutOfMemoryError against -Xmx.
    let java = "import java.util.*;\nclass Solution { int[] twoSum(int[] n, int t) { if (t == -1) { List<long[]> l = new ArrayList<>(); for (;;) l.add(new long[1 << 20]); } return new int[] {0, 1}; } }\n";
    let jobs: Vec<JudgeJob> = [(Cpp, cpp), (Python, py), (Java, java)]
        .iter()
        .map(|(l, s)| tests_job(*l, s, sig.clone(), tests.clone()))
        .collect();
    for r in futures_util::future::join_all(jobs.iter().map(run)).await {
        check!(r, r.verdict == RunVerdict::MemoryLimit);
        check!(
            r,
            verdicts(&r) == vec![TestVerdict::MemoryLimit, TestVerdict::Pass]
        );
    }
    // Using more than the limit without exhausting the container is still memory_limit.
    let cpp_400 = "#include <bits/stdc++.h>\nusing namespace std;\nvector<char> keep;\nclass Solution { public: vector<int> twoSum(vector<int>& n, int t) { keep.assign(400 << 20, 1); long s = 0; for (size_t i = 0; i < keep.size(); i += 4096) s += keep[i]; return {0, (int)(s > 0)}; } };\n";
    let r = run(&tests_job(
        Cpp,
        cpp_400,
        sig,
        vec![call1("big", "twoSum", json!([[1], 1]), json!([0, 1]))],
    ))
    .await;
    check!(r, r.verdict == RunVerdict::MemoryLimit);
    // File mode.
    let file = "#include <bits/stdc++.h>\nint main() { std::vector<char*> v; for (;;) { char* p = (char*)malloc(1 << 20); memset(p, 1, 1 << 20); v.push_back(p); } }\n";
    let r = run(&file_job(Cpp, file, "")).await;
    check!(r, r.verdict == RunVerdict::MemoryLimit);
    let r = run(&file_job(Java, "public class Main { public static void main(String[] a) { long[][] x = new long[100000][]; for (int i = 0;; i++) x[i] = new long[1 << 20]; } }", "")).await;
    check!(r, r.verdict == RunVerdict::MemoryLimit);
}

/// With a long time limit, runaway growth reaches the container's memory limit before the time
/// limit. Under gVisor that used to stop the whole sandbox (the host kills the sandbox kernel,
/// where application memory lives) and came back as `internal_error`. The supervisor now kills
/// the program inside the sandbox once it is resident in more than `memoryMb`, so the sandbox
/// survives and later tests run in it.
#[tokio::test]
async fn memory_blowup_with_a_long_time_limit() {
    skip_if_disabled!();
    let sig = two_sum_sig();
    let limits = ProblemLimits {
        time_ms: 10_000,
        memory_mb: 256,
    };
    let tests = vec![
        call1("hog", "twoSum", json!([[1, 1], -1]), json!([0, 1])),
        call1("ok", "twoSum", json!([[1, 3], 4]), json!([0, 1])),
    ];
    let cpp = "#include <bits/stdc++.h>\nusing namespace std;\nclass Solution { public: vector<int> twoSum(vector<int>& n, int t) { if (t == -1) { vector<vector<char>> v; for (;;) v.emplace_back(1 << 20, 'x'); } return {0, 1}; } };\n";
    let py = "class Solution:\n    def twoSum(self, n, t):\n        if t == -1:\n            hog = []\n            while True:\n                hog.append(bytearray(16 << 20))\n        return [0, 1]\n";
    let jobs: Vec<JudgeJob> = [(Cpp, cpp), (Python, py)]
        .iter()
        .map(|(l, s)| tests_job_limits(*l, s, sig.clone(), tests.clone(), limits))
        .collect();
    for r in futures_util::future::join_all(jobs.iter().map(run)).await {
        check!(
            r,
            r.verdict == RunVerdict::MemoryLimit
                && verdicts(&r) == vec![TestVerdict::MemoryLimit, TestVerdict::Pass]
                && r.tests[0].time_ms < 9000.0
        );
    }
    let mut cpp_file = file_job(
        Cpp,
        "#include <bits/stdc++.h>\nint main() { std::vector<char*> v; for (;;) { char* p = (char*)malloc(1 << 20); memset(p, 1, 1 << 20); v.push_back(p); } }\n",
        "",
    );
    let mut py_file = file_job(
        Python,
        "hog = []\nwhile True:\n    hog.append(bytearray(16 << 20))\n",
        "",
    );
    // Memory spread over several processes counts as a whole (each child stays under the limit).
    let mut forked = file_job(
        Cpp,
        "#include <bits/stdc++.h>\n#include <unistd.h>\n#include <sys/wait.h>\nchar* keep;\nint main() { for (int k = 0; k < 4; k++) if (fork() == 0) { keep = (char*)malloc(100 << 20); memset(keep, 1, 100 << 20); sleep(20); return 0; } while (wait(nullptr) > 0) {} }\n",
        "",
    );
    for job in [&mut cpp_file, &mut py_file, &mut forked] {
        job.limits.run_ms = 10_000;
        job.limits.memory_mb = 256;
    }
    let jobs = [cpp_file, py_file, forked];
    for r in futures_util::future::join_all(jobs.iter().map(run)).await {
        check!(
            r,
            r.verdict == RunVerdict::MemoryLimit
                && r.file.as_ref().is_some_and(|f| f.time_ms < 9000.0)
        );
    }
}

/// The backstop: a program that stops its supervisor (same uid) and then exhausts the
/// container's memory. Under gVisor that stops the whole sandbox; under runc the kernel kills the
/// program and the stopped supervisor never reports. Either way that test is `memory_limit`, the
/// job continues in a fresh sandbox, and a program that does it on every test costs at most
/// `MAX_SANDBOX_REPLACEMENTS + 1` sandboxes (the remaining tests are not run).
#[tokio::test]
async fn breaking_the_sandbox_costs_a_test_then_stops_the_job() {
    skip_if_disabled!();
    let py = "import os, signal\nclass Solution:\n    def twoSum(self, n, t):\n        if t == -1:\n            os.kill(os.getppid(), signal.SIGSTOP)\n            hog = []\n            while True:\n                hog.append(bytearray(16 << 20))\n        return [0, 1]\n";
    let hog = |id: &str| call1(id, "twoSum", json!([[1], -1]), json!([0, 1]));
    let ok = |id: &str| call1(id, "twoSum", json!([[1], 1]), json!([0, 1]));
    let mut job = tests_job(Python, py, two_sum_sig(), vec![ok("a"), hog("h1"), ok("b")]);
    job.limits.total_ms = 60_000;
    let r = run(&job).await;
    check!(
        r,
        verdicts(&r)
            == vec![
                TestVerdict::Pass,
                TestVerdict::MemoryLimit,
                TestVerdict::Pass
            ]
            && r.verdict == RunVerdict::MemoryLimit
    );

    let tests = vec![hog("h1"), ok("a"), hog("h2"), hog("h3"), ok("b"), hog("h4")];
    let mut job = tests_job(Python, py, two_sum_sig(), tests);
    job.limits.total_ms = 120_000;
    let started = std::time::Instant::now();
    let r = run(&job).await;
    check!(
        r,
        verdicts(&r)
            == vec![
                TestVerdict::MemoryLimit,
                TestVerdict::Pass,
                TestVerdict::MemoryLimit,
                TestVerdict::MemoryLimit,
                TestVerdict::RuntimeError,
                TestVerdict::RuntimeError,
            ]
    );
    check!(
        r,
        message(&r.tests[4]).starts_with("not run: the program broke its sandbox 3 times")
            && r.verdict == RunVerdict::MemoryLimit
    );
    check!(r, started.elapsed().as_secs() < 90);
}

#[tokio::test]
async fn output_flood_is_output_limit() {
    skip_if_disabled!();
    let sig = two_sum_sig();
    let tests = vec![
        call1("flood", "twoSum", json!([[1, 1], -1]), json!([0, 1])),
        call1("ok", "twoSum", json!([[1, 3], 4]), json!([0, 1])),
    ];
    let cpp = "#include <bits/stdc++.h>\nusing namespace std;\nclass Solution { public: vector<int> twoSum(vector<int>& n, int t) { if (t == -1) for (;;) cout << \"spam spam spam\\n\"; return {0, 1}; } };\n";
    let r = run(&tests_job(Cpp, cpp, sig, tests)).await;
    check!(r, r.verdict == RunVerdict::OutputLimit);
    check!(
        r,
        verdicts(&r) == vec![TestVerdict::OutputLimit, TestVerdict::Pass]
    );
    check!(
        r,
        r.tests[0].stdout.len() <= 65536 && r.tests[0].stdout.starts_with("spam spam spam\n")
    );
    check!(r, r.tests[1].stdout.is_empty());

    let r = run(&file_job(
        Python,
        "while True:\n    print('x' * 1000)\n",
        "",
    ))
    .await;
    check!(r, r.verdict == RunVerdict::OutputLimit);
    let f = r.file.as_ref().unwrap();
    check!(r, f.truncated && f.stdout.len() == 65536);
}

// ------------------------------------------------------------------ file mode

#[tokio::test]
async fn file_mode_all_languages() {
    skip_if_disabled!();
    let cpp = "#include <iostream>\n#include <string>\nint main() { std::string s; std::cin >> s; std::cout << \"hi \" << s << std::endl; std::cerr << \"e\"; return 0; }\n";
    let py = "import sys\nname = input()\nprint('hi', name)\nprint('e', file=sys.stderr, end='')\n";
    let java = "import java.util.*;\npublic class Hello {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.println(\"hi \" + sc.next());\n        System.err.print(\"e\");\n    }\n}\n";
    let jobs: Vec<JudgeJob> = [(Cpp, cpp), (Python, py), (Java, java)]
        .iter()
        .map(|(l, s)| file_job(*l, s, "wörld\n"))
        .collect();
    for r in futures_util::future::join_all(jobs.iter().map(run)).await {
        check!(r, r.verdict == RunVerdict::Ok);
        let f = r.file.as_ref().unwrap();
        check!(
            r,
            f.stdout == "hi wörld\n" && f.stderr == "e" && f.exit_code == Some(0) && !f.truncated
        );
    }
    // nonzero exit, signal, time limit, compile error
    let r = run(&file_job(Python, "import sys\nsys.exit(4)\n", "")).await;
    check!(
        r,
        r.verdict == RunVerdict::RuntimeError && r.file.as_ref().unwrap().exit_code == Some(4)
    );
    let r = run(&file_job(
        Cpp,
        "#include <cstdlib>\nint main() { abort(); }\n",
        "",
    ))
    .await;
    check!(
        r,
        r.verdict == RunVerdict::RuntimeError
            && r.file.as_ref().unwrap().signal.as_deref() == Some("SIGABRT")
    );
    let mut job = file_job(Python, "while True:\n    pass\n", "");
    job.limits.run_ms = 1500;
    let r = run(&job).await;
    check!(
        r,
        r.verdict == RunVerdict::TimeLimit && r.file.as_ref().unwrap().time_ms < 4000.0
    );
    let r = run(&file_job(Cpp, "int main() {\n  return x;\n}\n", "")).await;
    check!(
        r,
        r.verdict == RunVerdict::CompileError
            && r.compile
                .as_ref()
                .unwrap()
                .output
                .contains("solution.cpp:2:")
    );
}

// ------------------------------------------------------------------ invalid submissions

#[tokio::test]
async fn invalid_submissions_never_reach_the_sandbox() {
    skip_if_disabled!();
    let t = vec![call1("s1", "twoSum", json!([[1, 2], 3]), json!([0, 1]))];
    let cases = [
        (
            Cpp,
            "class Sol { public: vector<int> twoSum(vector<int>& a, int t) { return {}; } };",
            "class `Solution` not found",
        ),
        (
            Python,
            "class Solution:\n    def two_sum(self, a, t):\n        return []\n",
            "class `Solution` has no method `twoSum`",
        ),
        (
            Java,
            "class Solution { int[] twoSum(int[] a) { return a; } }",
            "takes 1 parameter, but the problem calls it with 2",
        ),
    ];
    for (lang, src, msg) in cases {
        let r = run(&tests_job(lang, src, two_sum_sig(), t.clone())).await;
        check!(r, r.verdict == RunVerdict::InvalidSubmission);
        check!(r, r.message.as_deref().unwrap_or("").contains(msg));
        check!(
            r,
            r.compile.is_none() && r.tests.is_empty() && r.timing.total_ms < 200.0
        );
    }
}

#[tokio::test]
async fn java_public_solution_class_with_its_own_main() {
    skip_if_disabled!();
    let src = "import java.util.*;\n\npublic class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        Map<Integer, Integer> m = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            Integer j = m.get(target - nums[i]);\n            if (j != null) return new int[] { j, i };\n            m.put(nums[i], i);\n        }\n        return new int[0];\n    }\n\n    public static void main(String[] args) {\n        System.out.println(\"never called\");\n        System.exit(1);\n    }\n}\n";
    let r = run(&tests_job(
        Java,
        src,
        two_sum_sig(),
        vec![call1("s1", "twoSum", json!([[3, 2, 4], 6]), json!([1, 2]))],
    ))
    .await;
    check!(
        r,
        r.verdict == RunVerdict::Accepted && r.tests[0].stdout.is_empty()
    );
}

// ------------------------------------------------------------------ attacks

#[tokio::test]
async fn fork_bomb_is_contained() {
    skip_if_disabled!();
    // Count how many processes can be created before fork fails (pids limit), then bomb.
    let count = "#include <bits/stdc++.h>\n#include <unistd.h>\nint main() { int n = 0; for (int i = 0; i < 1000; i++) { pid_t p = fork(); if (p < 0) break; if (p == 0) { pause(); _exit(0); } n++; } printf(\"%d\\n\", n); }\n";
    let r = run(&file_job(Cpp, count, "")).await;
    let n: i64 = r.file.as_ref().unwrap().stdout.trim().parse().unwrap_or(-1);
    check!(r, r.verdict == RunVerdict::Ok && (1..64).contains(&n));

    let bomb = "#include <unistd.h>\nint main() { for (;;) fork(); }\n";
    let mut job = file_job(Cpp, bomb, "");
    job.limits.run_ms = 2000;
    let started = std::time::Instant::now();
    let r = run(&job).await;
    check!(
        r,
        matches!(r.verdict, RunVerdict::TimeLimit | RunVerdict::RuntimeError)
    );
    check!(r, started.elapsed().as_secs() < 30);
    // Python fork bomb through os.fork in tests mode; later test still judged.
    let py = "import os\nclass Solution:\n    def twoSum(self, n, t):\n        if t == -1:\n            while True:\n                try:\n                    os.fork()\n                except OSError:\n                    pass\n        return [0, 1]\n";
    let tests = vec![
        call1("bomb", "twoSum", json!([[1], -1]), json!([0, 1])),
        call1("ok", "twoSum", json!([[1], 1]), json!([0, 1])),
    ];
    let r = run(&tests_job(Python, py, two_sum_sig(), tests)).await;
    check!(
        r,
        r.tests[1].verdict == TestVerdict::Pass && r.tests[0].verdict != TestVerdict::Pass
    );
}

/// Under gVisor the host pids limit also counts the sandbox kernel's own threads (and it dies
/// when it cannot create one), so there the program's task limit is RLIMIT_NPROC inside the
/// sandbox; the JVM (~20 threads of its own) must still have room for a real thread pool.
#[tokio::test]
async fn java_has_room_for_threads() {
    skip_if_disabled!();
    let java = r#"import java.util.*;
public class Main {
    public static void main(String[] a) throws Exception {
        List<Thread> ts = new ArrayList<>();
        for (int i = 0; i < 64; i++) { Thread t = new Thread(() -> { try { Thread.sleep(500); } catch (InterruptedException e) {} }); t.start(); ts.add(t); }
        for (Thread t : ts) t.join();
        System.out.println("threads " + ts.size());
    }
}
"#;
    let r = run(&file_job(Java, java, "")).await;
    check!(
        r,
        r.verdict == RunVerdict::Ok && r.file.as_ref().unwrap().stdout == "threads 64\n"
    );
    // A thread bomb in tests mode: the driver survives it and the next test runs.
    let bomb = "import java.util.*;\nclass Solution { int[] twoSum(int[] n, int t) { if (t == -1) { List<Thread> l = new ArrayList<>(); try { for (;;) { Thread x = new Thread(() -> { try { Thread.sleep(3000); } catch (InterruptedException e) {} }); x.setDaemon(true); x.start(); l.add(x); } } catch (Throwable e) { return new int[] { l.size() }; } } return new int[] {0, 1}; } }\n";
    let tests = vec![
        call1("bomb", "twoSum", json!([[1], -1]), json!([0, 1])),
        call1("ok", "twoSum", json!([[1], 1]), json!([0, 1])),
    ];
    let r = run(&tests_job(Java, bomb, two_sum_sig(), tests)).await;
    check!(
        r,
        r.tests[0].verdict != TestVerdict::Pass && r.tests[1].verdict == TestVerdict::Pass
    );
}

/// Nothing a program starts outlives it: a daemonised child that keeps the output pipe open is
/// killed when the program exits.
#[tokio::test]
async fn orphans_do_not_outlive_their_program() {
    skip_if_disabled!();
    let cpp = "#include <cstdio>\n#include <unistd.h>\nint main() { if (fork() == 0) { setsid(); if (fork() == 0) { for (int i = 0; i < 100; i++) { sleep(1); printf(\"late\\n\"); fflush(stdout); } } return 0; } printf(\"parent done\\n\"); return 0; }\n";
    let started = std::time::Instant::now();
    let r = run(&file_job(Cpp, cpp, "")).await;
    let f = r.file.as_ref().unwrap();
    check!(
        r,
        r.verdict == RunVerdict::Ok && f.stdout == "parent done\n" && f.time_ms < 3000.0
    );
    check!(r, started.elapsed().as_secs() < 30);
}

/// In file mode the program shares a uid with its supervisor too: killing it is a runtime
/// error, stopping it is a time limit; neither is the judge's failure.
#[tokio::test]
async fn file_mode_supervisor_attacks_are_verdicts() {
    skip_if_disabled!();
    let r = run(&file_job(
        Python,
        "import os, signal\nprint('bye', flush=True)\nos.kill(os.getppid(), signal.SIGKILL)\n",
        "",
    ))
    .await;
    check!(r, r.verdict == RunVerdict::RuntimeError);
    let mut job = file_job(
        Python,
        "import os, signal, time\nos.kill(os.getppid(), signal.SIGSTOP)\ntime.sleep(100)\n",
        "",
    );
    job.limits.run_ms = 1000;
    let started = std::time::Instant::now();
    let r = run(&job).await;
    check!(r, r.verdict == RunVerdict::TimeLimit);
    check!(r, started.elapsed().as_secs() < 30);
}

#[tokio::test]
async fn huge_files_and_read_only_root() {
    skip_if_disabled!();
    // /var/tmp is world-writable on the image, so only a read-only root stops it (/etc would
    // already fail on permissions). /tmp is an explicit read-only mount under both runtimes:
    // without it gVisor provides a writable, memory-backed tmpfs there.
    let cpp = r#"#include <bits/stdc++.h>
int main() {
    for (const char* p : {"/var/tmp/x", "/tmp/x", "/etc/owned", "/x"}) {
        FILE* f = fopen(p, "w");
        printf("%s:%s\n", p, f ? "WRITABLE" : strerror(errno));
    }
    fflush(stdout);
    FILE* f = fopen("/work/big", "w");
    std::string chunk(1 << 20, 'x');
    for (long i = 0;; i++) { if (fwrite(chunk.data(), 1, chunk.size(), f) != chunk.size()) { printf("short write after %ld MB: %s\n", i, strerror(errno)); return 1; } fflush(f); }
}
"#;
    let r = run(&file_job(Cpp, cpp, "")).await;
    let f = r.file.as_ref().unwrap();
    check!(
        r,
        f.stdout.contains("/var/tmp/x:Read-only file system\n")
            && f.stdout.contains("/tmp/x:Read-only file system\n")
            && !f.stdout.contains("WRITABLE")
    );
    // RLIMIT_FSIZE (16 MB) kills it with SIGXFSZ before the 64 MB tmpfs fills up.
    check!(
        r,
        r.verdict == RunVerdict::RuntimeError && f.signal.as_deref() == Some("SIGXFSZ")
    );
    check!(
        r,
        r.message
            .as_deref()
            .unwrap_or("")
            .contains("file size limit")
    );
}

/// The tmpfs caps hold when a program fills them with many files under the 16 MB file-size
/// limit: 64 MB on /work, 1 MB on /dev/shm, and a cap on the number of files.
#[tokio::test]
async fn many_files_hit_the_tmpfs_caps() {
    skip_if_disabled!();
    let cpp = r#"#include <bits/stdc++.h>
#include <sys/stat.h>
int fill(const char* dir, size_t size, const char* label) {
    std::string chunk(size, 'x');
    int n = 0;
    for (;; n++) {
        std::string p = std::string(dir) + "/f" + std::to_string(n);
        FILE* f = fopen(p.c_str(), "w");
        if (!f) break;
        bool ok = fwrite(chunk.data(), 1, size, f) == size;
        if (fclose(f) != 0 || !ok) break;
    }
    printf("%s %d %s\n", label, n, strerror(errno));
    fflush(stdout);
    return n;
}
int main() {
    fill("/work", 1 << 20, "work");
    system("rm -f /work/f*");
    fill("/dev/shm", 64 << 10, "shm");
    system("rm -f /dev/shm/f*");
    mkdir("/work/many", 0700);
    fill("/work/many", 0, "empty");
}
"#;
    let r = run(&file_job(Cpp, cpp, "")).await;
    check!(r, r.file.is_some());
    let out = r.file.as_ref().unwrap().stdout.clone();
    let count = |label: &str| -> i64 {
        out.lines()
            .find_map(|l| l.strip_prefix(label))
            .and_then(|l| l.split_whitespace().next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(-1)
    };
    check!(
        r,
        (60..64).contains(&count("work ")) && out.contains("No space left on device")
    );
    check!(r, (1..=16).contains(&count("shm ")));
    if gvisor() {
        // gVisor ignores the tmpfs nr_inodes option (and each inode costs it ~1 KiB of its own
        // memory), so the supervisor kills a program that creates too many files.
        check!(
            r,
            r.verdict == RunVerdict::RuntimeError
                && r.message
                    .as_deref()
                    .unwrap_or("")
                    .contains("too many files")
        );
    } else {
        check!(
            r,
            r.verdict == RunVerdict::Ok && (8000..8192).contains(&count("empty "))
        );
    }
    // The next test in the same sandbox is not affected by the files left behind.
    let py = "import os\nclass Solution:\n    def twoSum(self, n, t):\n        if t == -1:\n            os.makedirs('/work/m', exist_ok=True)\n            try:\n                for i in range(20000):\n                    open(f'/work/m/{i}', 'w').close()\n            except OSError:\n                pass\n        return [0, 1]\n";
    let tests = vec![
        call1("files", "twoSum", json!([[1], -1]), json!([0, 1])),
        call1("ok", "twoSum", json!([[1], 1]), json!([0, 1])),
    ];
    let r = run(&tests_job(Python, py, two_sum_sig(), tests)).await;
    let first = if gvisor() {
        TestVerdict::RuntimeError
    } else {
        TestVerdict::Pass // ENOSPC, caught by the program
    };
    check!(r, verdicts(&r) == vec![first, TestVerdict::Pass]);
}

#[tokio::test]
async fn no_network() {
    skip_if_disabled!();
    let py = r#"import socket
for target in [("1.1.1.1", 53), ("8.8.8.8", 443), ("172.17.0.1", 6379), ("127.0.0.1", 6379)]:
    try:
        socket.create_connection(target, timeout=2)
        print(target, "CONNECTED")
    except OSError as e:
        print(target, "failed", e.errno)
try:
    socket.getaddrinfo("example.com", 80)
    print("dns RESOLVED")
except OSError as e:
    print("dns failed")
print(sorted(i[1] for i in socket.if_nameindex()))
"#;
    let r = run(&file_job(Python, py, "")).await;
    let out = &r.file.as_ref().unwrap().stdout;
    check!(r, r.verdict == RunVerdict::Ok);
    check!(
        r,
        !out.contains("CONNECTED") && !out.contains("RESOLVED") && out.contains("dns failed")
    );
    if gvisor() {
        // gVisor's netstack with NetworkMode=none has no interface at all, not even loopback
        // (127.0.0.1 is unreachable rather than refused).
        check!(r, out.contains("\n[]\n"));
    } else {
        check!(r, out.contains("['lo']"));
    }
}

/// Nothing secret is reachable from inside: no expected outputs, no later tests, no environment,
/// no privileges.
#[tokio::test]
async fn sandbox_holds_nothing_secret() {
    skip_if_disabled!();
    let py = r#"import os
def scan():
    seen = []
    for root in ["/work", "/tmp", "/opt/ipp", "/run", "/home", "/root"]:
        for dirpath, dirs, files in os.walk(root):
            for name in files:
                p = os.path.join(dirpath, name)
                try:
                    with open(p, "rb") as f:
                        seen.append(f.read(1 << 20))
                except Exception:
                    pass
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            for part in ("environ", "cmdline"):
                try:
                    with open(f"/proc/{pid}/{part}", "rb") as f:
                        seen.append(f.read())
                except Exception:
                    pass
    try:
        os.set_blocking(3, False)
        seen.append(os.read(3, 1 << 20))
    except Exception as e:
        seen.append(repr(e).encode())
    finally:
        os.set_blocking(3, True)
    blob = b"\n".join(seen)
    status = open("/proc/self/status").read()
    caps = [l for l in status.splitlines() if l.startswith(("CapEff", "CapPrm", "NoNewPrivs", "Uid"))]
    return blob, caps

class Solution:
    def twoSum(self, nums, target):
        blob, caps = scan()
        text = blob.decode("latin-1")
        # built at run time so the candidate's own source does not contain them
        print("SECRET-" + "EXPECTED" in text, "LATER-" + "INPUT" in text)
        print(caps)
        print(sorted(os.environ))
        return [0, 1]
"#;
    let tests = vec![
        call1(
            "probe",
            "twoSum",
            json!([[1, 2], 3]),
            json!(["SECRET-EXPECTED-123"]),
        ),
        call1(
            "later",
            "twoSum",
            json!([["LATER-INPUT-456"], 3]),
            json!([0, 1]),
        ),
    ];
    let r = run(&tests_job(Python, py, two_sum_sig(), tests)).await;
    let out = &r.tests[0].stdout;
    check!(r, out.starts_with("False False\n"));
    check!(r, r.tests[1].stdout.starts_with("False False\n"));
    check!(
        r,
        out.contains("CapEff:\\t0000000000000000")
            && out.contains("NoNewPrivs:\\t1")
            && out.contains("Uid:\\t10001")
    );
    for secret in [
        "REDIS",
        "ANTHROPIC",
        "DATABASE",
        "SECRET",
        "PASSWORD",
        "TOKEN",
        "DOCKER",
    ] {
        check!(r, !out.split('\n').nth(2).unwrap_or("").contains(secret));
    }
}

/// The candidate shares a uid with the supervisor and can kill it; that only loses its own test.
#[tokio::test]
async fn killing_the_supervisor_only_hurts_the_current_test() {
    skip_if_disabled!();
    let py = "import os, signal\nclass Solution:\n    def twoSum(self, n, t):\n        if t == -1:\n            os.kill(os.getppid(), signal.SIGKILL)\n            os.kill(-1, signal.SIGKILL)\n        return [0, 1]\n";
    let tests = vec![
        call1("a", "twoSum", json!([[1], 1]), json!([0, 1])),
        call1("kill", "twoSum", json!([[1], -1]), json!([0, 1])),
        call1("b", "twoSum", json!([[1], 1]), json!([0, 1])),
    ];
    let r = run(&tests_job(Python, py, two_sum_sig(), tests)).await;
    check!(
        r,
        r.tests[0].verdict == TestVerdict::Pass && r.tests[2].verdict == TestVerdict::Pass
    );
    check!(r, r.tests[1].verdict == TestVerdict::RuntimeError);
}

#[tokio::test]
async fn total_budget_skips_remaining_tests() {
    skip_if_disabled!();
    let py = "import time\nclass Solution:\n    def twoSum(self, n, t):\n        time.sleep(0.9)\n        return [0, 1]\n";
    let tests: Vec<JudgeTest> = (0..6)
        .map(|i| call1(&format!("t{i}"), "twoSum", json!([[1], 1]), json!([0, 1])))
        .collect();
    let mut job = tests_job(Python, py, two_sum_sig(), tests);
    job.limits.total_ms = 3000;
    let r = run(&job).await;
    check!(r, r.verdict == RunVerdict::TimeLimit);
    check!(
        r,
        r.tests[0].verdict == TestVerdict::Pass && r.tests[5].verdict == TestVerdict::Skipped
    );
    check!(r, r.timing.total_ms < 8000.0);
}

/// The candidate can SIGSTOP its supervisor right after a result is relayed; the judge's write of
/// the next (large) test then filled the exec stream's buffers and blocked forever, holding the
/// job's slot for good. Writes to the supervisor are now bounded.
#[tokio::test]
async fn stopping_the_supervisor_cannot_hang_the_judge() {
    skip_if_disabled!();
    let cpp = r#"#include <bits/stdc++.h>
#include <sys/ioctl.h>
#include <signal.h>
#include <unistd.h>
using namespace std;
static atomic<int> calls{0};
static void watcher() {
    while (calls.load() < 1) usleep(100);
    int n = 0;
    while (true) { ioctl(1, FIONREAD, &n); if (n > 0) break; }
    while (true) { ioctl(1, FIONREAD, &n); if (n == 0) break; }
    usleep(150);
    kill(getppid(), SIGSTOP);
}
static int start = [] { thread(watcher).detach(); return 0; }();
class Solution { public:
    vector<int> twoSum(vector<int>& a, int t) { calls++; return {0, 1}; }
};
"#;
    let big: Vec<i64> = vec![1; 220_000];
    let tests = vec![
        call1("a", "twoSum", json!([[2, 7], 9]), json!([0, 1])),
        call1("big", "twoSum", json!([big, 9]), json!([0, 1])),
        call1("b", "twoSum", json!([[2, 7], 9]), json!([0, 1])),
    ];
    let mut job = tests_job(Cpp, cpp, two_sum_sig(), tests);
    job.limits.total_ms = 20_000;
    let started = std::time::Instant::now();
    let r = tokio::time::timeout(std::time::Duration::from_secs(90), run(&job))
        .await
        .expect("the judge hung on a stopped supervisor");
    // Print the whole result if there are no per-test results (seen once under gVisor under load).
    check!(r, !r.tests.is_empty());
    check!(r, r.tests[0].verdict == TestVerdict::Pass);
    check!(r, started.elapsed().as_secs() < 60);
}

/// A return value is bounded by the result-frame cap, not by the 256 MiB output backstop (the
/// judge used ~30 bytes of memory per byte of returned JSON).
#[tokio::test]
async fn huge_return_value_is_rejected_not_buffered() {
    skip_if_disabled!();
    let cpp = "#include <bits/stdc++.h>\nusing namespace std;\nclass Solution { public: vector<int> twoSum(vector<int>& a, int t) { if (t < 0) return vector<int>(3000000, 0); return {0, 1}; } };\n";
    let tests = vec![
        call1("huge", "twoSum", json!([[1], -1]), json!([0, 1])),
        call1("ok", "twoSum", json!([[1], 1]), json!([0, 1])),
    ];
    let r = run(&tests_job(Cpp, cpp, two_sum_sig(), tests)).await;
    check!(
        r,
        r.tests[0].verdict == TestVerdict::RuntimeError
            && r.tests[0].actual.is_none()
            && r.tests[0]
                .message
                .as_deref()
                .unwrap_or("")
                .contains("too large")
    );
    check!(r, r.tests[1].verdict == TestVerdict::Pass);
}
