**Approaches**
- Scan every cell; on unvisited land, increment the count and flood the whole island (BFS or iterative DFS) marking it visited. O(rows * cols) time, O(rows * cols) space for the visited marks (or O(min(rows, cols)) queue for BFS if the grid itself is mutated).
- Union-find over land cells, unioning each with its right and down neighbours; answer = land cells - successful unions. Same complexity; worth discussing because it extends to the "islands added over time" follow-up.
- Recursive DFS is common and fine in concept, but a 300x300 all-land grid or a snake recurses up to 90 000 deep: Python's default limit fails and C++ may overflow. Hidden tests include a full-land grid and a long snake.

**Common wrong turns**
- Counting diagonal neighbours as connected.
- Forgetting to mark cells visited when *pushed* (not when popped) — still correct but can push the same cell many times; with marks-on-pop and no check it can blow up memory.
- In Python/Java, trying to mutate the input strings (immutable): copy to a list of lists or keep a separate visited array.
- Mixing up row/column bounds on non-square maps.

**Hint ladder**
1. Think of land cells as vertices of a graph. What is an island in graph terms?
2. If you find one land cell of an island you have not seen yet, how do you make sure you never count that island again?
3. Scan the grid; when you hit unvisited land, count it and mark its whole island visited with a BFS/DFS from there.
4. Use an explicit queue/stack rather than recursion so very large islands do not overflow.

**Follow-ups**
- Land is added one cell at a time; report the count after each addition (Number of Islands II, union-find).
- Count distinct island *shapes* (normalise the path/offset signature).
- Size of the largest island; flip at most one water cell to maximise it.
- The grid is too large for memory and arrives row by row: union-find over two rows at a time.
