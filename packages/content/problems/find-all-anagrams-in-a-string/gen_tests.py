"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(s, p):
    sp = sorted(p)
    return [i for i in range(len(s) - len(p) + 1) if sorted(s[i:i + len(p)]) == sp]

def case(id, hidden, s, p, explanation=None):
    exp = mod.Solution().findAnagrams(s, p)
    if len(s) * len(p) <= 200000: assert exp == brute(s, p)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "findAnagrams", "args": [s, p]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(438)
def rand(n, alpha):
    return "".join(rng.choice(alpha) for _ in range(n))
for _ in range(3000):
    s, p = rand(rng.randint(1, 10), "abc"), rand(rng.randint(1, 4), "abc")
    assert mod.Solution().findAnagrams(s, p) == brute(s, p)

tests = [
    case("s1", False, "cbaebabacd", "abc", "\"cba\" at index 0 and \"bac\" at index 6."),
    case("s2", False, "abab", "ab", "Overlapping windows all count."),
    case("s3", False, "aa", "aaa", "p is longer than s."),
    case("h-equal", True, "listen", "silent"),
    case("h-equal-no", True, "listen", "silenx"),
    case("h-single", True, "aaaa", "a"),
    case("h-multiplicity", True, "abcabc", "aab", "Same letters but wrong counts."),
    case("h-none", True, "zzzzzz", "y"),
    case("h-at-end", True, "xxxxxba", "ab"),
]
for k, (n, m, a) in enumerate([(30, 3, "abc"), (300, 5, "ab"), (2000, 20, "abcd"), (5000, 50, "ab")]):
    tests.append(case(f"h-rand-{k}", True, rand(n, a), rand(m, a)))
big = rand(50000, "ab")
tests.append(case("h-large-long-p", True, big, rand(20000, "ab"), "Recounting each window costs ~6e8 steps."))
tests.append(case("h-large-all-match", True, "a" * 30000, "a" * 25000))
tests.append(case("h-large-alpha", True, rand(40000, "abcdefghijklmnopqrstuvwxyz"), "abc"))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
