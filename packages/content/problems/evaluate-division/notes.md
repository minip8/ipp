**Approaches**
- Graph view: an edge A -> B with weight k and B -> A with weight 1/k. A query C/D is the product of weights along any path from C to D (any path gives the same product because the data is consistent).
- BFS/DFS per query: O(Q · (V + E)). With 2000 equations and 2000 queries that is ~10^7 — fine, and the most common interview answer.
- Weighted union-find: store for each node its parent and `weight[x] = x / parent(x)`; `find` compresses paths while multiplying weights. Union A, B with ratio k by attaching root(A) under root(B) with weight `k * w(B) / w(A)`. Each query: same root ? w(C)/w(D) : -1. Near O((E + Q) α).
- Floyd–Warshall on all names: O(V^3) — too slow if V reaches 4000; acceptable only for tiny inputs.

**Common wrong turns**
- Returning 1.0 for `x / x` when x is unknown.
- Only adding the forward edge, so `B / A` is unreachable.
- Revisiting nodes without a visited set (cycles in the ratio graph cause infinite loops).
- Weighted union-find: getting the direction of the weight wrong when attaching one root to the other (the classic bug: using k instead of `k * w(B) / w(A)`).

**Hint ladder**
1. If you know a/b and b/c, how do you get a/c? What structure does a chain of such facts look like?
2. Build a graph: names are nodes, each equation gives a weighted edge — in which directions and with which weights?
3. Answer a query by searching for any path from C to D and multiplying weights along it; handle unknown names first.
4. (Optimisation) Can you precompute, per connected group, every node's value relative to one representative so each query is O(1)?

**Follow-ups**
- What if the equations could be inconsistent? Detect it. (union-find: on union of two nodes already in one set, check the implied ratio)
- Equations and queries interleave online. (weighted union-find)
- Floating-point error along long chains; would you use logarithms or exact rationals?
