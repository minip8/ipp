"""Regenerates tests.json deterministically from the Python reference solution (dense Prim).

Kruskal over all pairs is used as an independent check on small random inputs.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def kruskal(points):
    n = len(points)
    edges = sorted((abs(points[i][0] - points[j][0]) + abs(points[i][1] - points[j][1]), i, j)
                   for i in range(n) for j in range(i + 1, n))
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x
    total = 0
    for w, i, j in edges:
        a, b = find(i), find(j)
        if a != b:
            parent[a] = b; total += w
    return total


def solve(points):
    return mod.Solution().minCostConnectPoints([list(p) for p in points])


def rand_points(rng, n, lo, hi):
    s = set()
    while len(s) < n:
        s.add((rng.randint(lo, hi), rng.randint(lo, hi)))
    pts = [list(p) for p in s]
    rng.shuffle(pts)
    return pts


def case(id, hidden, points, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "minCostConnectPoints", "args": [points]}], "expected": [solve(points)]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(1584)
for _ in range(300):
    pts = rand_points(rng, rng.randint(1, 12), -10, 10)
    assert solve(pts) == kruskal(pts)

tests = [
    case("s1", False, [[0, 0], [2, 2], [3, 10], [5, 2], [7, 0]],
         "Cables 4 + 3 + 4 + 9 = 20."),
    case("s2", False, [[3, 12], [-2, 5], [-4, 1]], "[3,12]-[-2,5] costs 12 and [-2,5]-[-4,1] costs 6."),
    case("s3", False, [[0, 0]], "A single point needs no cable."),
    case("h-two", True, [[-1000000, -1000000], [1000000, 1000000]], "4,000,000: still fits in 32 bits."),
    case("h-line", True, [[i * 3, 0] for i in range(10)][::-1]),
    case("h-nn-chain-trap", True, [[0, 0], [10, 0], [5, 1], [20, 0], [15, 1], [30, 0]],
         "Walking to the nearest unvisited point each time is not optimal in general."),
    case("h-cross", True, [[0, 0], [0, 5], [0, -5], [5, 0], [-5, 0], [1, 1]]),
]
for k, (n, r) in enumerate([(5, 5), (10, 20), (30, 100), (80, 1000), (200, 10**6)]):
    tests.append(case(f"h-rand-{k}", True, rand_points(rng, n, -r, r)))
tests.append(case("h-grid", True, [[x, y] for x in range(0, 300, 10) for y in range(0, 300, 10)]))
clusters = sorted({(c * 100000 + rng.randint(-50, 50), (c % 5) * 70000 + rng.randint(-50, 50))
                   for c in range(-8, 9) for _ in range(40)})
rng.shuffle(clusters)
tests.append(case("h-clustered", True, [list(p) for p in clusters], "17 tight clusters far apart."))
tests.append(case("h-large", True, rand_points(rng, 1000, -10**6, 10**6)))
tests.append(case("h-large-dense", True, rand_points(rng, 1000, -30, 30)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
