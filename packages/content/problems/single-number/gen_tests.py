"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from collections import Counter

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(nums):
    (v,) = [x for x, c in Counter(nums).items() if c == 1]
    return v

def case(id, hidden, nums, explanation=None):
    exp = brute(nums)
    assert mod.Solution().singleNumber(list(nums)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "singleNumber", "args": [nums]}],
         "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(136)
def gen(pairs, lo=-30000, hi=30000, single=None):
    vals = rng.sample(range(lo, hi + 1), pairs + 1)
    if single is not None and single in vals[:pairs]:
        vals.remove(single); vals.append(single)
    s = vals[pairs] if single is None else single
    a = vals[:pairs] * 2 + [s]
    rng.shuffle(a)
    return a

tests = [
    case("s1", False, [6, 3, 6]),
    case("s2", False, [5, -2, 9, 9, 5]),
    case("s3", False, [0]),
    case("h-single-negative", True, [-30000]),
    case("h-zero-single", True, [7, 0, 7]),
    case("h-zero-paired", True, [0, 1, 0]),
    case("h-single-first", True, [4, 1, 1, 2, 2]),
    case("h-single-last", True, [1, 2, 1, 2, -1]),
    case("h-extremes", True, [30000, -30000, 30000, -30000, 29999]),
    case("h-adjacent-pairs", True, [8, 8, 3, 3, 5]),
]
for k, p in enumerate([5, 50, 500, 2000]):
    tests.append(case(f"h-rand-{k}", True, gen(p)))
tests.append(case("h-large", True, gen(15000)))
tests.append(case("h-large-neg-single", True, gen(4000, single=-12345)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
