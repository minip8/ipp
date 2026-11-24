**Approaches**
- Brute force: store (value, count, last-use timestamp) per key; on eviction scan all entries for the minimum (count, timestamp). O(capacity) per eviction. Acceptable as a starting point only.
- Heap of (count, timestamp, key) with lazy invalidation: O(log n) per operation. A reasonable intermediate answer; ask how stale heap entries are handled.
- Expected O(1): a map key -> (value, count, node); a map count -> doubly linked list of keys with that count, ordered by recency (front = most recent); and an integer `minCount`. On a use, move the key from list `c` to the front of list `c+1`; if list `c` became empty and `c == minCount`, increment `minCount`. On insertion of a new key, evict from the back of list `minCount`, then set `minCount = 1`.
- C++: `unordered_map<int, list<int>>` for frequency buckets plus `unordered_map<int, {value, count, list<int>::iterator}>`; `splice` between lists keeps iterators valid.
- Python: a dict of `OrderedDict`s keyed by count works neatly.

**Common wrong turns**
- Forgetting that `put` on an existing key increments its count (and does not evict).
- Not resetting `minCount` to 1 after inserting a new key.
- Evicting after inserting the new key: the new key (count 1) would then be evicted immediately. Evict first.
- Tie-breaking by insertion time instead of by last use.
- Updating `minCount` by scanning upward from an arbitrary value instead of the O(1) rule above (only the bucket `minCount` can empty out from a single use, and it moves exactly to `minCount + 1`).
- Leaving empty buckets around in a map keyed by count and then using `begin()` of an ordered map: works but is O(log n); fine if they say so.

**Hint ladder**
1. Start from LRU: what extra information decides which entry to evict here?
2. Think of the entries grouped by use count. Within one group, what order do you need?
3. Keep one recency-ordered list per count and remember the smallest count that has a non-empty list.
4. When a key's count goes from c to c+1, how can the minimum count change? Only if c was the minimum and its list just became empty.

**Follow-ups**
- Counts grow forever, so an entry that was hot an hour ago can never be evicted. How would you age counts (decay, windowed LFU, TinyLFU)?
- Memory per entry in your C++ layout; could you use one intrusive node instead of two containers?
- Thread safety and sharding.
- Compare LRU vs LFU on a scan-heavy workload vs a skewed (Zipf) workload.
