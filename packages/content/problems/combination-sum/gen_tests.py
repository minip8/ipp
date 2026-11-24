"""Regenerates tests.json deterministically from the Python reference solution.

The reference is checked against an independent DP (sets of sorted tuples per sum) and for
duplicate combinations before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(cands, target):
    dp = [set() for _ in range(target + 1)]
    dp[0].add(())
    for c in cands:                       # unbounded knapsack over multisets
        for s in range(c, target + 1):
            for comb in dp[s - c]:
                dp[s].add(tuple(sorted(comb + (c,))))
    return sorted(dp[target])


def canon(res):
    return sorted(tuple(sorted(r)) for r in res)


def case(id, hidden, cands, target, explanation=None):
    got = mod.Solution().combinationSum(list(cands), target)
    assert canon(got) == brute(cands, target), id
    assert len(set(canon(got))) == len(got) <= 500, (id, len(got))
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "combinationSum", "args": [cands, target]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(39)
for _ in range(300):
    cands = rng.sample(range(2, 41), rng.randint(1, 8))
    target = rng.randint(1, 25)
    assert canon(mod.Solution().combinationSum(list(cands), target)) == brute(cands, target)


def random_case(lo_n, hi_n, lo_t, hi_t, min_count):
    while True:
        cands = rng.sample(range(2, 41), rng.randint(lo_n, hi_n))
        target = rng.randint(lo_t, hi_t)
        cnt = len(brute(cands, target))
        if min_count <= cnt <= 500:
            return cands, target


tests = [
    case("s1", False, [3, 4, 7], 7, "3 + 4 and 7 alone. 4 + 3 is the same combination."),
    case("s2", False, [2, 5], 9, "2 may be used twice."),
    case("s3", False, [4, 6], 5, "No combination reaches 5."),
    case("h-target-below-all", True, [5, 9, 12], 1),
    case("h-single-exact", True, [40], 40),
    case("h-single-repeat", True, [2], 40, "Twenty copies of 2."),
    case("h-unsorted-input", True, [8, 2, 6, 3], 8),
    case("h-no-odd-sum", True, [2, 4, 6, 8, 10], 39),
    case("h-many-small", True, [2, 3, 5, 7], 30),
    case("h-dense-low", True, [2, 3, 4], 32),
]
for k in range(8):
    tests.append(case(f"h-rand-{k}", True, *random_case(2, 10, 10, 40, 1)))
tests.append(case("h-wide-30", True, *random_case(30, 30, 30, 40, 50)))
tests.append(case("h-large-output", True, *random_case(8, 15, 35, 40, 300)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
