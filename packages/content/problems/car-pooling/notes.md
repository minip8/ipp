**Approaches**
- Brute force: for every kilometre (or every trip start), sum the groups on board. O(n * range) or O(n^2).
- Expected (difference array): `delta[from] += p`, `delta[to] -= p`; a prefix sum over kilometres gives the load at each point; fail if it ever exceeds capacity. O(n + range) time, O(range) space — great when the coordinate range is small.
- Expected (sweep line): events `(from, +p)` and `(to, -p)` sorted by position with drop-offs before pick-ups at equal positions; running sum. O(n log n), independent of the coordinate range. Or a min-heap of active trips by end.
- Discuss the trade-off: difference array wins for small ranges, sorting for sparse huge ranges.

**Common wrong turns**
- Ordering at equal positions: processing pick-ups before drop-offs makes back-to-back trips falsely overload the car.
- Treating `to` as inclusive (`delta[to + 1]`).
- Sorting trips by start and comparing only adjacent trips.

**Hint ladder**
1. At which points along the road can the number of passengers change?
2. If you recorded "+p at the pick-up, -p at the drop-off", how would you recover the load at any point?
3. Prefix-sum those changes in order of position (drop-offs first on ties) and check the running total.

**Follow-ups**
- Return the first kilometre where the car overflows.
- Range updates followed by point queries in general (difference arrays), and 2D difference arrays.
- Trips arrive online with interleaved queries (Fenwick tree with range update / point query).
