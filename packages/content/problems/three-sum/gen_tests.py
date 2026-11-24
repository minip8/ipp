"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from itertools import combinations

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def canon(ts):
    return sorted(tuple(sorted(t)) for t in ts)

def brute(nums):
    return sorted({tuple(sorted(t)) for t in combinations(nums, 3) if sum(t) == 0})

def fast_check(nums):
    """O(n^2) set-based check, independent of the two-pointer code."""
    res = set()
    for i in range(len(nums)):
        seen = set()
        for j in range(i + 1, len(nums)):
            need = -nums[i] - nums[j]
            if need in seen:
                res.add(tuple(sorted((nums[i], nums[j], need))))
            seen.add(nums[j])
    return sorted(res)

def case(id, hidden, nums, explanation=None):
    exp = mod.Solution().threeSum(list(nums))
    ref = brute(nums) if len(nums) <= 60 else fast_check(nums)
    assert canon(exp) == ref and len(set(map(tuple, map(sorted, exp)))) == len(exp)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "threeSum", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(15)
for _ in range(1500):
    a = [rng.randint(-4, 4) for _ in range(rng.randint(3, 9))]
    assert canon(mod.Solution().threeSum(a)) == brute(a)

tests = [
    case("s1", False, [-2, 0, 1, 1, 2, -1], "[-1, 0, 1] can be formed twice but is listed once."),
    case("s2", False, [0, 0, 0, 0]),
    case("s3", False, [1, 2, -4]),
    case("h-dup-after-hit", True, [-2, 0, 0, 2, 2], "Skip equal values after recording a match."),
    case("h-repeated-in-triple", True, [-4, 2, 2, 2, 1, 3]),
    case("h-no-reuse", True, [1, -2, 5], "Can't use the 1 twice."),
    case("h-exact-three", True, [-100000, 50000, 50000]),
    case("h-all-positive", True, [1, 2, 3, 4, 5]),
    case("h-all-negative", True, [-1, -2, -3]),
    case("h-two-zeros", True, [0, 0, 1, -1]),
    case("h-many-dupes", True, [-1, -1, -1, 0, 0, 0, 1, 1, 1, 2, 2, -2, -2]),
]
for k, (n, r) in enumerate([(10, 10), (50, 30), (200, 100), (600, 20000)]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(-r, r) for _ in range(n)]))
tests.append(case("h-large-sparse", True, [rng.randint(-10**5, 10**5) for _ in range(2000)]))
tests.append(case("h-large-dupes", True, [rng.randint(-50, 50) for _ in range(2000)], "Lots of duplicate values."))
no_answer = [4 * rng.randint(1, 25000) + 1 for _ in range(1000)] + [-(4 * rng.randint(1, 25000) + 1) for _ in range(1000)]
rng.shuffle(no_answer)
tests.append(case("h-large-no-answer", True, no_answer, "Positives are 1 mod 4 and negatives 3 mod 4, so no triple sums to 0."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
