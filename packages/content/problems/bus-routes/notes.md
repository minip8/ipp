**Approaches**
- The cost is per bus, not per stop, so search over **buses**: BFS where level k contains the buses reachable with k boardings.
- Build `stop -> list of buses`. Start with every bus serving `source` at level 1. When processing a bus, look at each of its stops; if one is `target`, return the level; otherwise enqueue all unvisited buses serving that stop. Mark stops (or the stop's bus list) as used so each stop is expanded once. O(total stops) time and space.
- Equivalent: BFS on a bipartite graph of stops and buses, counting only bus nodes.
- Naive: BFS over stops with an edge between every pair of stops on the same route — O(sum of len^2) edges; a route with 10^5 stops gives 10^10 edges. Too slow.

**Common wrong turns**
- Counting stops visited or transfers (boardings - 1) instead of boardings.
- Not returning 0 when `source == target` (even if source is on no route).
- Building pairwise stop edges inside each route.
- Revisiting the same bus or re-expanding the same stop many times; without "visited stop" marking, a hub stop served by 500 buses gets scanned repeatedly.
- Assuming stops are small integers and allocating arrays of size 10^6 per query (fine once, not per bus).

**Hint ladder**
1. What are you minimising — stops, transfers, or buses? What should the nodes of your search be?
2. You need fewest "rides", and all rides cost the same. Which search finds fewest-step paths in an unweighted graph?
3. Index buses by the stops they serve, so from a stop you can find all buses that pass through it.
4. BFS over buses: start from the buses at `source`; expand a bus through its stops into the other buses at those stops; mark stops and buses as visited so each is processed once.

**Follow-ups**
- Return the actual itinerary.
- Buses have different fares; minimise cost (Dijkstra over buses / 0-1 BFS variants).
- Routes have travel times and timetables (time-dependent shortest path).
- Answer many (source, target) queries quickly.
