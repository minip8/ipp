"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, nums, explanation=None):
    exp = sorted(x * x for x in nums)
    assert mod.Solution().sortedSquares(list(nums)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "sortedSquares", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(977)
for _ in range(3000):
    a = sorted(rng.randint(-6, 6) for _ in range(rng.randint(1, 8)))
    assert mod.Solution().sortedSquares(a) == sorted(x * x for x in a)

def gen(n, lo, hi):
    return sorted(rng.randint(lo, hi) for _ in range(n))

tests = [
    case("s1", False, [-5, -2, 0, 3, 4]),
    case("s2", False, [-3, -3, 1]),
    case("s3", False, [2, 6]),
    case("h-single-neg", True, [-10000]),
    case("h-all-negative", True, [-9, -7, -3, -1]),
    case("h-all-positive", True, [0, 1, 2, 10000]),
    case("h-symmetric", True, [-4, -1, 1, 4]),
    case("h-zeros", True, [0, 0, 0]),
    case("h-extremes", True, [-10000, -10000, 10000]),
]
for k, n in enumerate([10, 100, 1000, 3000]):
    tests.append(case(f"h-rand-{k}", True, gen(n, -10000, 10000)))
tests.append(case("h-large-skewed", True, gen(15000, -10000, 100)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
