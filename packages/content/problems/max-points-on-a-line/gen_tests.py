"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, copy

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(p):
    n = len(p)
    if n <= 2: return n
    best = 2
    for i in range(n):
        for j in range(i + 1, n):
            (x1, y1), (x2, y2) = p[i], p[j]
            c = sum(1 for (x, y) in p if (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) == 0)
            best = max(best, c)
    return best

def case(id, hidden, p, explanation=None):
    assert len({tuple(q) for q in p}) == len(p)
    exp = mod.Solution().maxPoints(copy.deepcopy(p))
    if len(p) <= 80: assert exp == brute(p)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "maxPoints", "args": [p]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(149)
def rand_pts(n, r):
    s = set()
    while len(s) < n: s.add((rng.randint(-r, r), rng.randint(-r, r)))
    return [list(q) for q in s]
for _ in range(1500):
    p = rand_pts(rng.randint(1, 8), 3)
    assert mod.Solution().maxPoints(p) == brute(p)

def with_line(n_noise, k_line, r=10**4):
    """k_line points on a random line with a reduced direction, plus random noise."""
    while True:
        dx, dy = rng.randint(-40, 40), rng.randint(-40, 40)
        if (dx, dy) != (0, 0): break
    x0, y0 = rng.randint(-2000, 2000), rng.randint(-2000, 2000)
    line = [[x0 + t * dx, y0 + t * dy] for t in range(-(k_line // 2), k_line - k_line // 2)]
    s = {tuple(q) for q in line}
    while len(s) < k_line + n_noise: s.add((rng.randint(-r, r), rng.randint(-r, r)))
    pts = [list(q) for q in s]; rng.shuffle(pts)
    return pts

tests = [
    case("s1", False, [[1, 1], [2, 2], [3, 3]]),
    case("s2", False, [[0, 0], [4, 2], [2, 1], [1, 3], [-2, -1], [5, 5]], "Four points on y = x / 2."),
    case("s3", False, [[7, -3]]),
    case("h-two", True, [[0, 0], [10000, -10000]]),
    case("h-vertical", True, [[3, 1], [3, 5], [3, -7], [1, 1], [2, 2]]),
    case("h-horizontal", True, [[-5, 4], [0, 4], [9, 4], [1, 1]]),
    case("h-sign-normalise", True, [[0, 0], [1, 2], [-1, -2], [2, 4], [5, 1]], "(1, 2) and (-1, -2) are the same direction."),
    case("h-float-trap", True, [[0, 0], [9999, 10000], [9998, 9999], [1, 1]], "Slopes differ by about 1e-8: unsafe with floating point."),
    case("h-parallel", True, [[0, 0], [1, 1], [0, 1], [1, 2], [2, 3]], "Parallel lines must not be merged."),
    case("h-extremes", True, [[-10000, -10000], [10000, 10000], [0, 0], [-10000, 10000]]),
]
for k, (n, r) in enumerate([(10, 3), (40, 5), (80, 20), (300, 30)]):
    tests.append(case(f"h-rand-{k}", True, rand_pts(n, r)))
tests.append(case("h-planted", True, with_line(200, 25)))
tests.append(case("h-large-planted", True, with_line(950, 50), "O(n^3) is ~10^9 here."))
tests.append(case("h-large-grid", True, [[x, y] for x in range(-15, 16) for y in range(-15, 17)][:1000]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
