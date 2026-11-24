**Approaches**
- Model as a directed graph `b -> a`. All courses can be finished iff the graph has no directed cycle.
- Kahn's algorithm: compute in-degrees, repeatedly remove a vertex with in-degree 0. If every vertex gets removed, return true. O(V + E).
- DFS with three colours (unvisited / on current path / done): a back edge to an "on path" vertex is a cycle. O(V + E). Recursive DFS can exceed Python's recursion limit on a 10^5-long chain (a hidden test) — use an iterative DFS or Kahn.

**Common wrong turns**
- Two-colour DFS (just "visited"): reports a cycle for a diamond (two paths to the same node), which is a DAG. A hidden test has many diamonds.
- Treating the graph as undirected (any cycle in the undirected sense is not a problem).
- Getting the edge direction backwards — harmless for this yes/no question (reversing all edges preserves cycles), but matters for Course Order.
- Re-running a DFS from every vertex without memoising "done" vertices: exponential/quadratic on layered graphs.
- Self-loops and duplicate edges: duplicates must increment in-degree twice and be removed twice consistently.

**Hint ladder**
1. Draw the courses as a graph. What structure in the graph makes finishing impossible?
2. If a course has no outstanding prerequisites, can you always take it now? What does taking it do to the others?
3. Repeatedly take courses with zero remaining prerequisites (track in-degrees and a queue); count how many you take.
4. Alternatively, DFS and detect an edge back to a vertex that is still on the current DFS path — that needs three states, not two.

**Follow-ups**
- Return an actual valid order (Course Order / LeetCode 210), or the lexicographically smallest one.
- Minimum number of semesters if you can take any number of courses per semester (longest path in the DAG, BFS by levels).
- At most k courses per semester (much harder, bitmask DP for small n).
- Report one cycle explicitly to the user.
