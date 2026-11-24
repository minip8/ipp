**Approaches**
- BFS or iterative DFS from `source` over an adjacency list, stopping early when `destination` is reached. O(n + m) time and space.
- Union-find over all edges, then compare roots of `source` and `destination`. O((n + m) α(n)). Good to hear both; union-find is natural if many queries follow.
- Recursive DFS works in concept but with a path-shaped graph of 2*10^5 vertices it overflows the default Python recursion limit (and can blow a C++ stack). One hidden test is a long chain for exactly this reason.

**Common wrong turns**
- Treating edges as directed (only adding `u -> v`).
- Forgetting the visited set, so cycles loop forever.
- Returning `false` when `source == destination` and there are no edges.
- Rebuilding / scanning the full edge list for every vertex visited: O(n * m), too slow on the large tests.

**Hint ladder**
1. How would you represent the graph so you can quickly list a vertex's neighbours?
2. Starting at `source`, which vertices can you reach in one step? In two?
3. Explore outward with a queue or explicit stack, marking vertices visited so each is processed once.
4. Alternatively, merge the endpoints of every edge into sets and ask whether `source` and `destination` ended up in the same set.

**Follow-ups**
- Many `(source, destination)` queries on the same graph? (components once, then O(1) per query)
- Edges arrive over time interleaved with queries? (union-find)
- Edges can also be deleted? (much harder: offline reverse processing or dynamic connectivity)
- Return the actual path, or the shortest one? (BFS parent pointers)
