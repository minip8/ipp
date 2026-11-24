**Approaches**
- Key fact: a graph on n nodes is a tree iff it has exactly n - 1 edges **and** is connected (equivalently: n - 1 edges and acyclic).
- Union-find: reject immediately if `len(edges) != n - 1`; otherwise union every edge and fail if any edge joins two nodes already in the same set. O(n α(n)).
- BFS/DFS: check the edge count, then traverse from node 0 and verify all n nodes are reached. O(n + m).
- Cycle detection by DFS with a parent pointer also works, but the edge-count shortcut is the insight interviewers look for.

**Common wrong turns**
- Checking only "no cycle" (a forest of two trees passes) or only "connected" (a connected graph with a cycle passes).
- DFS cycle detection on an undirected graph that treats the edge back to the parent as a cycle.
- n = 1 with no edges is a tree; n = 2 with no edges is not.
- Recursive DFS on a 10^5-node path overflows the Python recursion limit (and can blow a small C++ stack).

**Hint ladder**
1. List the two properties a tree must have. Which can you check cheaply?
2. How many edges must a tree on n nodes have exactly?
3. If the edge count is n - 1, is it enough to check just one of "connected" / "acyclic"? Why?
4. Count the edges, then check connectivity with one BFS from node 0 (or detect a cycle with union-find).

**Follow-ups**
- The edges are directed: is it a rooted tree? (exactly one node with in-degree 0, every other with in-degree 1, and all reachable from the root)
- Edges stream in; report the first moment the graph stops being a forest.
- Prove the n - 1 edges + connected => acyclic claim.
