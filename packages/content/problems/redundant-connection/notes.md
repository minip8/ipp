**Approaches**
- Brute force: for each edge from last to first, remove it and test whether the remaining graph is a tree (connected, n-1 edges) with a DFS. O(n^2).
- DFS per edge: before adding edge (a, b), DFS to see whether a already reaches b; if so, this edge is redundant. O(n^2) worst case.
- Expected: union-find over the edges in order; the first edge whose endpoints already share a root is the answer. O(n α(n)).
- Why "first edge that closes a cycle" equals "last cycle edge in input order": there is exactly one cycle, and the cycle can only become closed when its last edge (in input order) is processed.
- Alternative O(n): build the graph, find the cycle (DFS with parent, or repeatedly strip leaves), then pick the cycle edge with the largest input index.

**Common wrong turns**
- Returning the first edge of the cycle rather than the last one.
- Returning `[min, max]` instead of the edge as given.
- Assuming the extra edge is the last line of input (in `[[1,2],[2,3],[3,4],[1,4],[1,5]]` it is not).
- Forgetting nodes are 1-indexed: parent array of size n gives an out-of-bounds write on node n.

**Hint ladder**
1. Suppose you add cables one at a time to an empty network. At what moment does a cycle first appear?
2. How can you tell, at the moment you add cable (a, b), whether a and b are already connected?
3. A disjoint-set structure answers "same group?" and "merge groups" in near constant time.
4. Process edges in order; the first edge whose endpoints are already in the same set is the answer — argue why it is the latest cycle edge.

**Follow-ups**
- The graph is directed and was a rooted tree (LeetCode 685, Redundant Connection II): a node may now have two parents, or there may be a cycle, or both.
- What if several extra edges were added and you must remove the minimum set? (any spanning tree; Kruskal-style)
- Return the whole cycle.
