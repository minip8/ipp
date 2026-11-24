"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against an independent union-find count on random grids.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(grid):
    rows, cols = len(grid), len(grid[0])
    parent = {}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == "1":
                parent[(r, c)] = (r, c)
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] != "1":
                continue
            for nr, nc in ((r + 1, c), (r, c + 1)):
                if nr < rows and nc < cols and grid[nr][nc] == "1":
                    parent[find((r, c))] = find((nr, nc))
    return len({find(x) for x in parent})


def case(id, hidden, grid, explanation=None):
    got = mod.Solution().numIslands(list(grid))
    assert got == brute(grid), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "numIslands", "args": [grid]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_grid(rng, rows, cols, p):
    return ["".join("1" if rng.random() < p else "0" for _ in range(cols)) for _ in range(rows)]


rng = random.Random(200)
for _ in range(400):
    g = rand_grid(rng, rng.randint(1, 8), rng.randint(1, 8), rng.random())
    assert mod.Solution().numIslands(g) == brute(g)

tests = [
    case("s1", False, ["11000", "11000", "00100", "00011"], "Three separate groups of land."),
    case("s2", False, ["101", "010", "101"], "Diagonal contact does not connect cells, so each 1 is its own island."),
    case("s3", False, ["11110", "11010", "11000", "00000"], "All land is one island."),
    case("h-all-water", True, ["000", "000"]),
    case("h-single-land", True, ["1"]),
    case("h-single-water", True, ["0"]),
    case("h-one-row", True, ["1011011101"]),
    case("h-one-column", True, ["1", "1", "0", "1", "0", "0", "1"]),
    case("h-ring-with-lake", True, ["11111", "10001", "10101", "10001", "11111"],
         "A ring of land around a lake with an island in the middle: 2."),
    case("h-checkerboard", True, ["".join("1" if (r + c) % 2 == 0 else "0" for c in range(30)) for r in range(30)]),
    case("h-u-shape", True, ["10001", "10001", "10001", "11111"]),
]
for k, (rows, cols, p) in enumerate([(5, 7, 0.4), (10, 10, 0.5), (20, 15, 0.45), (30, 40, 0.55), (50, 50, 0.6), (60, 30, 0.3)]):
    tests.append(case(f"h-rand-{k}", True, rand_grid(rng, rows, cols, p)))

# Full land 300x300: recursion depth breaks naive recursive DFS.
tests.append(case("h-all-land", True, ["1" * 300] * 300))
# Snake: one island, a single path of ~22 000 cells.
R = C = 200
snake = []
for r in range(R):
    if r % 2 == 0:
        snake.append("1" * C)
    elif r % 4 == 1:
        snake.append("0" * (C - 1) + "1")
    else:
        snake.append("1" + "0" * (C - 1))
tests.append(case("h-snake", True, snake))
# Many small islands at max size (percolation threshold-ish density).
tests.append(case("h-large-random", True, rand_grid(rng, 300, 300, 0.55)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
