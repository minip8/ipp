A map is given as a list of equal-length strings. Character `grid[r][c]` is `'1'` for land and `'0'` for water.

An **island** is a maximal group of land cells connected horizontally or vertically (diagonal contact does not connect). Everything outside the map counts as water.

Return the number of islands.

**Examples**

```
grid = ["11000",
        "11000",
        "00100",
        "00011"]          ->  3
```

The 2x2 block at the top left, the single cell in the middle and the pair at the bottom right.

```
grid = ["101",
        "010",
        "101"]            ->  5
```

Cells that only touch diagonally are separate islands.

**Constraints**

- `1 <= rows, cols <= 300`
- every string has length `cols` and contains only `'0'` and `'1'`
