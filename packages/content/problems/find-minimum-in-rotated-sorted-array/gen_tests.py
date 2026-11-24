"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, nums, explanation=None):
    exp = min(nums)
    assert mod.Solution().findMin(list(nums)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "findMin", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(153)
def rotated(n, r=None, lo=-10**9, hi=10**9):
    a = sorted(rng.sample(range(lo, hi + 1), n))
    r = rng.randrange(n) if r is None else r
    return a[n - r:] + a[:n - r] if r else a
for n in range(1, 12):  # every rotation of small arrays
    base = list(range(n))
    for r in range(n):
        a = base[n - r:] + base[:n - r] if r else base
        assert mod.Solution().findMin(a) == 0

tests = [
    case("s1", False, [8, 9, 2, 4, 6]),
    case("s2", False, [5, 1, 3]),
    case("s3", False, [10, 20, 30], "Not rotated."),
    case("h-single", True, [-7]),
    case("h-two-rotated", True, [2, 1]),
    case("h-two-sorted", True, [1, 2]),
    case("h-min-last", True, [2, 3, 4, 5, 1]),
    case("h-min-second", True, [9, 1, 2, 3, 4, 5, 6]),
    case("h-extremes", True, [10**9, -10**9]),
]
for k, n in enumerate([10, 100, 1000, 3000]):
    tests.append(case(f"h-rand-{k}", True, rotated(n)))
tests.append(case("h-large", True, rotated(12000)))
tests.append(case("h-large-unrotated", True, rotated(8000, 0)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
