"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def quadratic(nums):
    best = [1] * len(nums)
    for i in range(len(nums)):
        for j in range(i):
            if nums[j] < nums[i]:
                best[i] = max(best[i], best[j] + 1)
    return max(best)


def case(id, hidden, nums, explanation=None, check=True):
    got = mod.Solution().lengthOfLIS(list(nums))
    if check:
        assert got == quadratic(nums), nums
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "lengthOfLIS", "args": [nums]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(300)
for _ in range(500):
    nums = [rng.randint(-5, 5) for _ in range(rng.randint(1, 15))]
    assert mod.Solution().lengthOfLIS(list(nums)) == quadratic(nums)

N = 25000
tests = [
    case("s1", False, [4, 1, 8, 2, 3, 9, 5], "One longest option is 1, 2, 3, 9."),
    case("s2", False, [6, 6, 6], "Equal values do not form an increasing pair."),
    case("s3", False, [3, 10, 2, 11, 4, 12], "3, 10, 11, 12."),
    case("h-single", True, [42]),
    case("h-decreasing", True, list(range(10, 0, -1))),
    case("h-increasing", True, list(range(-5, 15))),
    case("h-greedy-trap", True, [3, 10, 2, 11, 4, 5, 6], "Greedy keeps 3, 10, 11; the answer is 2, 4, 5, 6 (or 3, 4, 5, 6)."),
    case("h-dup-plateaus", True, [1, 2, 2, 2, 3, 3, 4, 1, 5], "upper_bound would count the repeated values."),
    case("h-negatives", True, [-10000, 10000, -9999, 9999, -9998, 9998]),
    case("h-zigzag", True, [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15]),
]
for k, n in enumerate([10, 30, 100, 500, 2000]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(-10**4, 10**4) for _ in range(n)]))
tests.append(case("h-rand-small-range", True, [rng.randint(0, 20) for _ in range(1500)]))
tests.append(case("h-large-random", True, [rng.randint(-10**4, 10**4) for _ in range(N)], check=False))
# Noisy increasing trend: long answer, every element does real work.
tests.append(case("h-large-trend", True, [max(-10**4, min(10**4, -10**4 + (i * 20000) // N + rng.randint(-200, 200))) for i in range(N)], check=False))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
