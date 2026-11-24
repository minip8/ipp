"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from itertools import combinations

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(s, t):
    return sum(1 for idx in combinations(range(len(s)), len(t)) if all(s[i] == c for i, c in zip(idx, t)))


def exact(s, t):
    """Exact big-integer DP, also reporting the largest intermediate count."""
    ways, peak = [1] + [0] * len(t), 1
    for ch in s:
        for j in range(len(t), 0, -1):
            if t[j - 1] == ch:
                ways[j] += ways[j - 1]
                peak = max(peak, ways[j])
    return ways[len(t)], peak


def case(id, hidden, s, t, explanation=None):
    got = mod.Solution().numDistinct(s, t)
    want, peak = exact(s, t)
    assert got == want < 2**31, (id, want)
    t_ = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "numDistinct", "args": [s, t]}],
          "expected": [got]}
    if explanation: t_["explanation"] = explanation
    return t_, peak


def rs(rng, alpha, n):
    return "".join(rng.choice(alpha) for _ in range(n))


rng = random.Random(115)
for _ in range(400):
    s, t = rs(rng, "ab", rng.randint(1, 12)), rs(rng, "ab", rng.randint(1, 5))
    assert mod.Solution().numDistinct(s, t) == brute(s, t), (s, t)

entries = [
    case("s1", False, "banana", "ban", "b at 0, an a at 1 or 3, then a later n: (0,1,2), (0,1,4), (0,3,4)."),
    case("s2", False, "aaa", "aa", "Pairs of positions (0,1), (0,2), (1,2)."),
    case("s3", False, "abc", "abcd", "t is longer than s."),
    case("h-equal", True, "interview", "interview"),
    case("h-single", True, "x", "x"),
    case("h-no-match", True, "abcdef", "z"),
    case("h-count-char", True, "mississippi", "s"),
    case("h-order-matters", True, "ba", "ab"),
    case("h-classic-shape", True, "aabbccddee", "abcde", "2^5 = 32 independent choices."),
    case("h-repeat-reuse-trap", True, "ab", "aab", "Iterating j upward would reuse the single 'a'."),
]
for k, (n, m, alpha) in enumerate([(12, 3, "ab"), (40, 4, "abc"), (100, 6, "abcd"), (300, 8, "abcdefgh")]):
    s = rs(rng, alpha, n)
    entries.append(case(f"h-rand-{k}", True, s, "".join(rng.choice(s) for _ in range(m))))
# Answer near the top of the 32-bit range: C(110, 6) = 2141851635.
entries.append(case("h-near-int-max", True, "q" * 110, "q" * 6, "C(110, 6) = 2141851635, just below 2^31."))
entries.append(case("h-big-answer", True, "abc" * 20, "abcab"))
# Huge intermediate counts but small final answers: overflow traps for signed 32/64-bit arithmetic.
entries.append(case("h-overflow-zero", True, "a" * 1000, "a" * 30 + "b",
                    "Answer 0, but forming 'a'*30 alone has C(1000, 30) ~ 10^57 ways along the way."))
entries.append(case("h-overflow-small", True, "a" * 999 + "b", "a" * 998 + "b",
                    "Intermediate counts like C(999, 499) are enormous; the answer is 999."))
entries.append(case("h-overflow-mixed", True, "a" * 500 + "bb" + "c" * 498, "a" * 499 + "bb" + "c" * 497,
                    "Peaks far beyond 2^64 in the middle of the computation; the answer is 500 * 498."))
big = rs(rng, "ab", 1000)
drop = set(rng.sample(range(1000), 12))
entries.append(case("h-large-random", True, big, "".join(c for i, c in enumerate(big) if i not in drop)))
big3 = rs(rng, "abc", 1000)
drop3 = set(rng.sample(range(1000), 25))
entries.append(case("h-large-random-abc", True, big3, "".join(c for i, c in enumerate(big3) if i not in drop3)))
entries.append(case("h-large-same", True, "z" * 1000, "z" * 1000))
entries.append(case("h-large-t-longer", True, "z" * 999, "z" * 1000))
tests = [e for e, _ in entries]
for (e, peak) in entries:
    if peak >= 2**63:
        print("intermediate exceeds 2^63:", e["id"])
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
