"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against a per-cell forward search (brute force) on small grids.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(h):
    rows, cols = len(h), len(h[0])
    out = []
    for r0 in range(rows):
        for c0 in range(cols):
            seen = {(r0, c0)}; stack = [(r0, c0)]; pac = atl = False
            while stack:
                r, c = stack.pop()
                if r == 0 or c == 0: pac = True
                if r == rows - 1 or c == cols - 1: atl = True
                for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                    if 0 <= nr < rows and 0 <= nc < cols and (nr, nc) not in seen and h[nr][nc] <= h[r][c]:
                        seen.add((nr, nc)); stack.append((nr, nc))
            if pac and atl:
                out.append([r0, c0])
    return out


def norm(cells):
    return sorted(map(tuple, cells))


def case(id, hidden, h, explanation=None):
    got = mod.Solution().pacificAtlantic([row[:] for row in h])
    if len(h) * len(h[0]) <= 400:
        assert norm(got) == norm(brute(h)), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "pacificAtlantic", "args": [h]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_h(rng, rows, cols, hmax):
    return [[rng.randint(0, hmax) for _ in range(cols)] for _ in range(rows)]


rng = random.Random(417)
for _ in range(300):
    h = rand_h(rng, rng.randint(1, 6), rng.randint(1, 6), rng.choice([1, 3, 10]))
    assert norm(mod.Solution().pacificAtlantic(h)) == norm(brute(h))

tests = [
    case("s1", False, [[1, 2, 3], [8, 9, 4], [7, 6, 5]],
         "(0,0) and (0,1) cannot reach the Atlantic; every other cell reaches both oceans."),
    case("s2", False, [[5]], "A single cell touches both oceans."),
    case("s3", False, [[3, 3, 3], [3, 1, 3], [3, 3, 3]],
         "Equal heights let water flow; the pit in the middle cannot flow out."),
    case("h-one-row", True, [[4, 1, 7, 2]]),
    case("h-one-col", True, [[4], [1], [7]]),
    case("h-ascending-diagonal", True, [[0, 1, 2, 3], [1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]]),
    case("h-ridge", True, [[1, 1, 1, 1, 1], [1, 9, 9, 9, 1], [1, 9, 1, 9, 1], [1, 9, 9, 9, 1], [1, 1, 1, 1, 1]]),
    case("h-corners-only", True, [[1, 5, 5, 1], [5, 6, 6, 5], [5, 6, 6, 5], [1, 5, 5, 1]]),
]
for k, (rows, cols, hmax) in enumerate([(5, 5, 5), (6, 9, 3), (10, 10, 20), (12, 7, 2), (20, 20, 50), (15, 25, 4)]):
    tests.append(case(f"h-rand-{k}", True, rand_h(rng, rows, cols, hmax)))

# Plateaus: blocks of equal height (forward DFS with memo breaks on these).
P = [[(r // 7 + c // 9) % 4 for c in range(60)] for r in range(60)]
tests.append(case("h-plateaus", True, P))
# Flat plateau: everything reaches both oceans; per-cell search is quadratic.
tests.append(case("h-flat", True, [[3] * 70 for _ in range(70)]))
# Large random with small height range.
tests.append(case("h-large-random", True, rand_h(rng, 100, 100, 6)))
# A smooth "valley" landscape.
V = [[abs(r - 50) + abs(c - 40) for c in range(80)] for r in range(100)]
tests.append(case("h-valley", True, V))
M = [[200 - abs(r - 50) - abs(c - 40) + (r * c) % 3 for c in range(80)] for r in range(100)]
tests.append(case("h-mountain", True, M))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
