"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(nums):
    s = set(nums)
    return next(v for v in range(len(nums) + 1) if v not in s)

def case(id, hidden, nums, explanation=None):
    exp = brute(nums)
    assert mod.Solution().missingNumber(list(nums)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "missingNumber", "args": [nums]}],
         "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(268)
def gen(n, missing=None):
    m = rng.randint(0, n) if missing is None else missing
    a = [v for v in range(n + 1) if v != m]
    rng.shuffle(a)
    return a

tests = [
    case("s1", False, [3, 0, 1], "n = 3, so values come from 0..3; 2 is absent."),
    case("s2", False, [1]),
    case("s3", False, [0, 1, 2, 3], "The missing value is n = 4 itself."),
    case("h-single-zero", True, [0]),
    case("h-missing-zero", True, [2, 1, 3, 5, 4]),
    case("h-sorted-mid", True, [0, 1, 2, 4, 5]),
    case("h-reverse", True, [5, 4, 3, 2, 1, 0]),
]
for k, n in enumerate([10, 100, 1000, 2000]):
    tests.append(case(f"h-rand-{k}", True, gen(n)))
tests.append(case("h-large-missing-n", True, gen(47000, missing=47000), "n * (n + 1) exceeds the 32-bit int range."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
