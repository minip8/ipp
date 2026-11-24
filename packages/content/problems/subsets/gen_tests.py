"""Regenerates tests.json deterministically from the Python reference solution.

The reference output is checked against itertools.combinations (as a set of sorted tuples) and
for duplicates before anything is written.
"""
import json, random, importlib.util, pathlib, itertools

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def canon(res):
    return sorted(tuple(sorted(s)) for s in res)


def brute(nums):
    return canon(c for r in range(len(nums) + 1) for c in itertools.combinations(nums, r))


def case(id, hidden, nums, explanation=None):
    got = mod.Solution().subsets(list(nums))
    assert canon(got) == brute(nums), id
    assert len(set(canon(got))) == 2 ** len(nums), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "subsets", "args": [nums]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(78)
for _ in range(200):
    n = rng.randint(1, 7)
    nums = rng.sample(range(-100, 101), n)
    assert canon(mod.Solution().subsets(list(nums))) == brute(nums)

tests = [
    case("s1", False, [4, 9], "Each element is either in or out: 2^2 = 4 subsets."),
    case("s2", False, [-1], "The empty subset always counts."),
    case("s3", False, [1, 2, 3]),
    case("h-zero", True, [0]),
    case("h-negatives", True, [-100, 100, -3]),
    case("h-unsorted", True, [5, -2, 9, 0]),
]
for k, n in enumerate([5, 6, 8, 9, 10]):
    tests.append(case(f"h-rand-{k}", True, rng.sample(range(-100, 101), n)))
tests.append(case("h-max-11", True, rng.sample(range(-100, 101), 11)))
tests.append(case("h-max-12", True, rng.sample(range(-9, 10), 12)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
