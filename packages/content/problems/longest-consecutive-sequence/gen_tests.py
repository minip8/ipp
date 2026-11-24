"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(nums):
    s = sorted(set(nums)); best = run = 0
    for i, v in enumerate(s):
        run = run + 1 if i and s[i - 1] == v - 1 else 1
        best = max(best, run)
    return best

def case(id, hidden, nums, explanation=None):
    exp = brute(nums)
    assert mod.Solution().longestConsecutive(list(nums)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "longestConsecutive", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(128)
for _ in range(3000):
    a = [rng.randint(-5, 5) for _ in range(rng.randint(0, 8))]
    assert mod.Solution().longestConsecutive(a) == brute(a)

def runs(n, spread):
    out = []
    while len(out) < n:
        start = rng.randint(-10**9, 10**9 - 1000); length = rng.randint(1, spread)
        out += list(range(start, start + length))
    out = out[:n]; rng.shuffle(out)
    return out

tests = [
    case("s1", False, [10, 4, 20, 1, 3, 2], "1, 2, 3, 4"),
    case("s2", False, [5, 6, 6, 7, -1, 0], "5, 6, 7; duplicates count once."),
    case("s3", False, []),
    case("h-single", True, [42]),
    case("h-all-dupes", True, [3, 3, 3]),
    case("h-negatives", True, [-3, -1, -2, 5, -4]),
    case("h-crosses-zero", True, [1, -1, 0, 2, -2]),
    case("h-extremes", True, [10**9, -10**9, 10**9 - 1, -10**9 + 1]),
    case("h-two-runs-equal", True, [1, 2, 3, 10, 11, 12]),
    case("h-gaps", True, [0, 2, 4, 6, 8]),
]
for k, (n, s) in enumerate([(20, 5), (200, 20), (2000, 50), (3000, 400)]):
    tests.append(case(f"h-rand-{k}", True, runs(n, s)))
one_run = list(range(-8000, 8000)); rng.shuffle(one_run)
tests.append(case("h-large-one-run", True, one_run, "Walking forward from every value is quadratic here."))
dup_starts = [0] * 8000 + list(range(1, 8000)); rng.shuffle(dup_starts)
tests.append(case("h-large-dup-starts", True, dup_starts, "Many copies of the run start; iterate over distinct values."))
tests.append(case("h-large-random", True, [rng.randint(-30000, 30000) for _ in range(8000)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
