You are given a binary grid as an array of strings: `matrix[r][c]` is the character `'1'` or `'0'`, and all rows have the same length.

Return the **area** of the largest axis-aligned square that contains only `'1'` cells. If the grid has no `'1'` at all, return `0`.

**Examples**

```
matrix = ["10100",
          "10111",
          "11111",
          "10010"]         ->  4      (the 2x2 block at rows 1-2, columns 2-3)

matrix = ["01",
          "10"]            ->  1

matrix = ["000"]           ->  0
```

**Constraints**

- `1 <= rows, cols <= 300` (`rows = matrix.length`, `cols = matrix[0].length`)
- Every character is `'0'` or `'1'`.
