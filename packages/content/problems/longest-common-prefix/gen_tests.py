"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, os

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, words, explanation=None):
    exp = os.path.commonprefix(words)
    assert mod.Solution().longestCommonPrefix(list(words)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "longestCommonPrefix", "args": [words]}],
         "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(14)
def word(n, alpha="abc"):
    return "".join(rng.choice(alpha) for _ in range(n))
for _ in range(3000):
    ws = [word(rng.randint(0, 4), "ab") for _ in range(rng.randint(1, 4))]
    assert mod.Solution().longestCommonPrefix(ws) == os.path.commonprefix(ws)

def with_prefix(p, count, extra):
    return [p + word(rng.randint(0, extra)) for _ in range(count)]

tests = [
    case("s1", False, ["interview", "internet", "interval"]),
    case("s2", False, ["cpp", "python", "java"]),
    case("s3", False, ["same", "same"]),
    case("s4", False, ["ab", "", "abc"], "An empty word has only the empty prefix."),
    case("h-single", True, ["alone"]),
    case("h-single-empty", True, [""]),
    case("h-prefix-is-word", True, ["flowers", "flow", "flowchart"]),
    case("h-shortest-last", True, ["abcd", "abcd", "a"]),
    case("h-differs-at-end", True, ["abcx", "abcy"]),
    case("h-first-char-differs", True, ["xyz", "ayz", "xyz"]),
    case("h-all-empty", True, ["", "", ""]),
]
for k, (p, c, e) in enumerate([(word(3), 5, 4), (word(10), 50, 10), ("", 20, 5), (word(40), 300, 30)]):
    tests.append(case(f"h-rand-{k}", True, with_prefix(p, c, e)))
long_p = word(1000, "z")
tests.append(case("h-large-identical", True, [long_p] * 100))
tests.append(case("h-large-late-break", True, [long_p] * 99 + [long_p[:-1] + "y"]))
tests.append(case("h-large-many", True, with_prefix(word(20), 2000, 20)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
