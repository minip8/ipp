Return all elements of an `m x n` matrix in **clockwise spiral order**: start at the top-left corner, go right along the top row, down the right column, left along the bottom row, up the left column, and keep spiralling inwards until every element has been visited exactly once.

**Examples**

```
matrix = [[1, 2, 3],
          [4, 5, 6],
          [7, 8, 9]]            ->   [1, 2, 3, 6, 9, 8, 7, 4, 5]

matrix = [[1, 2, 3, 4],
          [5, 6, 7, 8]]         ->   [1, 2, 3, 4, 8, 7, 6, 5]

matrix = [[1], [2], [3]]        ->   [1, 2, 3]
```

**Constraints**

- `1 <= m, n <= 150` (every row has the same length `n`)
- `-1000 <= matrix[i][j] <= 1000`
