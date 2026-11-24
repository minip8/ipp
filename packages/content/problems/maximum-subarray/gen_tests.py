"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(a):
    best = a[0]
    for i in range(len(a)):
        s = 0
        for j in range(i, len(a)):
            s += a[j]; best = max(best, s)
    return best

def case(id, hidden, nums, explanation=None):
    exp = mod.Solution().maxSubArray(list(nums))
    if len(nums) <= 2000: assert exp == brute(nums)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "maxSubArray", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(53)
for _ in range(3000):
    a = [rng.randint(-6, 6) for _ in range(rng.randint(1, 9))]
    assert mod.Solution().maxSubArray(a) == brute(a)

tests = [
    case("s1", False, [3, -4, 5, -1, 2, -6, 1], "[5, -1, 2] sums to 6."),
    case("s2", False, [-3, -1, -2], "All negative: the best non-empty subarray is the single -1."),
    case("s3", False, [2, 3, -1, 4], "The whole array."),
    case("h-single-neg", True, [-1000000000]),
    case("h-single-pos", True, [7]),
    case("h-zeros", True, [0, 0, 0]),
    case("h-neg-and-zero", True, [-5, 0, -3]),
    case("h-dip-worth-crossing", True, [10, -9, 10]),
    case("h-dip-not-worth", True, [10, -11, 10]),
    case("h-max-at-end", True, [-1, -2, -3, 100]),
]
for k, n in enumerate([10, 100, 1000, 1500]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(-10**9, 10**9) for _ in range(n)]))
tests.append(case("h-large-overflow", True, [10**9] * 8000, "Sum is 8 * 10^12: needs 64-bit accumulation."))
tests.append(case("h-large-all-negative", True, [rng.randint(-10**9, -1) for _ in range(8000)]))
tests.append(case("h-large-mixed", True, [rng.randint(-1000, 1100) for _ in range(15000)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
