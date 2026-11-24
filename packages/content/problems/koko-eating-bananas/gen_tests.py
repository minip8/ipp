"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def hours(piles, k):
    return sum((p + k - 1) // k for p in piles)

def brute(piles, h):
    k = 1
    while hours(piles, k) > h: k += 1
    return k

def case(id, hidden, piles, h, explanation=None):
    assert len(piles) <= h <= 10**9
    exp = mod.Solution().minEatingSpeed(list(piles), h)
    assert hours(piles, exp) <= h and (exp == 1 or hours(piles, exp - 1) > h)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "minEatingSpeed", "args": [piles, h]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(875)
for _ in range(2000):
    piles = [rng.randint(1, 30) for _ in range(rng.randint(1, 6))]
    h = rng.randint(len(piles), 60)
    assert mod.Solution().minEatingSpeed(piles, h) == brute(piles, h)

tests = [
    case("s1", False, [3, 6, 7, 11], 8, "At k = 4: 1 + 2 + 2 + 3 = 8 hours. At k = 3: 1 + 2 + 3 + 4 = 10."),
    case("s2", False, [30, 11, 23, 4, 20], 5, "One hour per pile: k must be at least the largest pile."),
    case("s3", False, [30, 11, 23, 4, 20], 6),
    case("h-single-pile", True, [1000000000], 2),
    case("h-single-one", True, [1], 1),
    case("h-plenty-of-time", True, [5, 9, 1], 1000000000, "k = 1 is enough."),
    case("h-exact-sum", True, [4, 4, 4], 12),
    case("h-max-pile-h-n", True, [1000000000] * 3 + [1], 4),
    case("h-overflow", True, [1000000000] * 1000, 1000000000, "At k = 1 the total is 10^12 hours: 32-bit sums overflow."),
    case("h-ceil-trap", True, [10, 10], 3, "k = 7 gives 2 + 2 = 4 > 3; k = 10 gives 2."),
]
for k, n in enumerate([5, 50, 500, 2000]):
    piles = [rng.randint(1, 10**9) for _ in range(n)]
    tests.append(case(f"h-rand-{k}", True, piles, rng.randint(n, min(10**9, 3 * n))))
big = [rng.randint(1, 10**9) for _ in range(4000)]
tests.append(case("h-large-tight", True, big, 4000))
tests.append(case("h-large-loose", True, big, 987654321))
small = [rng.randint(1, 10**6) for _ in range(6000)]
tests.append(case("h-large-mid", True, small, 123456))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
