"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(g):
    """Unmemoised DFS over every increasing path (tiny grids only)."""
    m, n = len(g), len(g[0])

    def go(r, c):
        best = 1
        for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            if 0 <= nr < m and 0 <= nc < n and g[nr][nc] > g[r][c]:
                best = max(best, 1 + go(nr, nc))
        return best
    return max(go(r, c) for r in range(m) for c in range(n))


def case(id, hidden, g, explanation=None, check=True):
    got = mod.Solution().longestIncreasingPath([row[:] for row in g])
    if check:
        assert got == brute(g), g
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "longestIncreasingPath", "args": [g]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def snake(m, n):
    """Boustrophedon numbering: one increasing path through every cell."""
    return [[r * n + (c if r % 2 == 0 else n - 1 - c) for c in range(n)] for r in range(m)]


rng = random.Random(329)
for _ in range(300):
    m, n = rng.randint(1, 5), rng.randint(1, 5)
    g = [[rng.randint(0, 6) for _ in range(n)] for _ in range(m)]
    assert mod.Solution().longestIncreasingPath([r[:] for r in g]) == brute(g)

tests = [
    case("s1", False, [[7, 8, 9], [6, 1, 2], [5, 4, 3]], "The values spiral inward-out from 1 to 9."),
    case("s2", False, [[3, 4, 5], [3, 2, 6], [2, 2, 1]], "3 -> 4 -> 5 -> 6."),
    case("s3", False, [[5, 5]], "Equal neighbours do not form an increasing step."),
    case("h-single", True, [[0]]),
    case("h-row", True, [[1, 2, 3, 2, 1, 2, 3, 4]]),
    case("h-column", True, [[9], [8], [7], [7], [6]]),
    case("h-all-equal", True, [[4] * 6 for _ in range(5)], "Allowing >= would create cycles here."),
    case("h-no-diagonal", True, [[1, 9], [9, 2]], "1 and 2 are diagonal, so the best path has 2 cells."),
    case("h-sum-grid", True, [[i + j for j in range(9)] for i in range(9)],
         "matrix[i][j] = i + j has exponentially many monotone paths: unmemoised DFS explodes."),
    case("h-snake-small", True, snake(5, 6)),
]
for k, (m, n, hi) in enumerate([(4, 4, 5), (6, 7, 20), (10, 10, 100), (30, 20, 10**4), (60, 60, 50)]):
    tests.append(case(f"h-rand-{k}", True, [[rng.randint(0, hi) for _ in range(n)] for _ in range(m)], check=m * n <= 16))
tests.append(case("h-large-sum", True, [[i + j for j in range(150)] for i in range(150)],
                  "Every monotone staircase is increasing: brute force cannot enumerate them.", check=False))
tests.append(case("h-large-snake", True, snake(100, 100), "One path through all 10^4 cells: deep recursion.", check=False))
tests.append(case("h-large-random", True, [[rng.randint(0, 10**4) for _ in range(150)] for _ in range(150)], check=False))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
