"""Regenerates tests.json deterministically from the Python reference solution.

The reference is checked against brute force (an independent single-word path search run for
every word) before anything is written.
"""
import json, random, importlib.util, pathlib, time

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def exists(board, word):
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


def brute(board, words):
    return sorted(w for w in words if exists(board, w))


def case(id, hidden, board, words, explanation=None, check=True):
    assert len(set(words)) == len(words) and 1 <= len(words) <= 5000
    assert all(1 <= len(w) <= 10 for w in words) and 1 <= len(board) <= 12 and 1 <= len(board[0]) <= 12
    t0 = time.time()
    got = mod.Solution().findWords(list(board), list(words))
    took = time.time() - t0
    t1 = time.time()
    if check:
        assert sorted(got) == brute(board, words), id
    took_brute = time.time() - t1
    assert len(set(got)) == len(got), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "findWords", "args": [board, words]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    print(f"{id}: {len(got)}/{len(words)} found, {took:.3f}s (per-word brute {took_brute:.3f}s)")
    return t


rng = random.Random(212)


def rand_board(R, C, alpha):
    return ["".join(rng.choice(alpha) for _ in range(C)) for _ in range(R)]


def path_word(board, L):
    R, C = len(board), len(board[0])
    r, c = rng.randrange(R), rng.randrange(C)
    seen, out = {(r, c)}, [board[r][c]]
    while len(out) < L:
        nxt = [(r + dr, c + dc) for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
               if 0 <= r + dr < R and 0 <= c + dc < C and (r + dr, c + dc) not in seen]
        if not nxt:
            break
        r, c = rng.choice(nxt)
        seen.add((r, c)); out.append(board[r][c])
    return "".join(out)


def word_list(board, n, alpha, lo, hi, path_ratio=0.5):
    words = set()
    while len(words) < n:
        L = rng.randint(lo, hi)
        if rng.random() < path_ratio:
            w = path_word(board, L)
            if rng.random() < 0.3:          # near miss: change the last letter
                w = w[:-1] + rng.choice(alpha)
        else:
            w = "".join(rng.choice(alpha) for _ in range(L))
        words.add(w)
    out = sorted(words)
    rng.shuffle(out)
    return out


for _ in range(200):
    b = rand_board(rng.randint(1, 4), rng.randint(1, 4), "abc")
    ws = word_list(b, rng.randint(1, 10), "abc", 1, 6)
    assert sorted(mod.Solution().findWords(list(b), list(ws))) == brute(b, ws)

tests = [
    case("s1", False, ["cats", "rohe", "bnep"], ["cat", "cats", "hat", "the", "hen", "rob", "orb", "peep"],
         "cat/cats share cells; hat, rob and peep have no valid path."),
    case("s2", False, ["ab", "cd"], ["abdc", "acdb", "abc", "ad", "badc"],
         "abdc and acdb go around the square; abc would need b next to c; ad is diagonal."),
    case("h-single-cell", True, ["z"], ["z", "zz", "a"]),
    case("h-none-found", True, ["abc", "def"], ["xyz", "fda", "abf", "cfd", "aa"]),
    case("h-no-reuse", True, ["aab"], ["aaa", "aab", "baa", "aba", "ab"]),
    case("h-prefix-words", True, ["word", "xxsx"], ["w", "wo", "wor", "word", "words", "drow", "rows"],
         "Every prefix is itself a word: the search must continue past a found word."),
    case("h-shared-start", True, ["abcde", "fghij", "klmno"],
         ["abcde", "abchi", "abcdejonm", "abgf", "abghmlkf", "fklmno", "bglq"]),
]
for k in range(5):
    R, C = rng.randint(3, 8), rng.randint(3, 8)
    alpha = "abcdef" if k % 2 else "abcdefghijklmnopqrstuvwxyz"
    b = rand_board(R, C, alpha)
    tests.append(case(f"h-rand-{k}", True, b, word_list(b, rng.randint(10, 60), alpha, 2, 8)))

# Larger: full 12x12 boards with thousands of words sharing prefixes.
b = rand_board(12, 12, "abcde")
tests.append(case("h-large-small-alpha", True, b, word_list(b, 3000, "abcde", 4, 10, path_ratio=0.6)))
b = rand_board(12, 12, "eeeeaaiioonnrrsstlcdmpbgh")
tests.append(case("h-large-letters", True, b, word_list(b, 4000, "abcdeghilmnoprst", 3, 9, path_ratio=0.5)))
b = rand_board(12, 12, "abc")
tests.append(case("h-dense-prefixes", True, b, word_list(b, 5000, "abc", 7, 10, path_ratio=0.5),
                  "Thousands of words over three letters share long prefixes: one trie walk instead of 5000 searches."))
b = rand_board(12, 12, "ab")
ws = ["".join("ab"[(m >> i) & 1] for i in range(L)) for L in (9, 10) for m in range(1 << L)]
rng.shuffle(ws)
tests.append(case("h-two-letters-all-words", True, b, ws,
                  "Every a/b word of length 9 and 10: per-word searches redo the same prefix exploration."))
tests.append(case("h-all-same-letter", True, ["a" * 12] * 12, ["a" * k for k in range(1, 11)],
                  "Every word is found; pruning exhausted trie branches keeps this fast."))
tests.append(case("h-same-letter-miss", True, ["a" * 6] * 6, ["a" * k for k in range(1, 9)] + ["aaaaab", "baaaaa", "ab"],
                  "Words ending in b are never found; plain per-word search explores many paths."))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
