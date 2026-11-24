"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from collections import Counter

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(s, t):
    need = Counter(t)
    for length in range(len(t), len(s) + 1):
        for i in range(len(s) - length + 1):
            w = Counter(s[i:i + length])
            if all(w[c] >= k for c, k in need.items()): return s[i:i + length]
    return ""

def case(id, hidden, s, t, explanation=None):
    exp = mod.Solution().minWindow(s, t)
    if len(s) <= 60: assert exp == brute(s, t)
    tc = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "minWindow", "args": [s, t]}], "expected": [exp]}
    if explanation: tc["explanation"] = explanation
    return tc

rng = random.Random(76)
def rand(n, alpha):
    return "".join(rng.choice(alpha) for _ in range(n))
for _ in range(3000):
    s, t = rand(rng.randint(1, 12), "abcA"), rand(rng.randint(1, 4), "abcA")
    assert mod.Solution().minWindow(s, t) == brute(s, t), (s, t)

tests = [
    case("s1", False, "XADOBECODEBANC", "ABC"),
    case("s2", False, "aa", "aa"),
    case("s3", False, "a", "aa", "Only one 'a' available."),
    case("s4", False, "abcab", "ab", "Two windows of length 2; return the leftmost."),
    case("h-equal", True, "abc", "cba"),
    case("h-t-longer", True, "ab", "abc"),
    case("h-case-sensitive", True, "aAbBa", "AB"),
    case("h-missing-char", True, "abcdef", "z"),
    case("h-single", True, "z", "z"),
    case("h-duplicates-needed", True, "aabdecaab", "aab"),
    case("h-window-at-end", True, "xxxxxxyz", "zy"),
    case("h-shrink-surplus", True, "aaaaaaaaab", "ab", "Many surplus a's must be dropped from the left."),
]
for k, (n, m, a) in enumerate([(30, 3, "abc"), (60, 5, "abcdE"), (500, 10, "abcdefgh"), (2000, 30, "abcdefghijklmnopqrstuvwxyzABCD")]):
    tests.append(case(f"h-rand-{k}", True, rand(n, a), rand(m, a)))
letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
big = rand(80000, letters)
tests.append(case("h-large-random", True, big, rand(60, letters)))
tests.append(case("h-large-long-t", True, rand(60000, "ab"), rand(25000, "ab")))
tests.append(case("h-large-none", True, "a" * 70000, "ab"))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
