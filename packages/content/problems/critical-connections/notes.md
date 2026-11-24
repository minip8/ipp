**Approaches**
- Brute force: remove each edge, check connectivity with BFS. O(E * (V + E)) — 10^10 at the limits; the large hidden tests make it hopeless.
- Expected: Tarjan's bridge-finding. DFS assigning discovery times `tin[v]` and computing `low[v]` = the smallest discovery time reachable from v's subtree using at most one back edge. A tree edge `(p, v)` is a bridge iff `low[v] > tin[p]`. O(V + E) time and space.
- Equivalent framing: an edge is a bridge iff it lies on no cycle; or via 2-edge-connected components / chain decomposition.

**Common wrong turns**
- Using `>=` instead of `>` (that is the articulation-point condition, not bridges).
- Skipping the parent by *vertex* rather than by *edge*: fine here because there are no parallel edges (stated), but worth asking about the multigraph follow-up.
- Updating `low[v]` from a back edge with `low[u]` instead of `tin[u]` — happens to work for bridges but candidates should know why `tin` is the standard choice.
- Recursion depth: a path of 10^5 vertices overflows Python's recursion limit and can overflow a default C++ stack (8 MB is usually enough in C++, but not in Python). A hidden test is a long path with cycles hanging off it. Iterative DFS (or raising the limit plus a thread with a big stack in Python) is required.
- Returning edges in a fixed orientation is not required — the comparison accepts either.

**Hint ladder**
1. When is a single edge essential for connectivity? Relate it to cycles.
2. Run a DFS. A tree edge from p to child v is safe if something in v's subtree has a back edge to p or above. How could you summarise "how high can v's subtree reach"?
3. Track discovery time `tin` and `low` (the earliest discovery time reachable from the subtree with one back edge). Tree edge p-v is critical iff `low[v] > tin[p]`.
4. Make the DFS iterative to survive very deep graphs.

**Follow-ups**
- Articulation points (critical servers) — what changes?
- Parallel edges between the same pair: skip the parent *edge id*, not the parent vertex.
- Cables are added online; maintain the number of bridges (union-find on 2-edge-connected components, harder).
- Minimum number of cables to add so no cable is critical: ceil(leaves of the bridge tree / 2).
