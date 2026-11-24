**Approaches**
- Brute force: from every cell, DFS/BFS downhill to see which oceans it reaches. O((rows * cols)^2) — at 200x200 that is 1.6 * 10^9; hidden tests on large flat/plateau grids make it time out.
- Expected: reverse the flow. BFS/DFS from all Pacific border cells moving to neighbours whose height is **>=** the current one; that marks every cell that can drain to the Pacific. Do the same from Atlantic border cells. Answer = cells marked by both. O(rows * cols) time and space.
- Memoising per-cell results of the forward DFS is tricky because of plateaus (equal heights form cycles); the reverse search avoids that entirely.

**Common wrong turns**
- Using strict `>` in the reverse search (equal heights must flow).
- Forgetting corner cells belong to both border sets (top-right and bottom-left touch both oceans).
- Forward DFS with memoisation on plateaus: a cell in the middle of a cycle reads a partially computed answer — wrong results. A hidden test has big plateaus.
- Recursion depth on a 200x200 grid with a long monotone path (use an explicit stack or BFS).
- Swapping rows/columns on non-square grids.

**Hint ladder**
1. Checking every cell separately repeats a lot of work. Can you ask the question from the oceans' side instead?
2. If water can flow from A down to B, then going "uphill" from B reaches A. Which cells can you reach going uphill from the Pacific shore?
3. Run one multi-source search from the Pacific border and one from the Atlantic border, each moving only to neighbours at least as high.
4. Return the intersection of the two visited sets.

**Follow-ups**
- Return only the count; return cells that reach exactly one ocean.
- Heights change over time (cells eroded) — what can you reuse?
- More than two oceans / arbitrary sink cells.
- Memory for a huge grid stored on disk.
