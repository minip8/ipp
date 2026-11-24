"""Regenerates tests.json deterministically from the Python reference solution.

Checked against sorted(concatenation) on every test.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def solve(arrays):
    return mod.Solution().mergeKArrays([list(a) for a in arrays])


def case(id, hidden, arrays, explanation=None):
    got = solve(arrays)
    assert got == sorted(x for a in arrays for x in a), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "mergeKArrays", "args": [arrays]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_arrays(rng, k, max_len, lo, hi):
    return [sorted(rng.randint(lo, hi) for _ in range(rng.randint(0, max_len))) for _ in range(k)]


rng = random.Random(23)
for _ in range(500):
    a = rand_arrays(rng, rng.randint(0, 6), 5, -5, 5)
    assert solve(a) == sorted(x for r in a for x in r)

tests = [
    case("s1", False, [[1, 4, 5], [1, 3, 4], [2, 6]]),
    case("s2", False, [], "No arrays at all."),
    case("s3", False, [[], [-3], []], "Empty arrays contribute nothing."),
    case("h-all-empty", True, [[], [], []]),
    case("h-one", True, [[-1000000000, 0, 1000000000]]),
    case("h-duplicates", True, [[2, 2, 2], [2, 2], [1, 2, 3]]),
    case("h-disjoint-ranges", True, [[7, 8, 9], [4, 5, 6], [1, 2, 3]], "Arrays given in reverse order of their ranges."),
    case("h-interleaved", True, [list(range(i, 60, 5)) for i in range(5)]),
    case("h-extremes", True, [[-1000000000, -1000000000], [1000000000], [-1, 0, 1000000000]]),
]
for k_, (k, m, r) in enumerate([(3, 5, 10), (10, 10, 100), (50, 20, 10**4), (150, 30, 10**9), (30, 300, 5)]):
    tests.append(case(f"h-rand-{k_}", True, rand_arrays(rng, k, m, -r, r)))
tests.append(case("h-many-tiny", True, rand_arrays(rng, 5000, 3, -10**6, 10**6),
                  "5000 short arrays: merging one at a time copies the result thousands of times."))
tests.append(case("h-many-empty", True, [[] for _ in range(4000)] + [[5, 6]] + [[] for _ in range(4000)]))
tests.append(case("h-few-long", True, rand_arrays(rng, 15, 500, -10**4, 10**4)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
