"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
INF = float("inf")

def brute(a):
    n = len(a); dp = [INF] * n; dp[0] = 0
    for i in range(n):
        for j in range(i + 1, min(n, i + a[i] + 1)):
            dp[j] = min(dp[j], dp[i] + 1)
    return dp[-1]

def reachable(a):
    far = 0
    for i, x in enumerate(a):
        if i > far: return False
        far = max(far, i + x)
    return True

def case(id, hidden, nums, explanation=None):
    assert reachable(nums)
    exp = mod.Solution().jump(list(nums))
    if len(nums) <= 3000: assert exp == brute(nums)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "jump", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(45)
def gen(n, hi, zero_rate=0.2):
    """Random jumps; any index that would be unreachable gets a jump of 1 from its predecessor."""
    a = [0 if rng.random() < zero_rate else rng.randint(1, hi) for _ in range(n)]
    far = 0
    for i in range(n):
        if i > far:
            a[i - 1] = 1; far = i
        far = max(far, i + a[i])
    return a
for _ in range(3000):
    a = gen(rng.randint(1, 9), 3)
    assert mod.Solution().jump(a) == brute(a)

tests = [
    case("s1", False, [2, 3, 1, 1, 4], "0 -> 1 -> 4."),
    case("s2", False, [2, 3, 0, 1, 4]),
    case("s3", False, [0], "Already at the last index."),
    case("s4", False, [1, 1, 1, 1]),
    case("h-one-big", True, [1000] + [0] * 999),
    case("h-two", True, [1, 0]),
    case("h-far-greedy-trap", True, [3, 1, 1, 5, 1, 1, 1, 1], "Jumping as far as possible from index 0 isn't optimal."),
    case("h-exact", True, [4, 1, 1, 3, 1, 1, 1]),
    case("h-zeros-skipped", True, [5, 0, 0, 0, 0, 1, 0]),
    case("h-ladder", True, [2, 0, 2, 0, 2, 0, 1]),
]
for k, (n, hi) in enumerate([(10, 3), (100, 5), (1000, 10), (3000, 50)]):
    tests.append(case(f"h-rand-{k}", True, gen(n, hi)))
tests.append(case("h-large-ones", True, [1] * 40000, "40000 elements of 1: 39999 jumps."))
tests.append(case("h-large-big-jumps", True, gen(25000, 1000, 0.5), "Large jump values: the DP is O(n * 1000)."))
tests.append(case("h-large-small", True, gen(25000, 3, 0.1)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
