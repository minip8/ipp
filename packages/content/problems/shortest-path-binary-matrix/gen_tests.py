"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against Bellman-Ford-style relaxation to a fixpoint on small grids.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(grid):
    n = len(grid)
    INF = float("inf")
    d = [[INF] * n for _ in range(n)]
    if grid[0][0]:
        return -1
    d[0][0] = 1
    changed = True
    while changed:
        changed = False
        for r in range(n):
            for c in range(n):
                if grid[r][c]:
                    continue
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < n and 0 <= nc < n and d[nr][nc] + 1 < d[r][c]:
                            d[r][c] = d[nr][nc] + 1; changed = True
    v = d[n - 1][n - 1]
    return -1 if v == INF else v


def case(id, hidden, grid, explanation=None):
    got = mod.Solution().shortestPathBinaryMatrix([row[:] for row in grid])
    if len(grid) <= 20:
        assert got == brute(grid), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "shortestPathBinaryMatrix", "args": [grid]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_grid(rng, n, p):
    g = [[1 if rng.random() < p else 0 for _ in range(n)] for _ in range(n)]
    g[0][0] = g[n - 1][n - 1] = 0
    return g


rng = random.Random(1091)
for _ in range(300):
    n = rng.randint(1, 7)
    g = [[1 if rng.random() < rng.random() * 0.6 else 0 for _ in range(n)] for _ in range(n)]
    assert mod.Solution().shortestPathBinaryMatrix(g) == brute(g)

tests = [
    case("s1", False, [[0, 1], [1, 0]], "One diagonal step: 2 cells."),
    case("s2", False, [[0, 0, 0], [1, 1, 0], [1, 1, 0]], "(0,0) -> (0,1) -> (1,2) -> (2,2)."),
    case("s3", False, [[1, 0], [0, 0]], "The start cell is blocked."),
    case("h-single-open", True, [[0]]),
    case("h-single-blocked", True, [[1]]),
    case("h-end-blocked", True, [[0, 0], [0, 1]]),
    case("h-diagonal-only", True, [[0, 1, 1, 1], [1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0]],
         "Only diagonal moves connect the cells."),
    case("h-wall", True, [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]]),
    case("h-open-5", True, [[0] * 5 for _ in range(5)], "Straight down the diagonal: 5 cells."),
]
for k, (n, p) in enumerate([(6, 0.3), (10, 0.35), (15, 0.4), (20, 0.3), (40, 0.35), (60, 0.4), (80, 0.3)]):
    tests.append(case(f"h-rand-{k}", True, rand_grid(rng, n, p)))

# Serpentine maze: walls with alternating gaps force a long winding path.
n = 101
maze = [[0] * n for _ in range(n)]
for c in range(1, n - 1, 2):
    for r in range(n):
        maze[r][c] = 1
    gap = n - 1 if (c // 2) % 2 == 0 else 0
    maze[gap][c] = 0
tests.append(case("h-serpentine", True, maze))
# Fully open max grid: exponential path enumeration is hopeless; answer is n.
tests.append(case("h-open-max", True, [[0] * 150 for _ in range(150)]))
# Large random, likely connected.
tests.append(case("h-large-random", True, rand_grid(rng, 150, 0.3)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
