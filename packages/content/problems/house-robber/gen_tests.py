"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(nums):
    """Every subset of houses with no two adjacent."""
    n, best = len(nums), 0
    for mask in range(1 << n):
        if mask & (mask >> 1) == 0:
            best = max(best, sum(nums[i] for i in range(n) if mask >> i & 1))
    return best


def case(id, hidden, nums, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "rob", "args": [nums]}],
         "expected": [mod.Solution().rob(list(nums))]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(198)
for _ in range(500):
    nums = [rng.randint(0, 20) for _ in range(rng.randint(1, 12))]
    assert mod.Solution().rob(list(nums)) == brute(nums), nums

tests = [
    case("s1", False, [3, 10, 4, 2, 8], "Rob houses 1 and 4 for 10 + 8 = 18."),
    case("s2", False, [5, 1, 1, 5], "Houses 0 and 3; neither 'all even' nor 'all odd' indices is optimal."),
    case("s3", False, [7]),
    case("h-two", True, [4, 9]),
    case("h-zeros", True, [0, 0, 0, 0]),
    case("h-greedy-largest", True, [3, 4, 3], "Taking the largest house (4) loses to 3 + 3."),
    case("h-skip-two", True, [2, 1, 1, 2, 1, 1, 2]),
    case("h-alternating", True, [10, 1, 10, 1, 10, 1, 10]),
    case("h-increasing", True, list(range(1, 21))),
]
for k, n in enumerate([5, 8, 12, 30, 100, 1000]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(0, 10**4) for _ in range(n)]))
tests.append(case("h-n60", True, [rng.randint(0, 100) for _ in range(60)], "Too long for take/skip recursion without memo."))
tests.append(case("h-large", True, [rng.randint(0, 10**4) for _ in range(30000)]))
tests.append(case("h-large-max", True, [10**4] * 9999, "All equal and odd length: take every even index."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
