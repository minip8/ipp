**Approaches**
- Sort by squared distance and take the first k: O(n log n). Correct; a fine first answer.
- Max-heap of size k keyed by squared distance: push each point, pop when size exceeds k. O(n log k) time, O(k) space. Good when k << n or when points stream in.
- Quickselect (partition around a pivot distance until the k-th position is fixed): O(n) average, O(n^2) worst case; randomise the pivot. `std::nth_element` in C++ does this.
- Compare **squared** distances; no need for `sqrt` (avoids floating point and is faster).

**Common wrong turns**
- Using a min-heap of all n points and popping k (O(n + k log n) — actually fine) vs a min-heap of size k (wrong: keeps the farthest).
- Python `heapq` is a min-heap: to keep the k closest in a bounded heap you push `(-dist, ...)`.
- Overflow: x^2 + y^2 <= 2 * 10^8 fits in 32 bits here, but ask what happens at |x| = 10^5 (2 * 10^10 needs 64-bit).
- Quickselect with a fixed first/last pivot on adversarial input (already sorted by distance) degrades to quadratic.
- Deduplicating repeated points.

**Hint ladder**
1. What is the simplest correct solution, and what does it cost?
2. You don't need a full ordering — only the k smallest. Which structure keeps "the best k so far" cheaply?
3. A max-heap of size k: the root is the worst of the current best k, so a new point only enters if it beats the root.
4. For average linear time, think of quicksort's partition step and recurse only into the side containing position k.

**Follow-ups**
- Points arrive as an infinite stream; report the current k closest at any time.
- k closest to an arbitrary query point, for many queries (k-d tree, grid bucketing).
- Ties are allowed: how would you define and return a deterministic answer?
- Distributed: points sharded across machines (per-shard top-k, then merge).
