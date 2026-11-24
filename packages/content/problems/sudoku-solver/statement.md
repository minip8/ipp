Solve a 9 x 9 Sudoku puzzle.

`board` has 9 strings of 9 characters each, one per row from top to bottom. A character is either a digit `'1'`–`'9'` (a given clue) or `'.'` (an empty cell). Return the completed grid in the same format — 9 strings of 9 digits — such that:

- every row contains each digit `1`–`9` exactly once,
- every column contains each digit `1`–`9` exactly once,
- each of the nine 3 x 3 boxes (rows 0–2/3–5/6–8 crossed with columns 0–2/3–5/6–8) contains each digit `1`–`9` exactly once,
- every clue from `board` is kept in its cell.

Every input has **exactly one** solution, so the answer is unique. Some puzzles have very few clues and are designed so that trying cells in reading order with digits in increasing order explores a very large search tree.

**Example**

```
board = ["5..3.64..",          result = ["527316498",
         ".8.......",                    "481952637",
         "63.74852.",                    "639748521",
         "9..1..863",                    "945127863",
         ".6348...9",                    "263485719",
         ".7....254",                    "178693254",
         "..4.6..7.",                    "894261375",
         "7.6...982",                    "716534982",
         "3.....1.."]                    "352879146"]
```

**Constraints**

- `board.length == 9`, `board[i].length == 9`
- `board[i][j]` is a digit `'1'`–`'9'` or `'.'`.
- The clues do not conflict, and the puzzle has exactly one solution.
