"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def dp(nums, k):
    n = len(nums); pre = [0]
    for x in nums: pre.append(pre[-1] + x)
    INF = float("inf")
    best = [INF] * (n + 1); best[0] = 0
    for _ in range(k):
        nxt = [INF] * (n + 1)
        for i in range(1, n + 1):
            for j in range(i):
                if best[j] < INF:
                    nxt[i] = min(nxt[i], max(best[j], pre[i] - pre[j]))
        best = nxt
    return best[n]

def case(id, hidden, nums, k, explanation=None):
    assert 1 <= k <= min(50, len(nums))
    exp = mod.Solution().splitArray(list(nums), k)
    if len(nums) * len(nums) * k <= 3 * 10**6: assert exp == dp(nums, k)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "splitArray", "args": [nums, k]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(410)
for _ in range(1500):
    nums = [rng.randint(0, 9) for _ in range(rng.randint(1, 8))]
    k = rng.randint(1, len(nums))
    assert mod.Solution().splitArray(nums, k) == dp(nums, k), (nums, k)

tests = [
    case("s1", False, [7, 2, 5, 10, 8], 2, "[7, 2, 5] and [10, 8]."),
    case("s2", False, [1, 2, 3, 4, 5], 2),
    case("s3", False, [1, 4, 4], 3, "Each element alone."),
    case("h-k1", True, [3, 1, 4, 1, 5], 1, "One part: the whole sum."),
    case("h-single", True, [0], 1),
    case("h-zeros", True, [0, 0, 0, 0], 2),
    case("h-one-huge", True, [1, 1, 1000000, 1, 1], 2, "The answer can't go below the largest element."),
    case("h-k-equals-n", True, [5, 9, 2, 8], 4),
    case("h-equal-elements", True, [4] * 10, 3),
    case("h-zeros-and-big", True, [0, 0, 7, 0, 0, 7, 0], 2),
]
for k_, (n, k, hi) in enumerate([(10, 3, 20), (60, 7, 1000), (100, 25, 10**6), (150, 50, 50)]):
    tests.append(case(f"h-rand-{k_}", True, [rng.randint(0, hi) for _ in range(n)], k))
tests.append(case("h-large-overflow", True, [10**6] * 10000, 3, "Total 10^10: needs 64-bit sums."))
tests.append(case("h-large-random", True, [rng.randint(0, 10**6) for _ in range(10000)], 50, "The O(k n^2) DP is ~5 * 10^9 steps."))
tests.append(case("h-large-skewed", True, [rng.randint(0, 10) for _ in range(9990)] + [10**6] * 10, 17))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
