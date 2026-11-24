**Approaches**
- DFS/BFS: build an adjacency list, start a traversal from every unvisited node, count how many traversals you start. O(n + m) time and space.
- Union-find: start with n components, decrement on every union that merges two different roots. With path compression and union by size/rank, near O(m α(n)). Doesn't even need an adjacency list.
- Either is fine; ask the candidate to justify which they prefer (union-find is natural when edges arrive as a stream).

**Common wrong turns**
- Returning the number of edges-derived groups only, forgetting isolated nodes (n = 3, edges = [] -> 3).
- Decrementing the count on every edge, including edges inside an existing component (cycles, duplicate edges).
- Recursive DFS in Python on a path of 10^5 nodes: hits the recursion limit. Use an explicit stack or union-find.
- Union-find without path compression or union by rank: a long chain makes `find` O(n), O(n·m) in the worst case.

**Hint ladder**
1. If you start exploring from node 0, which nodes will you reach? What does that set represent?
2. Every time you need to start a fresh exploration from an unvisited node, you've found a new component.
3. Alternative view: start with every node alone and merge groups as you read edges. When does a merge actually reduce the count?
4. Keep a parent array; an edge reduces the count only when its endpoints have different roots.

**Follow-ups**
- Edges arrive one at a time and you must report the count after each. (union-find, online)
- Edges can also be deleted. (much harder: offline tricks / dynamic connectivity; discuss only)
- Return the size of the largest component, or the components themselves.
- Directed graph: what changes? (weakly vs strongly connected components)
