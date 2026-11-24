You are given an undirected graph with `n` vertices labelled `0` to `n - 1`. Each entry `edges[i] = [u, v]` is an undirected edge between `u` and `v`.

Return `true` if you can walk from `source` to `destination` along edges, and `false` otherwise. A vertex can always reach itself, so `source == destination` gives `true` even with no edges.

**Examples**

```
n = 4, edges = [[0,1],[1,2],[3,3]], source = 0, destination = 2   ->  true    (0 - 1 - 2)
n = 5, edges = [[0,1],[2,3],[3,4]], source = 1, destination = 4   ->  false   ({0,1} and {2,3,4} are separate)
n = 1, edges = [], source = 0, destination = 0                    ->  true
```

**Constraints**

- `1 <= n <= 2 * 10^5`
- `0 <= edges.length <= 2 * 10^5`
- `edges[i].length == 2`, `0 <= u, v < n`
- Edges may repeat and may be self-loops.
- `0 <= source, destination < n`
