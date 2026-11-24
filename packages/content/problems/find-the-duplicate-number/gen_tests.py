"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from collections import Counter

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(nums):
    (v,) = [x for x, c in Counter(nums).items() if c > 1]
    return v

def case(id, hidden, nums, explanation=None):
    n = len(nums) - 1
    assert all(1 <= x <= n for x in nums)
    exp = brute(nums)
    assert mod.Solution().findDuplicate(list(nums)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "findDuplicate", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(287)
def gen(n, copies):
    d = rng.randint(1, n)
    others = [v for v in range(1, n + 1) if v != d]
    rng.shuffle(others)
    a = [d] * copies + others[: n + 1 - copies]
    rng.shuffle(a)
    return a

for _ in range(3000):
    n = rng.randint(1, 8)
    a = gen(n, rng.randint(2, n + 1))
    assert mod.Solution().findDuplicate(a) == brute(a)

tests = [
    case("s1", False, [1, 4, 3, 2, 4]),
    case("s2", False, [3, 1, 3, 2, 3], "3 appears three times, so a sum formula fails."),
    case("s3", False, [1, 1]),
    case("h-all-same", True, [2, 2, 2]),
    case("h-dup-is-n", True, [5, 1, 2, 3, 4, 5]),
    case("h-dup-is-1", True, [1, 3, 4, 2, 1]),
    case("h-adjacent", True, [2, 5, 9, 6, 9, 3, 8, 9, 7, 1]),
    case("h-sum-trap", True, [2, 2, 2, 2, 4], "1 and 3 are missing; 2 appears four times."),
]
for k, (n, c) in enumerate([(10, 2), (50, 5), (1000, 2), (2000, 300)]):
    tests.append(case(f"h-rand-{k}", True, gen(n, c)))
tests.append(case("h-large", True, gen(20000, 2)))
tests.append(case("h-large-many-copies", True, gen(12000, 6000)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
