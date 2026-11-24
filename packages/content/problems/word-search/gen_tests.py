"""Regenerates tests.json deterministically from the Python reference solution.

The reference (which prunes by letter counts and may search the reversed word) is checked against
a plain backtracking search with no pruning on small random boards before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(board, word):
    R, C = len(board), len(board[0])
    used = set()

    def dfs(r, c, i):
        if not (0 <= r < R and 0 <= c < C) or (r, c) in used or board[r][c] != word[i]:
            return False
        if i == len(word) - 1:
            return True
        used.add((r, c))
        ok = any(dfs(r + dr, c + dc, i + 1) for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        used.discard((r, c))
        return ok

    return any(dfs(r, c, 0) for r in range(R) for c in range(C))


def case(id, hidden, board, word, explanation=None, check=True):
    got = mod.Solution().exist(list(board), word)
    if check:
        assert got == brute(board, word), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "exist", "args": [board, word]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(79)


def rand_board(R, C, alpha):
    return ["".join(rng.choice(alpha) for _ in range(C)) for _ in range(R)]


def path_word(board, L):
    """A word read along a random self-avoiding path (so the answer is usually true)."""
    R, C = len(board), len(board[0])
    while True:
        r, c = rng.randrange(R), rng.randrange(C)
        seen, out = {(r, c)}, [board[r][c]]
        while len(out) < L:
            nxt = [(r + dr, c + dc) for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                   if 0 <= r + dr < R and 0 <= c + dc < C and (r + dr, c + dc) not in seen]
            if not nxt:
                break
            r, c = rng.choice(nxt)
            seen.add((r, c)); out.append(board[r][c])
        if len(out) == L:
            return "".join(out)


for _ in range(400):
    R, C = rng.randint(1, 4), rng.randint(1, 4)
    b = rand_board(R, C, "ABC")
    w = "".join(rng.choice("ABC") for _ in range(rng.randint(1, 7)))
    assert mod.Solution().exist(list(b), w) == brute(b, w)

EX = ["CAT", "XOD", "GSE"]
tests = [
    case("s1", False, EX, "ATDOS", "A(0,1) T(0,2) D(1,2) O(1,1) S(2,1), each step to an edge neighbour."),
    case("s2", False, EX, "TODO", "There is only one O and a cell cannot be reused."),
    case("s3", False, EX, "CATDOG", "G is diagonal to O, not adjacent."),
    case("s4", False, ["AB", "BA"], "ABAB", "A loop around the 2x2 square."),
    case("h-single-cell-yes", True, ["q"], "q"),
    case("h-single-cell-no", True, ["q"], "Q", "Case matters."),
    case("h-too-long", True, ["AB"], "ABA", "Would need to reuse the A."),
    case("h-diagonal-only", True, ["AX", "XB"], "AB"),
    case("h-backtrack-needed", True, ["ABCE", "SFES", "ADEE"], "ABCESEEEFS",
         "The first branch into the E block fails; unmarking lets a later branch use those cells."),
    case("h-row", True, ["abcdef"], "fedcba"),
    case("h-column", True, ["a", "b", "c", "d", "e", "f"], "cdef"),
    case("h-snake-full", True, ["ABCDEF", "LKJIHG", "MNOPQR"], "ABCDEFGHIJKLMNO"),
    case("h-spiral", True, ["ABCD", "LMNE", "KPOF", "JIHG"], "ABCDEFGHIJKLMNO"),
    case("h-all-a-missing-b", True, ["AAAAAA"] * 6, "AAAAAAAAAAAAAAB",
         "Classic worst case: a letter-count check rejects it instantly; plain DFS explores millions of paths.", check=False),
    case("h-all-a-b-corner", True, ["AAAAAA"] * 5 + ["AAAAAB"], "BAAAAAAAAAAAAAA"),
    case("h-all-a-true", True, ["AAAAAA"] * 6, "AAAAAAAAAAAAAAA"),
    case("h-parity-false", True, ["AAAAA", "AAAAA", "AACAA", "AAAAA", "AAAAB"], "C" + "A" * 8 + "B",
         "Grid colouring: a 10-cell path from C must end on C's colour; B is on the other one."),
]
for k in range(10):
    R, C = rng.randint(2, 6), rng.randint(2, 6)
    b = rand_board(R, C, "ABCD" if k % 2 else "ABCDEFGH")
    L = rng.randint(3, min(15, R * C))
    w = path_word(b, L) if k % 3 != 2 else "".join(rng.choice("ABCD") for _ in range(L))
    tests.append(case(f"h-rand-{k}", True, b, w))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests", sum(t["expected"][0] for t in tests), "true")
