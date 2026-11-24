**Approaches**
- Expected: Dijkstra with a binary heap from `k`; answer = max distance, or -1 if any node is unreached. O((V + E) log V) time, O(V + E) space. Lazy deletion (skip popped entries whose distance is stale) is fine.
- Bellman-Ford: relax all edges V-1 times. O(V * E) — about 5 * 10^8 at the limits; the large hidden tests are sized so this is far too slow in Python (and slow in C++ when it does not terminate early).
- Plain BFS is wrong because weights differ (and zero weights exist).
- O(V^2) array Dijkstra is acceptable for dense graphs; here V = 10^4 makes it 10^8 — borderline in C++, too slow in Python.

**Common wrong turns**
- Treating links as undirected.
- Off-by-one with 1-based labels (allocating n instead of n + 1 entries).
- Not skipping stale heap entries — still correct, but may reprocess edges many times.
- Returning the sum of all edge weights or the distance to node n instead of the maximum over all nodes.
- Marking a node visited when it is *pushed* rather than when it is *popped* — gives wrong answers when a cheaper path is found later (a hidden test targets this: direct heavy edge vs. multi-hop light path).
- Forgetting zero-weight edges are allowed (fine for Dijkstra, but breaks "BFS by levels" heuristics).

**Hint ladder**
1. What does "time the last node receives it" mean in graph terms?
2. Edges have different non-negative weights. Which shortest-path algorithm fits?
3. Always expand the unvisited node with the smallest known arrival time; a priority queue makes this fast.
4. Once all nodes are settled, take the maximum distance; any unreachable node means -1.

**Follow-ups**
- Negative weights? (Bellman-Ford / SPFA; Dijkstra breaks)
- Return the path to the slowest node.
- Many source queries on the same graph (all-pairs: Floyd-Warshall vs. V Dijkstras).
- Delays are time-dependent (links only open at certain times).
