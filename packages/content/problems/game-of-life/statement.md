`board` is an `m x n` grid of cells; `1` is a live cell and `0` a dead one. Each cell has up to eight **neighbours** (horizontal, vertical and diagonal). Cells outside the grid count as dead — the board does not wrap around.

Compute the **next generation**, where every cell is updated **simultaneously** from the current generation:

1. A live cell with fewer than two live neighbours dies.
2. A live cell with two or three live neighbours stays alive.
3. A live cell with more than three live neighbours dies.
4. A dead cell with exactly three live neighbours becomes alive.

Return the next-generation board.

**Examples**

```
board = [[0, 1, 0],          ->   [[0, 0, 0],
         [0, 1, 0],                [1, 1, 1],
         [0, 1, 0]]                [0, 0, 0]]        a "blinker" flips orientation

board = [[1, 1],             ->   [[1, 1],
         [1, 0]]                   [1, 1]]           the dead corner has three live neighbours
```

**Constraints**

- `1 <= m, n <= 200`
- `board[i][j]` is `0` or `1`.

Follow-up for discussion: can you update the board in place using O(1) extra memory?
