Place `n` chess queens on an `n x n` board so that no two queens attack each other: no two share a row, a column, or a diagonal (in either direction).

Return **every** such placement. Each placement is a board written as `n` strings of length `n`, one per row from top to bottom, where `'Q'` marks a queen and `'.'` an empty square. Every distinct placement must appear exactly once; the boards may be listed in any order. Boards that are rotations or reflections of each other are still different placements and must all be listed. If there is no placement, return an empty list.

**Examples**

```
n = 4   ->   [[".Q..",
               "...Q",
               "Q...",
               "..Q."],
              ["..Q.",
               "Q...",
               "...Q",
               ".Q.."]]

n = 1   ->   [["Q"]]
n = 3   ->   []
```

**Constraints**

- `1 <= n <= 9`
