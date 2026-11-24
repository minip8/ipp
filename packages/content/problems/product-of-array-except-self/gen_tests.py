"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, math

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
LIM = 2**31 - 1

def ok(nums):
    """Every prefix and suffix product fits in int32."""
    p = 1
    for x in nums:
        p *= x
        if abs(p) > LIM: return False
    p = 1
    for x in reversed(nums):
        p *= x
        if abs(p) > LIM: return False
    return True

def brute(nums):
    return [math.prod(nums[:i] + nums[i + 1:]) for i in range(len(nums))]

def case(id, hidden, nums, explanation=None):
    assert ok(nums), nums[:20]
    exp = mod.Solution().productExceptSelf(list(nums))
    if len(nums) <= 2000: assert exp == brute(nums)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "productExceptSelf", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(238)
for _ in range(2000):
    a = [rng.randint(-4, 4) for _ in range(rng.randint(2, 7))]
    if ok(a): assert mod.Solution().productExceptSelf(a) == brute(a)

def gen(n, big=4, zeros=0):
    """Mostly +-1 with a few larger factors so products stay in range."""
    a = [rng.choice([1, -1]) for _ in range(n)]
    for _ in range(big):
        a[rng.randrange(n)] = rng.choice([2, 3, 5, 7, -2, -3, 30, -30])
    for _ in range(zeros):
        a[rng.randrange(n)] = 0
    while not ok(a):
        a[rng.randrange(n)] = 1
    return a

tests = [
    case("s1", False, [2, 3, 4, 5]),
    case("s2", False, [3, 0, 2, -1], "Only the position of the zero gets a non-zero product."),
    case("s3", False, [0, 4, 0], "Two zeros: every product includes at least one zero."),
    case("h-two", True, [7, -3]),
    case("h-two-zeros-only", True, [0, 0]),
    case("h-single-zero-first", True, [0, 1, 2, 3]),
    case("h-single-zero-last", True, [1, 2, 3, 0]),
    case("h-negatives", True, [-1, -2, -3, -4]),
    case("h-ones", True, [1, 1, 1, 1, 1]),
    case("h-near-limit", True, [30, 30, 30, 30, 30, 30, 2], "Prefix products reach 30^6 * 2 = 1.458e9."),
]
for k, n in enumerate([10, 100, 1000, 2000]):
    tests.append(case(f"h-rand-{k}", True, gen(n, big=6, zeros=k % 3)))
tests.append(case("h-large", True, gen(12000, big=10)))
tests.append(case("h-large-one-zero", True, gen(6000, big=8, zeros=1)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
