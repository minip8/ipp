**Approaches**
- Brute force: for every top-left corner, grow the square while the new row and column are all ones. Up to O((rc) * min(r,c)^2); too slow on a 300x300 grid of ones in Python, borderline in C++.
- Prefix-sum check: binary search the side length, test each square in O(1) with a 2-D prefix sum. O(rc log min(r,c)). Fine, but heavier than needed.
- Expected: `side[r][c]` = side of the largest all-ones square whose bottom-right corner is (r, c) = `1 + min(top, left, top-left)` when the cell is '1', else 0. Answer = (max side)^2. O(rc) time, O(c) space with one row plus a saved diagonal.

**Common wrong turns**
- Returning the side length instead of the area.
- Using `min(top, left)` only (ignores a hole at the top-left; `["11","10"]` style shapes, or a '0' on the diagonal of a larger block).
- Treating the cells as integers when they are characters (`'0'` is truthy in C++ as a char).
- Confusing with "maximal rectangle" (histogram + stack); squares admit the simpler recurrence.
- 1-D rolling row: losing the old diagonal value before it is used.

**Hint ladder**
1. Fix the bottom-right corner of a square. What would you need to know about its neighbours to extend a square ending there?
2. A k x k square ending at (r, c) needs (k-1) x (k-1) squares ending at three neighbouring cells. Which three?
3. Define `side[r][c]` and write the recurrence; the boundary row and column are easy.
4. Track the maximum side and square it. Can you keep only one row?

**Follow-ups**
- Count all squares of ones (sum of `side` over all cells).
- Largest rectangle of ones (histogram per row + monotonic stack, O(rc)).
- Largest square with at most k zeros (prefix sums + binary search or two pointers on diagonals).
- The grid is streamed row by row and too wide for memory?
