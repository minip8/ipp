A network has `n` nodes labelled `1` to `n`. Each entry `times[i] = [u, v, w]` is a **one-way** link: a message sent from `u` arrives at `v` after `w` time units.

At time 0, node `k` broadcasts a message. Every node that receives it immediately forwards it along all of its outgoing links.

Return the time at which the last node receives the message (that is, the largest shortest-path time from `k` over all nodes). If some node never receives it, return `-1`.

**Examples**

```
times = [[1,2,4],[1,3,1],[3,2,2],[2,4,1]], n = 4, k = 1   ->  4
```

Node 3 gets it at 1, node 2 at 3 (via 3, faster than the direct link of 4), node 4 at 4.

```
times = [[1,2,5]], n = 2, k = 2                          ->  -1
```

Links are one-way; node 1 is never reached.

```
times = [], n = 1, k = 1                                 ->  0
```

**Constraints**

- `1 <= n <= 10^4`
- `0 <= times.length <= 5 * 10^4`
- `1 <= u, v <= n`, `0 <= w <= 1000`
- There may be several links between the same pair, and self-links `u == v`.
- `1 <= k <= n`
