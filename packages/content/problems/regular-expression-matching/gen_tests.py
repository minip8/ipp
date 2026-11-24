"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against Python's `re.fullmatch`, which has the same semantics for this pattern subset.
"""
import json, random, importlib.util, pathlib, re, sys
from functools import lru_cache
sys.setrecursionlimit(10000)

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def memo_match(s, p):
    """Independent top-down check (used where Python's backtracking re would take forever)."""
    @lru_cache(None)
    def go(i, j):
        if j == len(p):
            return i == len(s)
        first = i < len(s) and p[j] in (s[i], ".")
        if j + 1 < len(p) and p[j + 1] == "*":
            return go(i, j + 2) or (first and go(i + 1, j))
        return first and go(i + 1, j + 1)
    return go(0, 0)


def case(id, hidden, s, p, explanation=None, check=True):
    got = mod.Solution().isMatch(s, p)
    assert got == memo_match(s, p), (s, p)
    if check:
        assert got == bool(re.fullmatch(p, s)), (s, p)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "isMatch", "args": [s, p]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_pattern(rng, alpha, k, star=0.4, dot=0.2):
    out = []
    for _ in range(k):
        out.append("." if rng.random() < dot else rng.choice(alpha))
        if rng.random() < star:
            out.append("*")
    return "".join(out)


def rs(rng, alpha, n):
    return "".join(rng.choice(alpha) for _ in range(n))


def sample_from(rng, p, maxrep=3):
    """A string the pattern matches (by construction)."""
    out, j = [], 0
    while j < len(p):
        c = p[j]
        reps = rng.randint(0, maxrep) if j + 1 < len(p) and p[j + 1] == "*" else 1
        for _ in range(reps):
            out.append(rng.choice("ab") if c == "." else c)
        j += 2 if j + 1 < len(p) and p[j + 1] == "*" else 1
    return "".join(out)


rng = random.Random(10)
for _ in range(3000):
    p = rand_pattern(rng, "ab", rng.randint(1, 6))
    s = rs(rng, "ab", rng.randint(1, 8)) if rng.random() < 0.6 else (sample_from(rng, p) or "a")
    assert mod.Solution().isMatch(s, p) == bool(re.fullmatch(p, s)), (s, p)

tests = [
    case("s1", False, "aab", "c*a*b", "c* matches nothing, a* matches 'aa', b matches 'b'."),
    case("s2", False, "mississippi", "mis*is*p*."),
    case("s3", False, "abcd", ".*d", "'.*' absorbs 'abc'."),
    case("s4", False, "aaa", "a", "The whole string must be matched."),
    case("h-dot-star-fail", True, "ab", ".*c"),
    case("h-star-zero-at-end", True, "a", "ab*", "b* can match nothing after s is used up."),
    case("h-greedy-trap", True, "aaa", "a*a", "A greedy a* would eat all three a's and leave nothing for the final a."),
    case("h-star-applies-left", True, "aa", "a*", "The star repeats the element before it."),
    case("h-not-glob", True, "abc", "a*", "Unlike a glob, a* only repeats 'a'."),
    case("h-dot-single", True, "x", "."),
    case("h-dot-needs-char", True, "ab", "ab."),
    case("h-many-optional", True, "b", "a*b*c*d*e*b"),
    case("h-star-dot-middle", True, "abcxyzdef", "abc.*def"),
    case("h-pattern-longer", True, "a", "a.a*"),
    case("h-repeat-dot-star", True, "zzzz", ".*.*.*.*z"),
]
for k in range(6):
    p = rand_pattern(rng, "abc", rng.randint(4, 12))
    s = sample_from(rng, p, 4) or "a"
    if k % 2:  # near miss: mutate one character until the pattern no longer matches
        for _ in range(50):
            i = rng.randrange(len(s)); t = s[:i] + rng.choice("abc") + s[i + 1:]
            if not memo_match(t, p):
                s = t
                break
    tests.append(case(f"h-rand-{k}", True, s, p))
# Exponential traps for naive backtracking (the reference is O(|s||p|)).
tests.append(case("h-backtrack-trap", True, "a" * 30 + "b", "a*" * 15 + "c",
                  "Plain backtracking tries every way to split the a's between the stars.", check=False))
tests.append(case("h-backtrack-trap-long", True, "a" * 199 + "b", "a*" * 99 + "c", check=False))
tests.append(case("h-backtrack-trap-dot", True, "ab" * 99 + "c", ".*" * 99 + "d", check=False))
tests.append(case("h-backtrack-pass", True, "a" * 199 + "b", "a*" * 99 + "b", check=False))
p_big = rand_pattern(random.Random(7), "ab", 110, star=0.5, dot=0.3)
s_big = sample_from(random.Random(8), p_big, 2)
assert len(p_big) <= 200 and len(s_big) <= 200
tests.append(case("h-large-sampled", True, s_big, p_big, check=False))
p_big2 = rand_pattern(random.Random(9), "abc", 110, star=0.4, dot=0.05)
s_bad = sample_from(random.Random(10), p_big2, 2)
for i in range(len(s_bad) // 2, len(s_bad)):
    t = s_bad[:i] + "c" + s_bad[i + 1:]
    if not memo_match(t, p_big2):
        s_bad = t
        break
tests.append(case("h-large-near-miss", True, s_bad, p_big2, check=False))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
