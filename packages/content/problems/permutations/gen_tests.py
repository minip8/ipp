"""Regenerates tests.json deterministically from the Python reference solution.

The reference is checked against itertools.permutations before anything is written.
"""
import json, random, importlib.util, pathlib, itertools

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def check(nums, got):
    assert sorted(map(tuple, got)) == sorted(itertools.permutations(nums))
    assert len(set(map(tuple, got))) == len(got)


def case(id, hidden, nums, explanation=None):
    got = mod.Solution().permute(list(nums))
    check(nums, got)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "permute", "args": [nums]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(46)
for _ in range(200):
    nums = rng.sample(range(-10, 11), rng.randint(1, 5))
    check(nums, mod.Solution().permute(list(nums)))

tests = [
    case("s1", False, [5, 8]),
    case("s2", False, [0]),
    case("s3", False, [1, 2, 3], "3! = 6 orderings."),
    case("h-negatives", True, [-10, 10]),
    case("h-four", True, [3, -1, 0, 7]),
    case("h-descending", True, [9, 4, 2, -5]),
]
for k, n in enumerate([5, 5, 6]):
    tests.append(case(f"h-rand-{k}", True, rng.sample(range(-10, 11), n)))
tests.append(case("h-max-7", True, rng.sample(range(-9, 10), 7)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
