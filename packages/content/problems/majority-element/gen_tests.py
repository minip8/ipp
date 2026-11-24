"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from collections import Counter

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def solve(nums):
    return mod.Solution().majorityElement(list(nums))

def brute(nums):
    v, c = Counter(nums).most_common(1)[0]
    assert c * 2 > len(nums)
    return v

def case(id, hidden, nums, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "majorityElement", "args": [nums]}],
         "expected": [brute(nums)]}
    assert solve(nums) == t["expected"][0]
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(169)
def gen(n, lo, hi, maj=None, arrange="shuffle"):
    maj = rng.randint(lo, hi) if maj is None else maj
    k = n // 2 + 1
    others = [rng.randint(lo, hi) for _ in range(n - k)]
    others = [o if o != maj else maj + 1 for o in others]
    if arrange == "shuffle":
        a = [maj] * k + others; rng.shuffle(a)
    elif arrange == "majority-last":
        a = others + [maj] * k
    else:  # alternate, majority fills the gaps; makes naive "first value seen" wrong
        a = []
        for o in others: a += [o, maj]
        a += [maj] * (k - len(others))
    return a

for _ in range(3000):
    a = gen(rng.randint(1, 9), -3, 3)
    assert solve(a) == brute(a), a

tests = [
    case("s1", False, [4, 1, 4]),
    case("s2", False, [7, 7, 2, 2, 7, 3, 7], "7 appears 4 times out of 7."),
    case("s3", False, [-5]),
    case("h-two", True, [9, 9]),
    case("h-just-over-half", True, [1, 2, 1, 2, 1]),
    case("h-majority-last", True, [3, 3, 3, 8, 8, 8, 8]),
    case("h-negatives", True, [-1, -1, 2, -1, -2]),
    case("h-extremes", True, [10**9, -10**9, 10**9, -10**9, 10**9]),
    case("h-zero", True, [0, 5, 0, 6, 0]),
    case("h-front-loaded-other", True, [2, 2, 2, 5, 5, 5, 5, 5, 2, 5], "The first value seen is not the answer."),
]
for k, n in enumerate([11, 100, 1001, 5000]):
    tests.append(case(f"h-rand-{k}", True, gen(n, -10**9, 10**9)))
tests.append(case("h-alternate", True, gen(999, -50, 50, arrange="alternate")))
tests.append(case("h-majority-last-big", True, gen(10001, -10**6, 10**6, arrange="majority-last")))
tests.append(case("h-large", True, gen(30001, -99, 99, maj=-7)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
