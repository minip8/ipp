**Approaches**
- Expected: an array of size `capacity`, a `head` index and either a `count` or a `tail` index. Enqueue writes at `(head + count) % capacity`; dequeue advances `head`. All O(1), O(capacity) space.
- Full vs empty ambiguity: with only `head` and `tail`, `head == tail` means both. Fixes: keep a `count`; or allocate `capacity + 1` slots and leave one empty; or use free-running (never wrapped) 64-bit counters and compare `tail - head` with capacity.
- Shifting elements on dequeue (or Python `list.pop(0)`) is O(n) and misses the point.

**Common wrong turns**
- `rear` computed as `tail - 1` without wrapping: index -1 when `tail == 0`. Use `(tail - 1 + cap) % cap` (in C++ `%` of a negative is negative).
- `front`/`rear` on an empty queue reading a stale slot instead of returning -1.
- Not resetting/handling indices after the queue empties and refills — fine if the arithmetic is right, but check with capacity 1.
- `enqueue` on a full queue overwriting the oldest value (that is a different, "overwriting ring buffer" design — worth discussing as a variant).

**Hint ladder**
1. If you never move elements, what has to move instead?
2. Track where the front is and how many elements there are; where does the next element go?
3. Wrap indices with modulo arithmetic. How do you tell "full" from "empty"?
4. Keep a count (or one spare slot), and compute rear as the slot just before the write position, wrapped.

**Follow-ups (C++ / low-latency angle)**
- Round capacity up to a power of two and replace `%` with `& (cap - 1)`; use free-running unsigned head/tail counters so `tail - head` is the size and wrap-around of the counters is harmless.
- Single-producer single-consumer lock-free version: producer owns `tail`, consumer owns `head`, both `std::atomic<size_t>`; which memory orders are needed (release on publish, acquire on read)? Why put head and tail on separate cache lines (`alignas(64)`, false sharing)? Caching the other side's index locally to avoid cross-core traffic.
- Make it a template `RingBuffer<T, N>` with in-place construction (`emplace`, placement new, destroying elements on pop). What changes for non-trivially-copyable `T`?
- Overwrite-oldest mode for logging/market-data buffers.
- Growing ring buffer (like `std::deque` or a doubling array that unwraps on resize).
