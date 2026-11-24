"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(a):
    return [sum(1 for y in a[i + 1:] if y < x) for i, x in enumerate(a)]

def merge_version(a):
    """Independent O(n log n) check: merge sort on indices."""
    n = len(a); out = [0] * n; idx = list(range(n))
    def sort(lo, hi):
        if hi - lo <= 1: return
        mid = (lo + hi) // 2; sort(lo, mid); sort(mid, hi)
        merged, j, taken = [], mid, 0
        for i in range(lo, mid):
            while j < hi and a[idx[j]] < a[idx[i]]:
                merged.append(idx[j]); j += 1; taken += 1
            out[idx[i]] += taken; merged.append(idx[i])
        merged += idx[j:hi]; idx[lo:hi] = merged
    sort(0, n)
    return out

def case(id, hidden, a, explanation=None):
    exp = mod.Solution().countSmaller(list(a))
    assert exp == merge_version(a)
    if len(a) <= 2000: assert exp == brute(a)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "countSmaller", "args": [a]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(315)
for _ in range(3000):
    a = [rng.randint(-3, 3) for _ in range(rng.randint(1, 10))]
    assert mod.Solution().countSmaller(a) == brute(a)

tests = [
    case("s1", False, [5, 2, 6, 1]),
    case("s2", False, [3, 3, 1], "Equal values are not smaller."),
    case("s3", False, [-1]),
    case("h-extremes", True, [10000, -10000, 10000, -10000]),
    case("h-sorted", True, [1, 2, 3, 4, 5]),
    case("h-reverse", True, [5, 4, 3, 2, 1]),
    case("h-all-equal", True, [7, 7, 7, 7]),
    case("h-negatives", True, [-2, -1, -3, 0, -5]),
]
for k, (n, r) in enumerate([(20, 10), (200, 10000), (2000, 10000), (2000, 3)]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(-r, r) for _ in range(n)]))
tests.append(case("h-large-random", True, [rng.randint(-10**4, 10**4) for _ in range(9000)]))
tests.append(case("h-large-reverse", True, list(range(10000, -10001, -3)), "Strictly decreasing: answers are n-1, n-2, ..., 0."))
tests.append(case("h-large-dups", True, [rng.randint(-5, 5) for _ in range(12000)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
