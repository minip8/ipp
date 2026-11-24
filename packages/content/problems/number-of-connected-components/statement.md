An undirected graph has `n` nodes labelled `0` to `n - 1`. You are given its edges as a list of pairs `edges[i] = [a, b]`, meaning nodes `a` and `b` are joined.

Return the number of **connected components**: groups of nodes in which every node can reach every other node of the group by following edges, and no node can reach a node outside its group. A node with no edges is a component on its own.

**Examples**

```
n = 6, edges = [[0, 1], [1, 2], [4, 5]]    ->   3
```
The components are `{0, 1, 2}`, `{3}` and `{4, 5}`.

```
n = 4, edges = [[0, 1], [2, 3], [1, 2], [3, 0]]   ->   1
```

```
n = 3, edges = []   ->   3
```

**Constraints**

- `1 <= n <= 10^5`
- `0 <= edges.length <= 2 * 10^5`
- `edges[i].length == 2`, `0 <= a, b < n`, `a != b`
- The same pair may appear more than once (possibly reversed); duplicates join nothing new.
