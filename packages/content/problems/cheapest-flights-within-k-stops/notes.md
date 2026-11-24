**Approaches**
- Bellman-Ford limited to `k + 1` rounds: `cost[v]` = cheapest price using at most `r` flights. Each round relaxes every flight using a **copy of the previous round's costs**. O(k * E) time, O(n) space. This is the cleanest answer.
- BFS by levels (stops) with best-cost pruning per level: same complexity.
- Dijkstra on state `(city, flights used)`: correct, O(E * k log(E * k)). Plain Dijkstra on cities only is **wrong**: the cheapest way to reach an intermediate city may use too many stops, and a pricier but shorter route there is then needed. Hidden tests target this.
- DFS enumerating all paths with up to k stops: exponential; hidden tests on dense graphs time out.

**Common wrong turns**
- Relaxing in place within a round (using costs updated in this same round), which lets a route use more than `r` flights. Example: chain 0->1->2 with k = 0 would wrongly give the chain price. Hidden test covers it.
- Off-by-one between stops and flights (`k` stops = `k + 1` flights).
- Dijkstra with a visited set on cities only (described above).
- Integer overflow: prices are small, but using INT_MAX as infinity and adding a price overflows in C++/Java.

**Hint ladder**
1. Without the stop limit this is plain shortest path. What breaks when you add the limit?
2. Think about "cheapest cost to each city using at most r flights" for r = 0, 1, 2, ... How does r + 1 follow from r?
3. Each round, relax every flight from the previous round's costs — not from values you updated earlier in the same round.
4. After `k + 1` rounds, read off the cost at `dst`.

**Follow-ups**
- Return the route itself.
- Minimise stops first, then price; or price with a penalty per stop.
- Very large k (close to n): plain Dijkstra becomes valid when k >= n - 2. Why?
- Dijkstra on (city, stops) state — when is it faster than Bellman-Ford?
