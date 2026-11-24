An image is a grid of integers, `image[r][c]` being the colour of the pixel in row `r` and column `c`.

Implement the paint-bucket tool: starting from pixel `(sr, sc)`, recolour to `color` every pixel that has the **same original colour** as the start pixel and is connected to it through a chain of such pixels moving **up, down, left or right** (not diagonally). All other pixels keep their colour.

Return the resulting image.

**Examples**

```
image = [[1,1,0],
         [1,0,2],
         [1,1,1]],  sr = 0, sc = 0, color = 5

->      [[5,5,0],
         [5,0,2],
         [5,5,5]]
```

The start pixel has colour 1. Every 1 reachable from it is painted. The 0 and 2 are untouched.

```
image = [[3,3],[3,3]], sr = 1, sc = 0, color = 3   ->   [[3,3],[3,3]]
```

Painting with the colour the region already has changes nothing.

**Constraints**

- `1 <= rows, cols <= 300`
- `0 <= image[r][c], color < 2^16`
- `0 <= sr < rows`, `0 <= sc < cols`
