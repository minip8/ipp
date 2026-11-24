"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(nums, target):
    return nums.index(target) if target in nums else -1

def case(id, hidden, nums, target, explanation=None):
    exp = brute(nums, target)
    assert mod.Solution().search(list(nums), target) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "search", "args": [nums, target]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(33)
def rotated(n, lo=-10**9, hi=10**9, r=None):
    a = sorted(rng.sample(range(lo, hi + 1), n))
    r = rng.randrange(n) if r is None else r
    return a[r:] + a[:r]

for _ in range(5000):
    n = rng.randint(1, 8)
    a = rotated(n, -10, 10)
    t = rng.randint(-11, 11)
    assert mod.Solution().search(a, t) == brute(a, t), (a, t)
for n in range(1, 9):  # every rotation, every present and absent target
    base = list(range(0, 2 * n, 2))
    for r in range(n):
        a = base[r:] + base[:r]
        for t in range(-1, 2 * n + 1):
            assert mod.Solution().search(a, t) == brute(a, t)

tests = [
    case("s1", False, [5, 8, 9, 12, 1, 3], 1),
    case("s2", False, [5, 8, 9, 12, 1, 3], 6),
    case("s3", False, [2, 4, 7], 7, "Rotation by 0."),
    case("s4", False, [10], 10),
    case("h-single-miss", True, [10], 3),
    case("h-two-rotated-first", True, [3, 1], 3),
    case("h-two-rotated-second", True, [3, 1], 1),
    case("h-pivot-target", True, [6, 7, 1, 2, 3, 4, 5], 1),
    case("h-last", True, [6, 7, 1, 2, 3, 4, 5], 5),
    case("h-first", True, [6, 7, 1, 2, 3, 4, 5], 6),
    case("h-rotated-by-one", True, [9, 1, 2, 3, 4, 5, 6, 7, 8], 9),
    case("h-rotated-by-n-minus-1", True, [2, 3, 4, 5, 6, 7, 8, 9, 1], 1),
    case("h-gap-miss", True, [40, 50, 10, 20, 30], 35),
    case("h-extremes", True, [10**9, -10**9, 0], -10**9),
]
for k, n in enumerate([10, 100, 1000, 2000]):
    a = rotated(n)
    tests.append(case(f"h-rand-hit-{k}", True, a, rng.choice(a)))
    tests.append(case(f"h-rand-miss-{k}", True, a, rng.randint(-10**9, 10**9)))
big = rotated(6000)
tests.append(case("h-large-hit", True, big, big[rng.randrange(6000)]))
tests.append(case("h-large-unrotated", True, rotated(4000, r=0), -10**9 - 0))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
