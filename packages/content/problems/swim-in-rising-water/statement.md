You are given an `n x n` grid where `grid[r][c]` is the ground height of cell `(r, c)`. All heights are distinct and are exactly the numbers `0` to `n*n - 1` in some order.

It starts raining. At time `t` the water level everywhere is `t`. You start in the top-left cell `(0, 0)` and want to reach the bottom-right cell `(n - 1, n - 1)`. You may move between two cells that share an edge (up, down, left, right) at time `t` only if **both** cells have height at most `t`. Movement itself takes no time, so you may travel any distance in an instant once the water is high enough.

Return the smallest time `t` at which you can get from `(0, 0)` to `(n - 1, n - 1)`.

**Examples**

```
grid = [[0, 2],
        [1, 3]]        ->   3
```
You cannot stand on the target cell until the level reaches its height 3.

```
grid = [[0,  1,  2,  3],
        [11, 10, 9,  4],
        [12, 13, 14, 5],
        [8,  7,  6,  15]] ->  15
```

```
grid = [[3, 0, 1],
        [4, 8, 2],
        [7, 6, 5]]     ->   5
```
The route `3 -> 0 -> 1 -> 2 -> 5` never needs a level above 5, and the start itself needs 3.

**Constraints**

- `1 <= n <= 200`
- `grid` is a permutation of `0 .. n*n - 1`
