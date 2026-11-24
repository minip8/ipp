"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(nums):
    s = set(nums); v = 1
    while v in s: v += 1
    return v

def case(id, hidden, nums, explanation=None):
    exp = brute(nums)
    assert mod.Solution().firstMissingPositive(list(nums)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "firstMissingPositive", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(41)
for _ in range(5000):
    a = [rng.randint(-3, 8) for _ in range(rng.randint(1, 8))]
    assert mod.Solution().firstMissingPositive(list(a)) == brute(a)

def perm_missing(n, missing, noise=0):
    a = [v for v in range(1, n + 2) if v != missing]
    a = a[:n]
    for _ in range(noise):
        a[rng.randrange(n)] = rng.choice([0, -5, 2**31 - 1, -2**31, n + 7])
    rng.shuffle(a)
    return a

tests = [
    case("s1", False, [3, 4, -1, 1]),
    case("s2", False, [1, 2, 0]),
    case("s3", False, [7, 8, 9, 11], "1 itself is missing."),
    case("s4", False, [2, 2, 1, 1], "Duplicates must not cause an infinite loop."),
    case("h-single-one", True, [1]),
    case("h-single-two", True, [2]),
    case("h-single-neg", True, [-1]),
    case("h-extremes", True, [2**31 - 1, -2**31, 1]),
    case("h-all-dup", True, [1, 1, 1, 1]),
    case("h-n-present", True, [5, 4, 3, 2, 1], "All of 1..n present: answer is n + 1."),
    case("h-value-n-plus-1", True, [2, 3, 4], "Value n + 1 is out of range and ignored."),
    case("h-zeros", True, [0, 0, 0]),
]
for k, n in enumerate([10, 100, 1000, 3000]):
    tests.append(case(f"h-rand-{k}", True, perm_missing(n, rng.randint(1, n + 1), noise=n // 10)))
tests.append(case("h-large-perm", True, perm_missing(15000, 15001)))
tests.append(case("h-large-missing-middle", True, perm_missing(12000, 6789, noise=50)))
tests.append(case("h-large-dups", True, [rng.randint(1, 500) for _ in range(20000)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
