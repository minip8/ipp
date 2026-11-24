"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from itertools import product

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(nums):
    """Every assignment of items to the two groups (tiny inputs)."""
    return any(sum(x if g else -x for x, g in zip(nums, gs)) == 0 for gs in product((0, 1), repeat=len(nums)))


def sums_set(nums):
    """Independent check for medium inputs: set of reachable subset sums."""
    reach = {0}
    for x in nums:
        reach |= {s + x for s in reach}
    return sum(nums) % 2 == 0 and sum(nums) // 2 in reach


def case(id, hidden, nums, explanation=None):
    got = mod.Solution().canPartition(list(nums))
    assert got == sums_set(nums), nums
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "canPartition", "args": [nums]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(416)
for _ in range(400):
    nums = [rng.randint(1, 12) for _ in range(rng.randint(1, 11))]
    assert mod.Solution().canPartition(list(nums)) == brute(nums), nums


def balanced(rng, n, hi):
    """Random multiset that is guaranteed to split evenly: two groups with equal sums."""
    while True:
        a = [rng.randint(1, hi) for _ in range(n // 2)]
        b = [rng.randint(1, hi) for _ in range(n - n // 2 - 1)]
        d = sum(a) - sum(b)
        if 1 <= d <= hi:
            nums = a + b + [d]
            rng.shuffle(nums)
            return nums


def even_but_impossible(rng, n):
    """Even total, all items even, but the half-sum is odd: no subset can reach it."""
    nums = [4 * rng.randint(1, 25) for _ in range(n - 1)] + [2]
    rng.shuffle(nums)
    return nums


tests = [
    case("s1", False, [2, 3, 4, 5], "{2, 5} and {3, 4} both sum to 7."),
    case("s2", False, [1, 2, 5], "The total is 8 but no subset sums to 4."),
    case("s3", False, [6, 1, 3], "Even total 10, but no subset sums to 5."),
    case("h-single", True, [4]),
    case("h-pair-equal", True, [7, 7]),
    case("h-pair-unequal", True, [7, 9]),
    case("h-odd-total", True, [1, 2, 3, 5]),
    case("h-greedy-trap", True, [3, 3, 2, 2, 2], "Greedy 'add to the lighter side' fails; {3, 3} vs {2, 2, 2}."),
    case("h-reuse-trap", True, [1, 4, 7, 6], "Half is 9; only reusing the 4 (1 + 4 + 4) reaches it."),
    case("h-ones", True, [1] * 200),
    case("h-ones-odd", True, [1] * 199),
    case("h-one-big", True, [100] + [1] * 99, "Total 199 is odd."),
    case("h-one-big-even", True, [100] + [1] * 98, "Total 198: the 100 alone exceeds 99."),
    case("h-max", True, [100] * 200),
]
for k, n in enumerate([6, 10, 20, 50]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(1, 100) for _ in range(n)]))
for k, n in enumerate([30, 120, 200]):
    tests.append(case(f"h-balanced-{k}", True, balanced(rng, n, 100)))
for k, n in enumerate([40, 200]):
    tests.append(case(f"h-even-no-{k}", True, even_but_impossible(rng, n), "Even total, still impossible."))
tests.append(case("h-large-odd-items", True, [2 * rng.randint(0, 49) + 1 for _ in range(200)]))
tests.append(case("h-large-random", True, [rng.randint(50, 100) for _ in range(199)] + [1]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
