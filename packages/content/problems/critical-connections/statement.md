A network has `n` servers labelled `0` to `n - 1`. Each entry `connections[i] = [a, b]` is an undirected cable between servers `a` and `b`. The network is connected: every server can reach every other.

A cable is **critical** if removing it (and only it) disconnects some pair of servers.

Return all critical cables. Each cable may be given as `[a, b]` or `[b, a]`, and the cables may be listed in any order.

**Examples**

```
n = 5, connections = [[0,1],[1,2],[2,0],[1,3],[3,4]]   ->  [[1,3],[3,4]]
```

Servers 0, 1, 2 form a loop, so none of those cables is critical. Cutting `1-3` isolates {3, 4}; cutting `3-4` isolates 4.

```
n = 2, connections = [[0,1]]                           ->  [[0,1]]
```

```
n = 4, connections = [[0,1],[1,2],[2,3],[3,0]]         ->  []
```

**Constraints**

- `2 <= n <= 10^5`
- `n - 1 <= connections.length <= 10^5`
- `0 <= a, b < n`, `a != b`
- no cable is listed twice (in either direction)
- the network is connected
