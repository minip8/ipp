"""Regenerates tests.json deterministically from the Python reference solution.

The reference is checked against brute force over all column permutations (one queen per row and
column, diagonals filtered) and against the known solution counts before anything is written.
"""
import json, importlib.util, pathlib, itertools

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

KNOWN = {1: 1, 2: 0, 3: 0, 4: 2, 5: 10, 6: 4, 7: 40, 8: 92, 9: 352}


def render(n, perm):
    return tuple("." * c + "Q" + "." * (n - c - 1) for c in perm)


def brute(n):
    out = []
    for perm in itertools.permutations(range(n)):
        if len({r - c for r, c in enumerate(perm)}) == n and len({r + c for r, c in enumerate(perm)}) == n:
            out.append(render(n, perm))
    return sorted(out)


def case(id, hidden, n, explanation=None):
    got = mod.Solution().solveNQueens(n)
    assert len(got) == KNOWN[n], id
    assert sorted(map(tuple, got)) == brute(n), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "solveNQueens", "args": [n]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


tests = [
    case("s1", False, 4, "Two placements, mirror images of each other; both are listed."),
    case("s2", False, 1),
    case("s3", False, 3, "Impossible on a 3x3 board."),
    case("h-n2", True, 2),
    case("h-n5", True, 5),
    case("h-n6", True, 6, "Only 4 solutions: fewer than for n = 5."),
    case("h-n7", True, 7),
    case("h-n8", True, 8),
    case("h-n9", True, 9),
]

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
