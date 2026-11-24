You are given a grid of letters `board`, given as a list of equal-length strings (`board[r][c]` is the letter in row `r`, column `c`), and a string `word`.

Return `true` if `word` can be spelled by a **path** in the grid: start at any cell, and move each step to a cell that shares an edge with the current one (up, down, left or right — not diagonally). Consecutive letters of `word` must come from consecutive cells on the path, and **no cell may be used more than once** in the same path. Otherwise return `false`.

**Examples**

```
board = ["CAT",
         "XOD",
         "GSE"]

word = "CATDOG"   ->  false    (after C-A-T-D-O, G is not adjacent to O)
word = "TODO"     ->  false    (the only O would have to be used twice)
word = "COSE"     ->  false    (C is not adjacent to O)
word = "ATDOS"    ->  true     (A(0,1) T(0,2) D(1,2) O(1,1) S(2,1))
```

```
board = ["AB", "BA"], word = "ABAB"   ->  true    (a loop around the 2x2 square)
```

**Constraints**

- `1 <= board.length, board[i].length <= 6`
- `1 <= word.length <= 15`
- `board` and `word` contain only uppercase and lowercase English letters; case matters (`'a'` is not `'A'`).
