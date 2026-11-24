**Approaches**
- Brute force: store all hits, count those in the window on every query. O(total hits) per query, unbounded memory.
- Queue of timestamps: push on hit; on query pop from the front while `front <= t - 300`; return size. Amortised O(1), but memory O(hits in window) — bad if there are millions of hits per second.
- Queue of (timestamp, count) pairs, merging equal timestamps: memory O(300) at most.
- Fixed 300-slot circular array: `times[t % 300]`, `counts[t % 300]`; on hit, if the slot's stored time is not `t`, reset it. Query sums slots whose stored time is in the window. O(1) hit, O(300) query, O(300) memory regardless of traffic. Good to discuss when the window is fixed and small.

**Common wrong turns**
- Window boundary: counting a hit exactly 300 seconds old (`>=` vs `>`). Tests probe exactly `t - 300` and `t - 299`.
- Circular array: forgetting to compare the stored timestamp, so stale counts from 300 s ago (same slot) are summed or not reset.
- Bucket array keyed by `t % 300` but resetting only on query, not on hit.
- Assuming at most one hit per second.
- Timestamps up to 2*10^9: `t - 300` is fine in 32-bit, but `t + 300` style arithmetic overflows near the top in C++/Java.

**Hint ladder**
1. Once a hit falls out of the window, can it ever matter again?
2. Hits arrive in time order. Which end of your collection do expired hits leave from?
3. A queue: expire from the front on each query. What if a single second has a million hits?
4. Store (timestamp, count) per second, or use 300 buckets indexed by `t % 300` that remember which second they hold.

**Follow-ups**
- Very high hit rate and concurrent `hit` calls: per-thread/sharded counters, atomics on bucket counts, how the bucket reset races.
- Arbitrary window size per query (prefix sums over buckets / Fenwick tree).
- Out-of-order timestamps (late events), distributed counting across servers.
- Turn it into a rate limiter (see `rate-limiter`).
