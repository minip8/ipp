You are given `points`, where `points[i] = [x, y]` is a location on a grid. Laying a cable directly between points `i` and `j` costs their **Manhattan distance** `|x_i - x_j| + |y_i - y_j|`.

Return the minimum total cost of a set of cables such that every point is connected to every other point, directly or through other points. Cables may only run between two of the given points.

**Examples**

```
points = [[0, 0], [2, 2], [3, 10], [5, 2], [7, 0]]   ->   20
```
One optimal set: `[0,0]-[2,2]` (4), `[2,2]-[5,2]` (3), `[5,2]-[7,0]` (4), `[2,2]-[3,10]` (9). Total 20.

```
points = [[3, 12], [-2, 5], [-4, 1]]   ->   18
```

```
points = [[0, 0]]   ->   0
```

**Constraints**

- `1 <= points.length <= 1000`
- `-10^6 <= x, y <= 10^6`
- All points are distinct.
- The answer fits in a 32-bit signed integer.
