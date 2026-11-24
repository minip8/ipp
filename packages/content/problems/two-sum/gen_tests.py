"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, nums, target, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "twoSum", "args": [nums, target]}],
         "expected": [mod.Solution().twoSum(list(nums), target)]}
    if explanation: t["explanation"] = explanation
    return t

def unique_answer(rng, n, lo, hi):
    """Random array with exactly one valid pair."""
    while True:
        nums = [rng.randint(lo, hi) for _ in range(n)]
        i, j = rng.sample(range(n), 2)
        target = nums[i] + nums[j]
        seen, pairs = {}, 0
        for x in nums:
            pairs += seen.get(target - x, 0)
            seen[x] = seen.get(x, 0) + 1
        if pairs == 1:
            return nums, target

rng = random.Random(1)
tests = [
    case("s1", False, [2, 7, 11, 15], 9, "2 + 7 = 9"),
    case("s2", False, [3, 2, 4], 6, "The 3 cannot be used twice."),
    case("s3", False, [3, 3], 6),
    case("h-negatives", True, [-3, 4, 3, 90], 0),
    case("h-zeros", True, [0, 4, 3, 0], 0),
    case("h-extremes", True, [1000000000, -1000000000, 5, 999999999], 1999999999),
    case("h-last-two", True, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 19),
]
for k, n in enumerate([5, 10, 50, 200, 1000]):
    tests.append(case(f"h-rand-{k}", True, *unique_answer(rng, n, -10**6, 10**6)))
big = list(range(1, 20001)); rng.shuffle(big)   # only 19999 + 20000 reaches the target
tests.append(case("h-large", True, big, 39999))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
