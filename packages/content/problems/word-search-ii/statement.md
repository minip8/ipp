You are given a grid of lowercase letters `board` (a list of equal-length strings; `board[r][c]` is row `r`, column `c`) and a list of distinct words `words`.

Return every word from `words` that can be spelled by a **path** in the grid: start at any cell, move each step to an edge-adjacent cell (up, down, left, right — not diagonal), take one letter per cell, and never use the same cell twice within one word. Different words may use the same cells.

Each found word appears once in the result, in any order. If no word can be found, return an empty list.

**Example**

```
board = ["cats",
         "rohe",
         "bnep"]
words = ["cat", "cats", "hat", "the", "hen", "rob", "orb", "peep"]

->  ["cat", "cats", "the", "hen", "orb"]      (any order)
```

- `cat` and `cats` share cells; that is allowed because they are different words.
- `the`: t(0,2) h(1,2) e(1,3).  `hen`: h(1,2) e(2,2) n(2,1).  `orb`: o(1,1) r(1,0) b(2,0).
- `hat` fails: no `a` touches the `h`. `rob` fails: no `b` touches the `o`. `peep` fails: the two `e` cells only touch diagonally.

**Constraints**

- `1 <= board.length, board[i].length <= 12`
- `1 <= words.length <= 5000`, all words distinct
- `1 <= words[i].length <= 10`
- `board` and `words` contain only lowercase English letters.
