"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from functools import lru_cache

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(nums):
    """Direct simulation over every remaining-row state (exponential; tiny inputs only)."""
    @lru_cache(None)
    def go(row):
        if not row:
            return 0
        best = 0
        for p in range(len(row)):
            l = row[p - 1] if p > 0 else 1
            r = row[p + 1] if p + 1 < len(row) else 1
            best = max(best, l * row[p] * r + go(row[:p] + row[p + 1:]))
        return best
    return go(tuple(nums))


def greedy_now(nums):
    row, tot = list(nums), 0
    while row:
        gains = [(row[p - 1] if p else 1) * row[p] * (row[p + 1] if p + 1 < len(row) else 1) for p in range(len(row))]
        p = max(range(len(row)), key=gains.__getitem__)
        tot += gains[p]; row.pop(p)
    return tot


def case(id, hidden, nums, explanation=None, check=True):
    got = mod.Solution().maxCoins(list(nums))
    if check:
        assert got == brute(nums), nums
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "maxCoins", "args": [nums]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(312)
for _ in range(300):
    nums = [rng.randint(0, 9) for _ in range(rng.randint(1, 8))]
    assert mod.Solution().maxCoins(list(nums)) == brute(nums), nums
assert greedy_now([4, 1, 6, 2]) == 82 and greedy_now([3, 0, 5, 0, 2]) == 2  # traps used below

tests = [
    case("s1", False, [4, 1, 6, 2], "Burst 1, then 6, then 2, then 4: 24 + 48 + 8 + 4 = 84."),
    case("s2", False, [1, 5]),
    case("s3", False, [7]),
    case("h-zero", True, [0]),
    case("h-zeros-inside", True, [3, 0, 5, 0, 2], "Bursting for the biggest immediate gain earns only 2 here."),
    case("h-all-equal", True, [5, 5, 5, 5, 5, 5]),
    case("h-increasing", True, [1, 2, 3, 4, 5, 6, 7, 8]),
    case("h-valley", True, [9, 1, 1, 1, 9]),
    case("h-greedy-trap", True, [2, 9, 3, 1], "Bursting for the biggest immediate gain is not optimal."),
]
for k, n in enumerate([5, 7, 8, 9]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(0, 100) for _ in range(n)], check=n <= 9))
for k, n in enumerate([20, 60, 120]):
    tests.append(case(f"h-rand-mid-{k}", True, [rng.randint(0, 100) for _ in range(n)], check=False))
tests.append(case("h-large", True, [rng.randint(0, 100) for _ in range(200)], check=False))
tests.append(case("h-large-max", True, [100] * 200, check=False))
tests.append(case("h-large-alternating", True, [100 if i % 2 else 1 for i in range(200)], check=False))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
