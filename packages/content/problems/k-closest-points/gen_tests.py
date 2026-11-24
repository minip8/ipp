"""Regenerates tests.json deterministically from the Python reference solution.

Every instance satisfies the uniqueness promise (k == n, or the k-th smallest squared distance is
strictly below the (k+1)-th). The answer is cross-checked against sorting.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

d2 = lambda p: p[0] * p[0] + p[1] * p[1]


def unique(points, k):
    if k == len(points):
        return True
    ds = sorted(d2(p) for p in points)
    return ds[k - 1] < ds[k]


def brute(points, k):
    return sorted(points, key=d2)[:k]


def canon(ps):
    return sorted(map(tuple, ps))


def solve(points, k):
    return mod.Solution().kClosest([list(p) for p in points], k)


def case(id, hidden, points, k, explanation=None):
    assert unique(points, k), id
    got = solve(points, k)
    assert canon(got) == canon(brute(points, k)), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "kClosest", "args": [points, k]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_case(rng, n, r, k=None):
    while True:
        pts = [[rng.randint(-r, r), rng.randint(-r, r)] for _ in range(n)]
        kk = k if k is not None else rng.randint(1, n)
        if unique(pts, kk):
            return pts, kk


rng = random.Random(973)
for _ in range(500):
    pts, k = rand_case(rng, rng.randint(1, 10), 5)
    assert canon(solve(pts, k)) == canon(brute(pts, k))

tests = [
    case("s1", False, [[1, 3], [-2, 2], [5, -1]], 2, "Squared distances 10, 8, 26."),
    case("s2", False, [[0, 4], [3, 3], [-1, -1], [2, -5]], 1),
    case("h-all", True, [[5, 5], [1, 1], [-3, 2]], 3, "k equals n: return everything."),
    case("h-single", True, [[10000, -10000]], 1),
    case("h-duplicates", True, [[1, 1], [1, 1], [2, 2], [0, 3], [1, 1]], 3, "The repeated point appears three times."),
    case("h-ties-below-k", True, [[3, 4], [4, 3], [-5, 0], [0, 1], [6, 6]], 4,
         "Three points share distance 5; all of them are inside the answer."),
    case("h-not-manhattan", True, [[3, 3], [0, 5], [4, 0]], 1, "Closest by Euclidean distance, not by |x| + |y|."),
    case("h-origin", True, [[0, 0], [0, 1], [1, 0], [0, 0], [2, 2]], 2),
]
for k_, (n, r) in enumerate([(5, 3), (10, 10), (50, 100), (200, 1000), (1000, 10000)]):
    tests.append(case(f"h-rand-{k_}", True, *rand_case(rng, n, r)))
pts, k = rand_case(rng, 6000, 10000, k=5)
tests.append(case("h-large-small-k", True, pts, k))
pts, k = rand_case(rng, 4000, 10000, k=3500)
tests.append(case("h-large-big-k", True, pts, k))
# Sorted by decreasing distance: bad for a naive pivot choice in quickselect.
pts = sorted(rand_case(rng, 4000, 10000, k=2000)[0], key=d2, reverse=True)
tests.append(case("h-large-reverse-sorted", True, pts, 2000))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
