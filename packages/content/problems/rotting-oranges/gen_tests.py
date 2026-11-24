"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against a minute-by-minute full-grid simulation on small random crates.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(grid):
    g = [row[:] for row in grid]
    rows, cols = len(g), len(g[0])
    t = 0
    while True:
        nxt = [row[:] for row in g]
        for r in range(rows):
            for c in range(cols):
                if g[r][c] == 1 and any(0 <= r + dr < rows and 0 <= c + dc < cols and g[r + dr][c + dc] == 2
                                        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    nxt[r][c] = 2
        if nxt == g:
            break
        g, t = nxt, t + 1
    return -1 if any(1 in row for row in g) else t


def case(id, hidden, grid, explanation=None):
    got = mod.Solution().orangesRotting([row[:] for row in grid])
    if len(grid) * len(grid[0]) <= 900:
        assert got == brute(grid), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "orangesRotting", "args": [grid]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_grid(rng, rows, cols, pe, pr):
    out = []
    for _ in range(rows):
        row = []
        for _ in range(cols):
            x = rng.random()
            row.append(0 if x < pe else 2 if x < pe + pr else 1)
        out.append(row)
    return out


rng = random.Random(994)
for _ in range(400):
    g = rand_grid(rng, rng.randint(1, 7), rng.randint(1, 7), rng.random() * 0.5, rng.random() * 0.3)
    assert mod.Solution().orangesRotting(g) == brute(g)

tests = [
    case("s1", False, [[2, 1, 1], [1, 1, 0], [0, 1, 1]], "The rot needs 4 minutes to reach (2,2)."),
    case("s2", False, [[2, 1, 1], [0, 1, 1], [1, 0, 1]], "The orange at (2,0) is cut off and never rots."),
    case("s3", False, [[0, 2, 0]], "No fresh oranges at the start: 0 minutes."),
    case("h-all-empty", True, [[0, 0], [0, 0]]),
    case("h-fresh-no-rotten", True, [[1]]),
    case("h-single-rotten", True, [[2]]),
    case("h-two-sources", True, [[2, 1, 1, 1, 1, 1, 2]],
         "Both ends spread simultaneously: 3 minutes, not 6."),
    case("h-sim-same-minute", True, [[2, 1, 1, 1]],
         "Rotting in place during one scan would finish in 1 'minute'; the answer is 3."),
    case("h-blocked-by-empty", True, [[2, 0, 1], [0, 0, 0], [1, 1, 2]]),
    case("h-column", True, [[1], [1], [2], [1], [1], [1]]),
]
for k, (rows, cols, pe, pr) in enumerate([(5, 5, 0.2, 0.1), (8, 12, 0.15, 0.05), (15, 15, 0.1, 0.02), (25, 20, 0.3, 0.05),
                                           (30, 30, 0.05, 0.01), (10, 40, 0.25, 0.1)]):
    tests.append(case(f"h-rand-{k}", True, rand_grid(rng, rows, cols, pe, pr)))

# Snake of fresh oranges with a single rotten end: ~10 000 minutes; simulation-by-scan is O(cells^2).
R = C = 200
snake = []
for r in range(R):
    if r % 2 == 0:
        snake.append([1] * C)
    elif r % 4 == 1:
        snake.append([0] * (C - 1) + [1])
    else:
        snake.append([1] + [0] * (C - 1))
snake[0][0] = 2
tests.append(case("h-snake", True, snake))
# Full crate, one rotten orange in a corner.
full = [[1] * 200 for _ in range(200)]
full[199][199] = 2
tests.append(case("h-full-corner", True, full))
# Large random with one unreachable fresh orange walled off.
big = rand_grid(rng, 150, 150, 0.1, 0.002)
big[0][0], big[0][1], big[1][0] = 1, 0, 0
tests.append(case("h-large-unreachable", True, big))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
