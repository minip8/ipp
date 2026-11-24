"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, copy

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(mat):
    """Direction simulation with a visited grid."""
    m, n = len(mat), len(mat[0]); seen = [[False] * n for _ in range(m)]
    out, i, j, d = [], 0, 0, 0
    dirs = [(0, 1), (1, 0), (0, -1), (-1, 0)]
    for _ in range(m * n):
        out.append(mat[i][j]); seen[i][j] = True
        ni, nj = i + dirs[d][0], j + dirs[d][1]
        if not (0 <= ni < m and 0 <= nj < n) or seen[ni][nj]:
            d = (d + 1) % 4; ni, nj = i + dirs[d][0], j + dirs[d][1]
        i, j = ni, nj
    return out

def case(id, hidden, mat, explanation=None):
    exp = mod.Solution().spiralOrder(copy.deepcopy(mat))
    assert exp == brute(mat)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "spiralOrder", "args": [mat]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(54)
def seq(m, n):
    return [[i * n + j + 1 for j in range(n)] for i in range(m)]
def rand(m, n):
    return [[rng.randint(-1000, 1000) for _ in range(n)] for _ in range(m)]
for m in range(1, 9):
    for n in range(1, 9):
        assert mod.Solution().spiralOrder(seq(m, n)) == brute(seq(m, n))

tests = [
    case("s1", False, seq(3, 3)),
    case("s2", False, seq(2, 4)),
    case("s3", False, [[1], [2], [3]], "A single column."),
    case("h-1x1", True, [[-7]]),
    case("h-1xn", True, seq(1, 6)),
    case("h-wide-3x6", True, seq(3, 6), "A single middle row remains after the first ring."),
    case("h-tall-6x3", True, seq(6, 3), "A single middle column remains after the first ring."),
    case("h-4x4", True, seq(4, 4)),
    case("h-5x4", True, seq(5, 4)),
    case("h-2x2", True, seq(2, 2)),
    case("h-7x2", True, seq(7, 2)),
]
for k, (m, n) in enumerate([(5, 9), (13, 7), (30, 31), (1, 150), (150, 1)]):
    tests.append(case(f"h-rand-{k}", True, rand(m, n)))
tests.append(case("h-large", True, rand(150, 150)))
tests.append(case("h-large-odd", True, rand(61, 47)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
