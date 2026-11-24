"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from itertools import permutations

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(nums):
    return str(max(int("".join(map(str, p))) for p in permutations(nums)))

def case(id, hidden, nums, explanation=None):
    exp = mod.Solution().largestNumber(list(nums))
    if len(nums) <= 7: assert exp == brute(nums)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "largestNumber", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(179)
for _ in range(1500):
    a = [rng.choice([0, 1, 3, 9, 10, 12, 30, 34, 121, 100, 999, 98, 989]) for _ in range(rng.randint(1, 6))]
    assert mod.Solution().largestNumber(a) == brute(a), a

tests = [
    case("s1", False, [10, 2], "Numeric order would give \"102\"."),
    case("s2", False, [3, 30, 34, 5, 9]),
    case("s3", False, [0, 0, 0], "No leading zeros: just \"0\"."),
    case("s4", False, [121, 12], "\"12121\" > \"12112\"."),
    case("h-single-zero", True, [0]),
    case("h-zero-and-one", True, [0, 1]),
    case("h-lexi-trap", True, [3, 30], "Lexicographic descending gives \"303\"."),
    case("h-equal-concat", True, [12, 1212, 121212], "All orders give the same string."),
    case("h-max-values", True, [1000000000, 999999999, 9]),
    case("h-repeating-prefix", True, [824, 8247]),
    case("h-repeating-prefix-2", True, [8308, 830]),
    case("h-nines", True, [9, 99, 999, 98, 989]),
]
for k, n in enumerate([7, 50, 500, 3000]):
    tests.append(case(f"h-rand-{k}", True, [rng.choice([rng.randint(0, 99), rng.randint(0, 10**9)]) for _ in range(n)]))
pool = [rng.choice([5, 55, 555, 56, 54, 545, 554, 5555, 0, 50, 505]) for _ in range(10000)]
tests.append(case("h-large-similar-prefixes", True, pool, "Many numbers that are prefixes of each other."))
tests.append(case("h-large-random", True, [rng.randint(0, 10**9) for _ in range(8000)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
