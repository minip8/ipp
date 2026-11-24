**Approaches**
- Reformulation: find a path from start to end minimising the **maximum** height on the path (a minimax / bottleneck path). The answer is that maximum.
- Dijkstra variant: priority queue keyed by the path's max height so far; pop the smallest, push neighbours with `max(cur, grid[nb])`. The first time the target is popped, that key is the answer. O(n^2 log n).
- Binary search on t + BFS/DFS restricted to cells with height <= t: O(n^2 log n^2).
- Union-find in height order: add cells from lowest to highest, union with already-added neighbours, stop when start and end are connected; the current height is the answer. O(n^2 α). Neat because heights are a permutation (sort is a counting pass).
- Naive: try t = 0, 1, 2, ... with a BFS each time: O(n^4); too slow at n = 200 (1.6 * 10^9).

**Common wrong turns**
- Plain shortest path (sum of heights) instead of the maximum along the path.
- Greedy "always step to the lowest neighbour" without a global priority queue — gets stuck in dead ends.
- Forgetting that the start cell's own height counts (grid[0][0] may be large) — answer is at least max(grid[0][0], grid[n-1][n-1]).
- Marking a cell visited when pushed rather than when popped is fine here only if keys can't improve later; reason about it.
- n = 1: the answer is grid[0][0] = 0.

**Hint ladder**
1. For a fixed time t, how would you check whether you can get across?
2. That check is monotone in t. What does that let you do? Is there something even more direct?
3. The cost of a path is the largest height on it. Which shortest-path algorithm adapts to "max" instead of "sum"?
4. Dijkstra with a min-heap keyed by the path maximum so far; alternatively add cells in increasing height with union-find until start and end connect.

**Follow-ups**
- Return the path as well.
- Heights are not distinct / grid is not square / diagonal moves allowed.
- Many queries (different start/end pairs) on the same grid: Kruskal reconstruction tree or minimum spanning tree + LCA max-edge queries.
