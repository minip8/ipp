"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(a, b):
    c = sorted(a + b); n = len(c)
    return float(c[n // 2]) if n % 2 else (c[n // 2 - 1] + c[n // 2]) / 2

def case(id, hidden, a, b, explanation=None):
    exp = brute(a, b)
    assert mod.Solution().findMedianSortedArrays(list(a), list(b)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "findMedianSortedArrays", "args": [a, b]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(4)
def srt(n, lo=-10**9, hi=10**9):
    return sorted(rng.randint(lo, hi) for _ in range(n))
for _ in range(5000):
    a, b = srt(rng.randint(0, 6), -5, 5), srt(rng.randint(0, 6), -5, 5)
    if a or b: assert mod.Solution().findMedianSortedArrays(a, b) == brute(a, b)

tests = [
    case("s1", False, [1, 3], [2]),
    case("s2", False, [1, 2], [3, 4], "Even total: average of 2 and 3."),
    case("s3", False, [], [7], "One array may be empty."),
    case("s4", False, [5, 5, 5], [5, 5]),
    case("h-first-empty-even", True, [], [1, 2, 3, 4]),
    case("h-second-empty", True, [-3, -1, 10], []),
    case("h-disjoint-a-first", True, [1, 2, 3], [10, 11, 12, 13]),
    case("h-disjoint-b-first", True, [10, 11, 12, 13], [1, 2, 3]),
    case("h-interleaved", True, [1, 3, 5, 7], [2, 4, 6, 8]),
    case("h-single-each", True, [1], [2]),
    case("h-overflow-average", True, [1000000000], [999999999], "Adding the two middles overflows 32-bit ints."),
    case("h-negative-half", True, [-1000000000], [-999999999]),
    case("h-short-in-long", True, [50], list(range(100))),
    case("h-duplicates-across", True, [1, 1, 1, 2], [1, 2, 2, 2]),
]
for k, (m, n) in enumerate([(3, 8), (50, 51), (500, 2), (1000, 999), (0, 1001)]):
    tests.append(case(f"h-rand-{k}", True, srt(m), srt(n)))
tests.append(case("h-large", True, srt(6000), srt(5001)))
tests.append(case("h-large-skewed", True, srt(1), srt(6000)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
