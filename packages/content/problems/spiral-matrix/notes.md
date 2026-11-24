**Approaches**
- Expected (boundaries): keep `top`, `bottom`, `left`, `right`. Walk the top row and shrink `top`; walk the right column and shrink `right`; if rows remain walk the bottom row backwards and shrink `bottom`; if columns remain walk the left column upwards and shrink `left`. O(m * n) time, O(1) extra.
- Direction simulation: move with a direction vector, turning right when the next cell is out of bounds or already visited. O(m * n) time; O(m * n) for the visited marks (or mark in place — but don't destroy the caller's data).
- Layer by layer (rings), handling a single remaining row/column at the centre.

**Common wrong turns**
- Single row or single column remaining in the middle: elements visited twice (`[[1, 2, 3, 4], [5, 6, 7, 8]]`, `[[1], [2], [3]]`). The guards `top <= bottom` / `left <= right` before the 3rd and 4th legs are the crux.
- Off-by-one at corners (corner elements emitted twice).
- Assuming a square matrix.

**Hint ladder**
1. Which part of the matrix is "done" after you walk the top row once?
2. Can you describe the unvisited region with four numbers that you update after each leg?
3. After walking the top row and the right column, check whether a row and a column still remain before walking back.

**Follow-ups**
- Spiral Matrix II: fill an n x n matrix with 1..n^2 in spiral order.
- Counter-clockwise or starting from the centre.
- Walk in spiral order from an arbitrary starting cell in an unbounded grid, collecting cells inside the matrix (Spiral Matrix III).
