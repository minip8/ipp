Given a list of points on a plane, `points[i] = [x, y]`, and an integer `k`, return the `k` points closest to the origin `(0, 0)` by Euclidean distance.

The input is chosen so the answer is unique: the `k`-th closest point is strictly closer than the `(k + 1)`-th. Points may repeat; a repeated point counts once per occurrence. Return the `k` points as `[x, y]` pairs **in any order**.

**Examples**

```
points = [[1, 3], [-2, 2], [5, -1]], k = 2   ->   [[-2, 2], [1, 3]]
```
Squared distances are 10, 8 and 26, so the two closest are `[-2, 2]` (8) and `[1, 3]` (10).

```
points = [[0, 4], [3, 3], [-1, -1], [2, -5]], k = 1   ->   [[-1, -1]]
```

**Constraints**

- `1 <= k <= points.length <= 10^4` (when `k == points.length`, return every point)
- `-10^4 <= x, y <= 10^4`
