You are given an `n x n` grid of `0`s (open) and `1`s (blocked).

A **clear path** goes from the top-left cell `(0, 0)` to the bottom-right cell `(n - 1, n - 1)`, visiting only open cells, where each step moves to one of the **8** neighbouring cells (horizontally, vertically or diagonally adjacent).

Return the length of the shortest clear path, measured as the **number of cells** it visits (including both ends). Return `-1` if there is no clear path — including when the start or end cell is blocked.

**Examples**

```
grid = [[0,1],
        [1,0]]          ->  2     (one diagonal step)
```

```
grid = [[0,0,0],
        [1,1,0],
        [1,1,0]]        ->  4     (0,0) -> (0,1) -> (1,2) -> (2,2)
```

```
grid = [[1,0],
        [0,0]]          ->  -1    (start is blocked)
```

```
grid = [[0]]            ->  1
```

**Constraints**

- `1 <= n <= 150`
- `grid[r][c]` is `0` or `1`
