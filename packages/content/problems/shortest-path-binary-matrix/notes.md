**Approaches**
- Expected: BFS from (0, 0) over open cells with 8 neighbours; the BFS level when (n-1, n-1) is dequeued (counting cells, so the start is 1) is the answer. O(n^2) time and space.
- A* with Chebyshev distance as the heuristic is a nice optimisation to discuss; same worst case.
- DFS with backtracking explores exponentially many paths; even DFS with "visited" gives a path, not the shortest. Hidden tests include an open 150x150 grid and mazes where DFS-first-found is not shortest.

**Common wrong turns**
- Only 4 directions.
- Counting edges instead of cells (off by one), or returning 0 for the 1x1 open grid.
- Not checking that the start and end cells are open.
- Marking visited when dequeued instead of when enqueued: still correct, but the queue can hold each cell up to 8 times.
- Using DFS and taking the first path found.

**Hint ladder**
1. Every step costs the same. Which search finds the fewest steps in an unweighted graph?
2. What are the neighbours of a cell? (There are 8.)
3. BFS from the start, recording the distance (in cells) to each cell the first time it is reached.
4. Handle the special cases before searching: blocked start or end, and n = 1.

**Follow-ups**
- Return the path itself (parent pointers).
- Diagonal moves cost sqrt(2) (Dijkstra / A*).
- Bidirectional BFS: how much does it save?
- You may remove up to k obstacles (BFS over (cell, removals left)).
