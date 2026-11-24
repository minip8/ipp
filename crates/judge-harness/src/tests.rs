//! Extraction tests on realistic candidate files.

use super::*;
use ipp_judge_contracts::{JobMode, Language, ProblemSignature};

fn two_sum() -> ProblemSignature {
    serde_json::from_str(
        r#"{"className":"Solution","kind":"function","methods":[{"name":"twoSum",
            "params":[{"name":"nums","type":{"array":"int"}},{"name":"target","type":"int"}],
            "returns":{"array":"int"},"compare":"unordered"}]}"#,
    )
    .unwrap()
}

fn lru() -> ProblemSignature {
    serde_json::from_str(
        r#"{"className":"LRUCache","kind":"design","ctorParams":[{"name":"capacity","type":"int"}],
            "methods":[{"name":"get","params":[{"name":"key","type":"int"}],"returns":"int"},
                       {"name":"put","params":[{"name":"key","type":"int"},{"name":"value","type":"int"}],"returns":"void"}]}"#,
    )
    .unwrap()
}

fn file_text(p: &Prepared, name: &str) -> String {
    String::from_utf8(p.files.iter().find(|(n, _)| n == name).unwrap().1.clone()).unwrap()
}

/// The candidate's part of the C++ translation unit (between the #line markers).
fn cpp_candidate_part(tu: &str) -> &str {
    let start = tu.find("#line 1 \"solution.cpp\"\n").unwrap() + "#line 1 \"solution.cpp\"\n".len();
    let end = tu.find("#line 1 \"[harness]\"").unwrap();
    &tu[start..end]
}

fn assert_same_lines(original: &str, extracted: &str) {
    let a: Vec<&str> = original.lines().collect();
    let b: Vec<&str> = extracted.lines().collect();
    assert_eq!(a.len(), b.len(), "line count changed:\n{extracted}");
    for (i, (x, y)) in a.iter().zip(&b).enumerate() {
        // Same length, and every character either kept or blanked: positions never move.
        let ok = x.len() == y.len() && x.bytes().zip(y.bytes()).all(|(p, q)| p == q || q == b' ');
        assert!(ok, "line {} changed: {x:?} -> {y:?}", i + 1);
    }
}

// ------------------------------------------------------------------ C++

const CPP_FULL: &str = r#"#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
using vi = vector<int>;
#define ALL(x) (x).begin(), (x).end()
#define int long long
const int MOD = 1e9 + 7; // not main()

/* int main() { this is a comment } */
static int helper(int a, int b) { return a + b; }

namespace util {
int main() { return 7; } // not the entry point
}

class Solution {
    struct Node { int v; Node* next; };   // nested
    class Inner { public: int main() { return 1; } };
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        string s = "int main() {";
        unordered_map<int, int> seen;
        for (int i = 0; i < (int)nums.size(); ++i) {
            auto it = seen.find(target - nums[i]);
            if (it != seen.end()) return {it->second, i};
            seen[nums[i]] = i;
        }
        return {};
    }
};

signed main() {
    Solution s;
    vector<int> v{2, 7, 11, 15};
    auto r = s.twoSum(v, 9);
    cout << r[0] << ' ' << r[1] << "main" << '\n';
}
"#;

#[test]
fn cpp_drops_main_keeps_everything_else() {
    let p = cpp::prepare_tests(CPP_FULL, &two_sum()).unwrap();
    let tu = file_text(&p, "main.cpp");
    let cand = cpp_candidate_part(&tu);
    assert_same_lines(CPP_FULL, cand);
    assert!(!cand.contains("signed main"), "main not removed");
    assert!(!cand.contains("cout << r[0]"));
    for kept in [
        "typedef long long ll;",
        "using vi",
        "#define int long long",
        "namespace util",
        "int main() { return 7; }",
        "int main() { return 1; }",
        "\"int main() {\"",
        "/* int main() { this is a comment } */",
        "static int helper",
    ] {
        assert!(cand.contains(kept), "{kept} missing");
    }
    let harness = &tu[tu.find("#line 1 \"[harness]\"").unwrap()..];
    assert!(harness.contains("#undef int\n") && harness.contains("#undef ALL\n"));
    assert!(harness.contains("&C::twoSum"));
    assert!(tu.starts_with("#define main __ipp_user_main\n#line 1 \"solution.cpp\"\n"));
}

#[test]
fn cpp_out_of_class_definitions_struct_and_ifdef_main() {
    let src = r#"#include <vector>
using std::vector;
struct Solution {
    vector<int> twoSum(vector<int>& nums, int target);
};
vector<int> Solution::twoSum(vector<int>& nums, int target) { return {0, 1}; }
#ifdef LOCAL
int main(int argc, char** argv) { return 0; }
#endif
"#;
    let p = cpp::prepare_tests(src, &two_sum()).unwrap();
    let cand = cpp_candidate_part(&file_text(&p, "main.cpp")).to_string();
    assert_same_lines(src, &cand);
    assert!(!cand.contains("argc"));
    assert!(cand.contains("#ifdef LOCAL") && cand.contains("#endif"));
}

#[test]
fn cpp_design_class() {
    let src = r#"class LRUCache {
    int cap;
public:
    LRUCache(int capacity) : cap(capacity) {}
    int get(int key) { return -1; }
    void put(int key, int value) {}
};
"#;
    let p = cpp::prepare_tests(src, &lru()).unwrap();
    let tu = file_text(&p, "main.cpp");
    assert!(tu.contains("auto a0 = ::__ipp::from_json<int>(a[0]);"));
    assert!(tu.contains("C* obj = new C(a0);"));
}

#[test]
fn cpp_invalid_submissions() {
    let sig = two_sum();
    let missing_class = "class Sol { public: vector<int> twoSum(vector<int>& a, int t) { return {}; } };\nint main(){}";
    assert_eq!(
        cpp::prepare_tests(missing_class, &sig).unwrap_err(),
        "class `Solution` not found: the tests call `Solution`, so the file must define it"
    );
    let missing_method =
        "class Solution { public: vector<int> twoSums(vector<int>& a, int t) { return {}; } };";
    assert_eq!(
        cpp::prepare_tests(missing_method, &sig).unwrap_err(),
        "class `Solution` has no method `twoSum`"
    );
    let wrong_arity =
        "class Solution { public: vector<int> twoSum(vector<int>& a) { return {}; } };";
    let e = cpp::prepare_tests(wrong_arity, &sig).unwrap_err();
    assert!(
        e.starts_with(
            "method `twoSum` of class `Solution` takes 1 parameter, but the problem calls it with 2"
        ),
        "{e}"
    );
    let default_arg = "class Solution { public: vector<int> twoSum(vector<int>& a, int t, int x = 0) { return {}; } };";
    assert!(cpp::prepare_tests(default_arg, &sig).is_ok());
    let lru_no_ctor =
        "class LRUCache { public: int get(int k){return 0;} void put(int k, int v){} };";
    let e = cpp::prepare_tests(lru_no_ctor, &lru()).unwrap_err();
    assert!(
        e.starts_with("class `LRUCache` has no constructor taking 1 argument"),
        "{e}"
    );
    let lru_no_put = "class LRUCache { public: LRUCache(int c){} int get(int k){return 0;} };";
    assert_eq!(
        cpp::prepare_tests(lru_no_put, &lru()).unwrap_err(),
        "class `LRUCache` has no method `put`"
    );
}

#[test]
fn cpp_inherited_method() {
    let src = "struct Base { int get(int k) { return k; } void put(int k, int v) {} };\n\
               class LRUCache : public Base { public: LRUCache(int c) {} };";
    assert!(cpp::prepare_tests(src, &lru()).is_ok());
    let src = "class LRUCache : public SomethingElse { public: LRUCache(int c) {} };";
    assert!(
        cpp::prepare_tests(src, &lru()).is_ok(),
        "unknown base may provide the methods"
    );
}

#[test]
fn cpp_diagnostics_hide_harness() {
    let raw = concat!(
        "solution.cpp: In member function 'int Solution::f()':\n",
        "solution.cpp:3:5: error: 'x' was not declared in this scope\n",
        "    3 |     x = 1;\n",
        "      |     ^\n",
        "[harness]:6:107: error: no matching function for call to 'invoke(C&, int (Solution::*)(int), const std::vector<__ipp::Json>&)'\n",
        "    6 |     {\"twoSum\", [](C& o, const std::vector<::__ipp::Json>& a) { return ::__ipp::invoke(o, &C::twoSum, a); }},\n",
        "      |                                                                                                           ^\n",
        "In file included from <command-line>:\n",
        "/opt/ipp/include/ipp/support.h:321:10: note: candidate: 'template<class Obj> __ipp::CallOut __ipp::invoke()'\n",
        "  321 | CallOut invoke(Obj& obj, R (C::*f)(A...) QUAL, const std::vector<Json>& args) {\n",
        "support.h:137:87:   required from 'make_args<...>'\n",
        "  137 |     return std::tuple<std::remove_cvref_t<A>...>{from_json<std::remove_cvref_t<A>>(args[I])...};\n",
        "solution.cpp:9:5: error: 'int __ipp_user_main()' something\n",
    );
    let out = cpp::rewrite_diagnostics(raw);
    assert!(out.contains(
        "solution.cpp:3:5: error: 'x' was not declared in this scope\n    3 |     x = 1;\n"
    ));
    assert!(out.contains("[test harness]: error: no matching function"));
    assert!(!out.contains("[harness]:6"), "{out}");
    assert!(
        !out.contains("return ::__ipp::invoke(o"),
        "harness source leaked:\n{out}"
    );
    assert!(
        !out.contains("CallOut invoke(Obj& obj"),
        "support source leaked:\n{out}"
    );
    assert!(
        !out.contains("return std::tuple"),
        "support source leaked:\n{out}"
    );
    assert!(!out.contains("support.h"));
    assert!(out.contains("'int main()'"));
    assert!(out.contains("note: the test harness could not call your class"));
}

// ------------------------------------------------------------------ Python

const PY_FULL: &str = r#"from typing import List
import sys, collections
sys.setrecursionlimit(10000)
MOD = 10**9 + 7
"""Module docstring mentioning __main__."""

def helper(x):
    return x * 2

class Solution:
    MAGIC = "if __name__ == '__main__':"
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, x in enumerate(nums):
            if target - x in seen:
                return [seen[target - x], i]
            seen[x] = i
        return []

print("top-level side effect")
data = [1, 2, 3]; print(data)
for i in range(3):
    print(i)
Solution().twoSum([1], 1)

if __name__ == "__main__":
    print(Solution().twoSum([2, 7, 11, 15], 9))
    # main()
"#;

#[test]
fn python_keeps_definitions_drops_side_effects() {
    let p = python::prepare_tests(PY_FULL, &two_sum()).unwrap();
    let out = file_text(&p, "solution.py");
    assert_same_lines(PY_FULL, &out);
    for kept in [
        "from typing import List",
        "import sys, collections",
        "sys.setrecursionlimit(10000)",
        "MOD = 10**9 + 7",
        "def helper(x):",
        "MAGIC = \"if __name__ == '__main__':\"",
        "data = [1, 2, 3];",
        "Module docstring",
    ] {
        assert!(out.contains(kept), "{kept} missing:\n{out}");
    }
    for dropped in [
        "print(\"top-level side effect\")",
        "print(data)",
        "for i in range(3)",
        "Solution().twoSum([1], 1)",
        "if __name__ == \"__main__\":",
        "print(Solution()",
    ] {
        assert!(!out.contains(dropped), "{dropped} kept:\n{out}");
    }
}

#[test]
fn python_signature_checks() {
    let sig = two_sum();
    assert_eq!(
        python::prepare_tests("class Sol:\n    def twoSum(self, a, t): pass\n", &sig).unwrap_err(),
        "class `Solution` not found: the tests call `Solution`, so the file must define it at the top level"
    );
    assert_eq!(
        python::prepare_tests("class Solution:\n    def two_sum(self, a, t): pass\n", &sig)
            .unwrap_err(),
        "class `Solution` has no method `twoSum`"
    );
    let e = python::prepare_tests("class Solution:\n    def twoSum(self, a): pass\n", &sig)
        .unwrap_err();
    assert!(
        e.starts_with(
            "method `twoSum` of class `Solution` takes 1 parameter, but the problem calls it with 2"
        ),
        "{e}"
    );
    for ok in [
        "class Solution:\n    def twoSum(self, a, t, extra=None): pass\n",
        "class Solution:\n    def twoSum(self, *args): pass\n",
        "class Solution:\n    @staticmethod\n    def twoSum(a, t): pass\n",
        "class Base:\n    def twoSum(self, a, t): pass\nclass Solution(Base):\n    pass\n",
        "from somewhere import Base\nclass Solution(Base):\n    pass\n",
        "def f(self, a, t): pass\nclass Solution:\n    twoSum = f\n",
    ] {
        assert!(python::prepare_tests(ok, &sig).is_ok(), "{ok}");
    }
    assert!(
        python::prepare_tests(
            "class Solution:\n    @staticmethod\n    def twoSum(a): pass\n",
            &sig
        )
        .is_err(),
        "staticmethod has no self"
    );
    let lru_src = "class LRUCache:\n    def __init__(self, capacity: int) -> None: pass\n    def get(self, key): return -1\n    def put(self, key, value): pass\n";
    assert!(python::prepare_tests(lru_src, &lru()).is_ok());
    let e = python::prepare_tests(
        "class LRUCache:\n    def get(self, key): return -1\n    def put(self, key, value): pass\n",
        &lru(),
    )
    .unwrap_err();
    assert!(
        e.starts_with("class `LRUCache` has no constructor taking 1 argument"),
        "{e}"
    );
}

#[test]
fn python_syntax_error_passes_through() {
    let src = "class Solution:\n    def twoSum(self, nums, target)\n        return []\n";
    let p = python::prepare_tests(src, &two_sum()).unwrap();
    assert_eq!(file_text(&p, "solution.py"), src);
}

// ------------------------------------------------------------------ Java

const JAVA_FULL: &str = r#"package com.example;

import java.util.*;

/* public class Fake { public static void main(String[] a) {} } */
public class Solution {
    private static final String S = "public class Main { }";
    static class Pair { int a, b; }
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            Integer j = seen.get(target - nums[i]);
            if (j != null) return new int[] { j, i };
            seen.put(nums[i], i);
        }
        return new int[0];
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(new Solution().twoSum(new int[] { 2, 7, 11, 15 }, 9)));
    }
}

class Helper { public static int twice(int x) { return 2 * x; } }
"#;

#[test]
fn java_strips_public_and_package() {
    let p = java::prepare_tests(JAVA_FULL, &two_sum()).unwrap();
    assert_eq!(p.class_ref, "Solution");
    let out = file_text(&p, "Main.java");
    assert_same_lines(JAVA_FULL, &out);
    assert!(!out.contains("package com.example"));
    assert!(out.contains("       class Solution {"), "{out}");
    assert!(
        out.contains("    public int[] twoSum"),
        "member modifiers stay"
    );
    assert!(
        out.contains("public static void main"),
        "candidate main stays (never invoked)"
    );
    assert!(out.contains("/* public class Fake"), "comments untouched");
    assert!(
        out.contains("\"public class Main { }\""),
        "strings untouched"
    );
    // columns unchanged
    for (a, b) in JAVA_FULL.lines().zip(out.lines()) {
        assert_eq!(a.len(), b.len());
    }
}

#[test]
fn java_scaffold_layout_and_nested_class() {
    let src = "import java.util.*;\n\nclass Solution {\n    public int[] twoSum(int[] nums, int target) { return null; }\n}\n\npublic class Main {\n    public static void main(String[] args) {}\n}\n";
    let p = java::prepare_tests(src, &two_sum()).unwrap();
    assert!(file_text(&p, "Main.java").contains("       class Main {"));
    let nested = "public class Main {\n    static class Solution {\n        int[] twoSum(int[] a, int t) { return a; }\n    }\n    public static void main(String[] a) {}\n}\n";
    assert_eq!(
        java::prepare_tests(nested, &two_sum()).unwrap().class_ref,
        "Main$Solution"
    );
    let inner = "public class Main {\n    class Solution {\n        int[] twoSum(int[] a, int t) { return a; }\n    }\n}\n";
    assert!(
        java::prepare_tests(inner, &two_sum())
            .unwrap_err()
            .contains("inner (non-static)")
    );
}

#[test]
fn java_signature_checks() {
    let sig = two_sum();
    assert_eq!(
        java::prepare_tests(
            "class Solution { int[] twoSum(int[] a) { return a; } }",
            &sig
        )
        .unwrap_err(),
        "method `twoSum` of class `Solution` takes 1 parameter, but the problem calls it with 2 (nums, target)"
    );
    assert_eq!(
        java::prepare_tests("class Solution { }", &sig).unwrap_err(),
        "class `Solution` has no method `twoSum`"
    );
    assert!(
        java::prepare_tests("class X { }", &sig)
            .unwrap_err()
            .starts_with("class `Solution` not found")
    );
    assert!(
        java::prepare_tests(
            "class Solution { int[] twoSum(int... a) { return a; } }",
            &sig
        )
        .is_ok()
    );
    let lru_ok = "class LRUCache { LRUCache(int c) {} int get(int k) { return -1; } void put(int k, int v) {} }";
    assert!(java::prepare_tests(lru_ok, &lru()).is_ok());
    let lru_bad =
        "class LRUCache { LRUCache() {} int get(int k) { return -1; } void put(int k, int v) {} }";
    assert!(
        java::prepare_tests(lru_bad, &lru())
            .unwrap_err()
            .contains("no constructor taking 1 argument")
    );
    let inherited = "class B { int get(int k) { return 1; } void put(int k, int v) {} }\nclass LRUCache extends B { LRUCache(int c) {} }";
    assert!(java::prepare_tests(inherited, &lru()).is_ok());
}

#[test]
fn java_file_mode_names() {
    let f = java::prepare_file(JAVA_FULL);
    assert_eq!(f.files[0].0, "Solution.java");
    assert_eq!(f.entry, "Solution");
    let f = java::prepare_file(
        "class Solution {}\npublic class Main { public static void main(String[] a) {} }",
    );
    assert_eq!(
        (f.files[0].0.as_str(), f.entry.as_str()),
        ("Main.java", "Main")
    );
    let f = java::prepare_file("class A { public static void main(String[] a) {} }");
    assert_eq!(
        (f.files[0].0.as_str(), f.entry.as_str()),
        ("Main.java", "A")
    );
    // A public class name longer than a file name may be: javac's error, not an unpack failure.
    let long = "A".repeat(300);
    let f = java::prepare_file(&format!(
        "public class {long} {{ public static void main(String[] a) {{}} }}"
    ));
    assert_eq!(f.files[0].0, "Main.java");
}

#[test]
fn java_diagnostics_show_original_line() {
    let original = "import java.util.*;\npublic class Solution {\n    int f() { return x; }\n}\n";
    let javac = "Main.java:3: error: cannot find symbol\n    int f() { return x; }\n                     ^\n  symbol:   variable x\n1 error\n";
    let out = java::rewrite_diagnostics(javac, original);
    assert_eq!(out, javac);
    let javac2 = "Main.java:2: error: something\n       class Solution {\n       ^\n";
    assert!(java::rewrite_diagnostics(javac2, original).contains("\npublic class Solution {\n"));
}

// ------------------------------------------------------------------ protocol

#[test]
fn header_and_test_lines() {
    let h = driver_header(&lru(), "LRUCache", "n0");
    let v: serde_json::Value = serde_json::from_str(&h).unwrap();
    assert_eq!(v["ctorTypes"], serde_json::json!(["int"]));
    assert_eq!(v["methodTypes"]["put"], serde_json::json!(["int", "int"]));
    assert!(h.ends_with('\n') && !h[..h.len() - 1].contains('\n'));
    let t: ipp_judge_contracts::JudgeTest = serde_json::from_str(
        r#"{"id":"x","ctorArgs":[2],"calls":[{"method":"get","args":[1]}],"expected":[1]}"#,
    )
    .unwrap();
    let line = test_line(&t);
    assert!(
        !line.contains("expected"),
        "expected values must never reach the sandbox"
    );
}

#[test]
fn toolchain_commands() {
    let c = toolchain::compile(Language::Cpp, JobMode::Tests, "main.cpp", false).unwrap();
    assert!(c.windows(2).any(|w| w == ["-include", "ipp/support.h"]));
    assert!(toolchain::compile(Language::Python, JobMode::File, "main.py", false).is_none());
    let r = toolchain::run(Language::Java, JobMode::Tests, "", 512, 256);
    assert!(r.contains(&"-Xmx256m".to_string()) && r.last().unwrap() == "256");
}

/// Candidate files can nest tens of thousands of levels deep within the 64 KiB source cap.
/// Extraction runs on a tokio worker thread (2 MiB stack); a recursive walk over such a tree
/// overflowed it and aborted the whole judge process (every in-flight job lost, crash loop on
/// redelivery).
#[test]
fn deeply_nested_files_do_not_overflow_a_worker_stack() {
    let n = 30_000;
    let parens = format!("{}1{}", "(".repeat(n), ")".repeat(n));
    let cases: Vec<(Language, String)> = vec![
        (
            Language::Cpp,
            format!(
                "class Solution {{ public: vector<int> twoSum(vector<int>& a, int t) {{ return {{}}; }} }};\nint x = {parens};\n"
            ),
        ),
        (
            Language::Cpp,
            format!(
                "{}class Solution {{ public: vector<int> twoSum(vector<int>& a, int t) {{ return {{}}; }} }};\n{}",
                "#ifdef A\n".repeat(3500),
                "#endif\n".repeat(3500)
            ),
        ),
        (
            Language::Python,
            format!(
                "class Solution:\n    def twoSum(self, nums, target):\n        return []\nx = {parens}\n"
            ),
        ),
        (
            Language::Java,
            format!(
                "class Solution {{ public int[] twoSum(int[] a, int t) {{ return new int[0]; }} }}\nclass Z {{ int x = {parens}; }}\n"
            ),
        ),
        (
            Language::Java,
            format!(
                "{}class Solution {{ public int[] twoSum(int[] a, int t) {{ return new int[0]; }} }}{}",
                "class A { ".repeat(5000),
                "}".repeat(5000)
            ),
        ),
    ];
    for (lang, src) in cases {
        assert!(src.len() <= 64 * 1024 + 16);
        let r = std::thread::Builder::new()
            .stack_size(2 << 20)
            .spawn(move || {
                let _ = prepare_tests(lang, &src, &two_sum());
                let _ = prepare_file(lang, &src);
            })
            .unwrap()
            .join();
        assert!(r.is_ok(), "{lang:?}");
    }
}
