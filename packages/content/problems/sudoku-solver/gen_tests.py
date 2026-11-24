"""Regenerates tests.json deterministically.

Puzzles are generated here, not copied: fill a random complete grid, then remove clues in random
order while the puzzle keeps a unique solution (checked with an independent solution counter).
Some puzzles have their digits relabelled so the solution's first row is 987654321, which makes
the naive "first empty cell, digits 1..9 in order" search explore a huge tree. The reference
output must equal the grid the puzzle was cut from and pass a full validity check.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

rng = random.Random(37)
PEERS = [[set() for _ in range(9)] for _ in range(9)]
for r in range(9):
    for c in range(9):
        for k in range(9):
            PEERS[r][c].update({(r, k), (k, c), (r // 3 * 3 + k // 3, c // 3 * 3 + k % 3)})
        PEERS[r][c].discard((r, c))


def count_solutions(g, limit=2, shuffle=False):
    """Independent solver on a dict-free list grid (0 = empty). Returns (count, first solution)."""
    g = [row[:] for row in g]
    found = []

    def cands(r, c):
        return [d for d in range(1, 10) if all(g[pr][pc] != d for pr, pc in PEERS[r][c])]

    def go():
        best = None
        for r in range(9):
            for c in range(9):
                if g[r][c] == 0:
                    cs = cands(r, c)
                    if best is None or len(cs) < len(best[2]):
                        best = (r, c, cs)
        if best is None:
            found.append([row[:] for row in g])
            return len(found) >= limit
        r, c, cs = best
        if shuffle:
            rng.shuffle(cs)
        for d in cs:
            g[r][c] = d
            if go():
                return True
        g[r][c] = 0
        return False

    go()
    return len(found), (found[0] if found else None)


def naive_nodes(g, cap=3_000_000):
    """Nodes visited by reading-order, ascending-digit backtracking (capped)."""
    g = [row[:] for row in g]
    cells = [(r, c) for r in range(9) for c in range(9) if g[r][c] == 0]
    nodes = 0

    def go(i):
        nonlocal nodes
        if i == len(cells):
            return True
        r, c = cells[i]
        for d in range(1, 10):
            nodes += 1
            if nodes > cap:
                return True
            if all(g[pr][pc] != d for pr, pc in PEERS[r][c]):
                g[r][c] = d
                if go(i + 1):
                    return True
                g[r][c] = 0
        return False

    go(0)
    return nodes


def make_puzzle(min_removed_target=None):
    _, full = count_solutions([[0] * 9 for _ in range(9)], limit=1, shuffle=True)
    puzzle = [row[:] for row in full]
    order = [(r, c) for r in range(9) for c in range(9)]
    rng.shuffle(order)
    for r, c in order:
        keep = puzzle[r][c]
        puzzle[r][c] = 0
        if count_solutions(puzzle)[0] != 1:
            puzzle[r][c] = keep
    return puzzle, full


def relabel_first_row_desc(puzzle, full):
    m = {full[0][c]: 9 - c for c in range(9)}
    return ([[m[v] if v else 0 for v in row] for row in puzzle], [[m[v] for v in row] for row in full])


def thin_to(puzzle, full, clues):
    """Add clues back (from the solution) until the puzzle has `clues` givens."""
    puzzle = [row[:] for row in puzzle]
    empties = [(r, c) for r in range(9) for c in range(9) if puzzle[r][c] == 0]
    rng.shuffle(empties)
    while sum(v != 0 for row in puzzle for v in row) < clues:
        r, c = empties.pop()
        puzzle[r][c] = full[r][c]
    return puzzle


def to_strs(g):
    return ["".join(str(v) if v else "." for v in row) for row in g]


def valid(sol, board):
    ok = all(len(row) == 9 for row in sol) and len(sol) == 9
    for i in range(9):
        ok &= set(sol[i]) == set("123456789")
        ok &= {sol[r][i] for r in range(9)} == set("123456789")
        ok &= {sol[i // 3 * 3 + k // 3][i % 3 * 3 + k % 3] for k in range(9)} == set("123456789")
    ok &= all(board[r][c] in (".", sol[r][c]) for r in range(9) for c in range(9))
    return ok


def case(id, hidden, puzzle, full, explanation=None):
    board = to_strs(puzzle)
    got = mod.Solution().solveSudoku(list(board))
    assert got == to_strs(full) and valid(got, board), id
    assert count_solutions(puzzle)[0] == 1, id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "solveSudoku", "args": [board]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


tests = []
p, f = make_puzzle()
tests.append(case("s1", False, thin_to(p, f, 36), f, "A gentle puzzle: most cells are forced by a single candidate."))
p, f = make_puzzle()
tests.append(case("s2", False, thin_to(p, f, 28), f))

p, f = make_puzzle()
tests.append(case("h-one-missing", True, thin_to(p, f, 80), f))
p, f = make_puzzle()
tests.append(case("h-row-missing", True, [row[:] if r else [0] * 9 for r, row in enumerate(f)], f,
                  "The whole first row is blank but forced by the columns."))
for k, clues in enumerate([45, 32, 30]):
    p, f = make_puzzle()
    tests.append(case(f"h-medium-{k}", True, thin_to(p, f, clues), f))

stats = []
for k in range(8):
    p, f = make_puzzle()
    tests.append(case(f"h-minimal-{k}", True, p, f, None))
    stats.append(sum(v != 0 for row in p for v in row))

# Adversarial: relabel so the first row of the solution is 9..1; keep the ones that hurt naive search most.
cands = []
for _ in range(14):
    p, f = relabel_first_row_desc(*make_puzzle())
    cands.append((naive_nodes(p), p, f))
cands.sort(key=lambda x: -x[0])
for k, (nodes, p, f) in enumerate(cands[:6]):
    tests.append(case(f"h-anti-naive-{k}", True, p, f))
    stats.append(nodes)

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests; minimal clue counts / naive nodes:", stats)
print("\n".join(tests[0]["calls"][0]["args"][0]))
print()
print("\n".join(tests[0]["expected"][0]))
