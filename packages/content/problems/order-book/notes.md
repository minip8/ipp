**What this is testing**
The bread-and-butter question at trading firms and exchanges. Beyond correctness it shows whether the candidate can choose data structures for a hot path, reason about invariants (book never crossed after matching), and handle the messy edges (partial fills, cancels of filled orders, priority rules on modify). Interviewers usually let the candidate drive the structure and then probe latency.

**Approaches**
- Brute force: one flat list of resting orders; on each new order filter the opposite side, sort by price then time, and fill. O(n log n) per order. Fine to describe; too slow and not what they want.
- Expected:
  - Per side, an ordered map `price -> Level`, where a level is a FIFO queue of orders plus a cached total volume. Bids sorted descending, asks ascending (C++: `std::map<int, Level, std::greater<int>>` / `std::map<int, Level>`; Java: `TreeMap`; Python: dict of levels + heaps of prices with lazy deletion, since there is no built-in sorted map).
  - `id -> location` (side, price, iterator/node in the level's queue) for O(1) cancel/modify. C++ `std::list` iterators stay valid across other insertions/erasures; that is precisely why `list` is used here.
  - Matching: while the incoming order has quantity and the best opposite level crosses, fill against the front of that level's queue; erase empty levels.
  - Complexity: O(log P) per new price level, O(1) per fill, O(1) cancel (+ O(log P) if the level empties). bestBid/bestAsk O(1) via `begin()`.
- Python alternative for cancel: mark the order dead in the id map and skip it lazily when it reaches the front of the queue; keep volumes exact in a separate counter. Must explain why stale entries cannot be confused with live ones (sequence numbers when a modify re-queues the same id).

**Common wrong turns**
- Trading at the incoming order's price instead of the resting order's price.
- Taking the *worst* price first on the opposite side (iterating asks descending), or FIFO across prices rather than within a price.
- Resting the incoming order before matching, or resting it even when fully filled (then `bestBid` shows a ghost order).
- Leaving empty levels in the map, so `bestBid` reports a price with no volume.
- Allowing reuse of an id after the order is filled or cancelled (the spec says ids are never reusable); counting a rejected order's id as used.
- Modify: increasing quantity must lose time priority; decreasing (or unchanged) must keep it; neither triggers matching.
- `lastFills` must be cleared at the start of every `addOrder`, including rejected ones, but not by cancel/modify.
- Invalidated iterators when erasing from a `std::vector`-based queue (use `list`/`deque` carefully or indices).

**Hint ladder**
1. What does the engine need to find fast when an order arrives? When a cancel arrives?
2. Group resting orders by price. Within one price, which order trades first, and what structure gives you that order?
3. Keep, per side, a sorted map from price to a FIFO queue; the best price is the first key. Add a map from order id to where the order lives.
4. Match in a loop against the best opposite level while it crosses, trading at the resting price; whatever remains rests at the back of its own level's queue.

**Follow-ups (low latency)**
- Prices are integer ticks in a bounded band: replace the tree with an array indexed by tick, plus a cached best index (O(1) everything; scanning for the next level is short and cache-friendly).
- Avoid allocation on the hot path: pre-allocated order pool with intrusive doubly linked lists and integer handles (see the object-pool problem), `std::pmr` arenas, no `std::string` sides.
- `std::map` node allocations and pointer chasing vs flat sorted vectors (most activity is near the top of book — a vector sorted so the best price is at the back makes inserts near the top cheap).
- Market orders, IOC/FOK, self-trade prevention, iceberg orders.
- Determinism and recovery: replaying an input journal to rebuild the exact book; why the engine is usually single-threaded per instrument.
- How would you publish market data (level-2 depth) incrementally?
