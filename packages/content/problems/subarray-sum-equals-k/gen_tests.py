"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(nums, k):
    c = 0
    for i in range(len(nums)):
        s = 0
        for j in range(i, len(nums)):
            s += nums[j]; c += s == k
    return c

def case(id, hidden, nums, k, explanation=None):
    exp = mod.Solution().subarraySum(list(nums), k)
    if len(nums) <= 1500: assert exp == brute(nums, k)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "subarraySum", "args": [nums, k]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(560)
for _ in range(2000):
    a = [rng.randint(-3, 3) for _ in range(rng.randint(1, 9))]
    k = rng.randint(-4, 4)
    assert mod.Solution().subarraySum(a, k) == brute(a, k)

tests = [
    case("s1", False, [1, 2, 3, -2, 2], 3, "[1,2], [3], [2,3,-2] and [3,-2,2]."),
    case("s2", False, [1, 1, 1], 2),
    case("s3", False, [0, 0, 0], 0, "All 6 subarrays sum to 0."),
    case("h-single-hit", True, [5], 5),
    case("h-single-miss", True, [5], -5),
    case("h-negative-k", True, [-1, -1, 1], -1),
    case("h-window-breaker", True, [3, 4, -7, 3, 1, 3, 1, -4, -2, -2], 7, "Negatives defeat a sliding window."),
    case("h-whole-array", True, [1000, -1000, 1000], 1000),
    case("h-no-match", True, [1, 2, 3], 100),
    case("h-zero-k-mixed", True, [1, -1, 1, -1, 0], 0),
]
for k_, n in enumerate([10, 100, 1000, 1500]):
    a = [rng.randint(-10, 10) for _ in range(n)]
    i, j = sorted(rng.sample(range(n + 1), 2))
    tests.append(case(f"h-rand-{k_}", True, a, sum(a[i:j])))
tests.append(case("h-large-zeros", True, [0] * 20000, 0, "Answer is n(n+1)/2 = 200010000."))
big = [rng.randint(-1000, 1000) for _ in range(20000)]
tests.append(case("h-large-random", True, big, sum(big[5000:5100])))
alt = [rng.choice([1, -1]) for _ in range(20000)]
tests.append(case("h-large-plus-minus", True, alt, 2))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
