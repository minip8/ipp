"""Regenerates tests.json deterministically from the Python reference solution (Dijkstra).

Brute force (try t = 0, 1, 2, ... with a flood fill each time) is checked against the reference
on small random grids first.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(grid):
    n = len(grid)
    for t in range(n * n):
        if grid[0][0] > t:
            continue
        seen = {(0, 0)}; stack = [(0, 0)]
        while stack:
            r, c = stack.pop()
            for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= nr < n and 0 <= nc < n and (nr, nc) not in seen and grid[nr][nc] <= t:
                    seen.add((nr, nc)); stack.append((nr, nc))
        if (n - 1, n - 1) in seen:
            return t


def solve(grid):
    return mod.Solution().swimInWater([row[:] for row in grid])


def random_grid(rng, n):
    vals = list(range(n * n)); rng.shuffle(vals)
    return [vals[i * n:(i + 1) * n] for i in range(n)]


def snake_grid(n):  # for n % 4 == 1 the serpentine ends exactly at the bottom-right cell
    """Forces the route to wind back and forth: low values along a serpentine path,
    walls of high values in between, the snake is the only cheap path."""
    # even rows are walked fully, alternating direction; odd rows contribute one connector cell
    path = []
    for r in range(0, n, 2):
        cols = list(range(n)) if (r // 2) % 2 == 0 else list(range(n - 1, -1, -1))
        path.extend((r, c) for c in cols)
        if r + 1 < n:
            path.append((r + 1, n - 1 if (r // 2) % 2 == 0 else 0))
    grid = [[-1] * n for _ in range(n)]
    v = 0
    for r, c in path:
        grid[r][c] = v; v += 1
    rest = [(r, c) for r in range(n) for c in range(n) if grid[r][c] == -1]
    for r, c in rest:
        grid[r][c] = v; v += 1
    return grid


def case(id, hidden, grid, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "swimInWater", "args": [grid]}], "expected": [solve(grid)]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(778)
for _ in range(300):
    g = random_grid(rng, rng.randint(1, 6))
    assert solve(g) == brute(g)
for n in range(1, 14):
    g = snake_grid(n)
    assert solve(g) == brute(g)

tests = [
    case("s1", False, [[0, 2], [1, 3]], "The target cell itself has height 3."),
    case("s2", False, [[0, 1, 2, 3], [11, 10, 9, 4], [12, 13, 14, 5], [8, 7, 6, 15]],
         "The target is the highest cell, so the answer is 15."),
    case("s3", False, [[3, 0, 1], [4, 8, 2], [7, 6, 5]], "Route 3 -> 0 -> 1 -> 2 -> 5; the worst cell on it is 5."),
    case("h-one-cell", True, [[0]]),
    case("h-high-start", True, [[8, 0, 1], [7, 2, 3], [6, 5, 4]], "The start cell alone forces t >= 8."),
    case("h-detour", True, [[0, 20, 1, 2, 24], [4, 21, 22, 23, 17], [6, 18, 9, 10, 16], [8, 19, 11, 14, 15], [13, 12, 7, 5, 3]],
         "The cheap cells along the top lead nowhere; the best route goes down the left edge (max 13)."),
    case("h-snake-9", True, snake_grid(9), "The only low path winds back and forth across the grid."),
]
for k, n in enumerate([3, 5, 8, 12, 20, 35]):
    tests.append(case(f"h-rand-{k}", True, random_grid(rng, n)))
tests.append(case("h-snake-57", True, snake_grid(57)))
tests.append(case("h-large-random", True, random_grid(rng, 150)))
tests.append(case("h-large-snake", True, snake_grid(117), "The answer is 6960; trying t = 0, 1, 2, ... needs thousands of flood fills."))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
