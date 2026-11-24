"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, copy

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(b):
    m, n = len(b), len(b[0])
    def nb(i, j):
        return sum(b[r][c] for r in range(i - 1, i + 2) for c in range(j - 1, j + 2)
                   if (r, c) != (i, j) and 0 <= r < m and 0 <= c < n)
    return [[1 if nb(i, j) == 3 or (b[i][j] and nb(i, j) == 2) else 0 for j in range(n)] for i in range(m)]

def case(id, hidden, b, explanation=None):
    exp = mod.Solution().gameOfLife(copy.deepcopy(b))
    assert exp == brute(b)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "gameOfLife", "args": [b]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(289)
def rand(m, n, p=0.4):
    return [[1 if rng.random() < p else 0 for _ in range(n)] for _ in range(m)]
for _ in range(1000):
    b = rand(rng.randint(1, 6), rng.randint(1, 6))
    assert mod.Solution().gameOfLife(copy.deepcopy(b)) == brute(b)

def place(m, n, pattern, r, c):
    b = [[0] * n for _ in range(m)]
    for i, row in enumerate(pattern):
        for j, v in enumerate(row): b[r + i][c + j] = v
    return b

glider = [[0, 1, 0], [0, 0, 1], [1, 1, 1]]
tests = [
    case("s1", False, [[0, 1, 0], [0, 1, 0], [0, 1, 0]], "A blinker: the vertical line becomes horizontal."),
    case("s2", False, [[1, 1], [1, 0]], "The dead corner has exactly three live neighbours."),
    case("s3", False, [[1]], "A lone cell dies of underpopulation."),
    case("h-all-dead", True, [[0, 0, 0], [0, 0, 0]]),
    case("h-all-alive-3x3", True, [[1] * 3 for _ in range(3)], "Overpopulation everywhere except the corners."),
    case("h-block", True, place(4, 4, [[1, 1], [1, 1]], 1, 1), "A still life."),
    case("h-glider", True, place(6, 6, glider, 0, 0)),
    case("h-glider-edge", True, place(4, 4, glider, 1, 1), "Pattern touching the border: no wrap-around."),
    case("h-single-row", True, [[1, 1, 1, 0, 1, 1]]),
    case("h-single-col", True, [[1], [1], [1], [1]]),
    case("h-toad", True, place(6, 6, [[0, 1, 1, 1], [1, 1, 1, 0]], 2, 1)),
]
for k, (m, n, p) in enumerate([(5, 8, 0.4), (20, 13, 0.3), (50, 50, 0.5), (1, 200, 0.6), (200, 1, 0.6)]):
    tests.append(case(f"h-rand-{k}", True, rand(m, n, p)))
tests.append(case("h-large", True, rand(200, 200, 0.35)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
