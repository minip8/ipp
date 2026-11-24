**Approaches**
- This is a minimum spanning tree on the complete graph with n(n-1)/2 edges.
- Prim with an array (dense Prim): keep `dist[v]` = cheapest edge from the tree to v; n times pick the cheapest non-tree vertex (linear scan) and relax all others. O(n^2) time, O(n) space. Best fit for a complete graph.
- Prim with a binary heap: O(n^2 log n) because there are ~n^2 edge pushes; fine at n = 1000 in C++, slow-ish in Python.
- Kruskal: generate all ~500k edges, sort, union-find. O(n^2 log n) time and O(n^2) memory. Acceptable; discuss the memory.
- Advanced (only as a follow-up): Manhattan MST has an O(n log n) construction using only 4n candidate edges (sweep by octants).

**Common wrong turns**
- Greedy nearest-neighbour chain (always connect the last point to its nearest unvisited one): not an MST.
- Kruskal without union-find (or with a naive O(n) "same component" check per edge).
- Using Euclidean distance.
- Heap-based Prim that never skips stale entries, adding vertices twice.

**Hint ladder**
1. Model the points as a graph. What are the edges and their weights, and what structure are you looking for?
2. A cheapest set of edges connecting all nodes is a minimum spanning tree. Which MST algorithms do you know?
3. The graph is complete: m is about n^2/2. Which algorithm's cost depends least on m?
4. Prim without a heap: maintain the cheapest connection cost of every non-tree point to the tree and pick the minimum by a linear scan each round.

**Follow-ups**
- Prove the cut property that makes Prim/Kruskal correct.
- n = 10^5: you can't touch all pairs. (Manhattan MST in O(n log n), or approximate via grid bucketing)
- Some cables are already laid for free; some pairs are forbidden.
