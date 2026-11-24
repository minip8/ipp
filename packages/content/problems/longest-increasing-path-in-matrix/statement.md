You are given an `m x n` grid of integers. A path moves from a cell to one of its four orthogonal neighbours (up, down, left, right) at each step — no diagonal moves and no wrapping around the edges.

A path is **increasing** if every step goes to a cell with a strictly larger value. Return the number of cells on the longest increasing path in the grid. A single cell is a path of length 1.

**Examples**

```
matrix = [[7, 8, 9],
          [6, 1, 2],
          [5, 4, 3]]          ->  9     (1, 2, 3, 4, 5, 6, 7, 8, 9 spirals through every cell)

matrix = [[3, 4, 5],
          [3, 2, 6],
          [2, 2, 1]]          ->  4     (3, 4, 5, 6 along the top row and down)

matrix = [[5, 5]]             ->  1     (equal values do not count as increasing)
```

**Constraints**

- `1 <= m, n <= 150`
- `0 <= matrix[i][j] <= 10^4`
