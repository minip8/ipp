"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from itertools import combinations

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def is_subseq(p, s):
    it = iter(s)
    return all(c in it for c in p)


def brute(a, b):
    """Longest subsequence of a (by exhaustive enumeration) that is also a subsequence of b."""
    for k in range(len(a), 0, -1):
        if any(is_subseq(c, b) for c in combinations(a, k)):
            return k
    return 0


def case(id, hidden, a, b, explanation=None):
    got = mod.Solution().longestCommonSubsequence(a, b)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "longestCommonSubsequence", "args": [a, b]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rs(rng, alpha, n):
    return "".join(rng.choice(alpha) for _ in range(n))


rng = random.Random(1143)
for _ in range(400):
    a, b = rs(rng, "abc", rng.randint(1, 9)), rs(rng, "abc", rng.randint(1, 9))
    assert mod.Solution().longestCommonSubsequence(a, b) == brute(a, b), (a, b)

tests = [
    case("s1", False, "kitten", "sitting", "One longest common subsequence is \"ittn\"."),
    case("s2", False, "abc", "abc"),
    case("s3", False, "abc", "xyz"),
    case("h-single-match", True, "a", "a"),
    case("h-single-miss", True, "a", "b"),
    case("h-greedy-trap", True, "abcd", "bcda", "Matching the leading 'a' first gives 1; the answer is \"bcd\"."),
    case("h-substring-trap", True, "axbxcxd", "abcd", "Subsequence, not substring."),
    case("h-reverse", True, "abcdefgh", "hgfedcba"),
    case("h-repeats", True, "aaaa", "aa"),
    case("h-different-lengths", True, "z", "abcdefghijklmnopqrstuvwxyz" * 3),
]
for k, (n, m, alpha) in enumerate([(8, 8, "ab"), (15, 20, "abc"), (50, 40, "abcd"), (120, 200, "acgt"), (300, 300, "abcdefghijklmnopqrstuvwxyz")]):
    tests.append(case(f"h-rand-{k}", True, rs(rng, alpha, n), rs(rng, alpha, m)))
base = rs(rng, "abcdefghij", 1000)
mutated = "".join(c if rng.random() < 0.8 else rng.choice("abcdefghij") for c in base)
tests.append(case("h-large-similar", True, base, mutated))
tests.append(case("h-large-random", True, rs(rng, "ab", 1000), rs(rng, "ab", 1000)))
tests.append(case("h-large-disjoint", True, rs(rng, "abc", 1000), rs(rng, "xyz", 1000)))
tests.append(case("h-large-identical", True, "q" * 1000, "q" * 1000))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
