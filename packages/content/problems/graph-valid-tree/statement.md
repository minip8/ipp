You are given `n` nodes labelled `0` to `n - 1` and a list of undirected `edges`, where `edges[i] = [a, b]` joins `a` and `b`.

Return `true` if these edges form a **tree** on all `n` nodes — that is, the graph is connected and contains no cycle — and `false` otherwise.

**Examples**

```
n = 5, edges = [[0, 1], [0, 2], [0, 3], [1, 4]]   ->   true
n = 5, edges = [[0, 1], [1, 2], [2, 3], [1, 3], [1, 4]]   ->   false   (cycle 1-2-3)
n = 4, edges = [[0, 1], [2, 3]]   ->   false   (not connected)
n = 1, edges = []   ->   true
```

**Constraints**

- `1 <= n <= 10^5`
- `0 <= edges.length <= 10^5`
- `0 <= a, b < n`, `a != b`
- No edge is listed twice (in either direction).
