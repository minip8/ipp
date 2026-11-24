**Approaches**
- Brute force: per key, a list of (timestamp, value); `get` scans it. O(versions) per get.
- Expected: hash map from key to a list of (timestamp, value). Because `set` timestamps are strictly increasing, appending keeps each list sorted. `get` binary-searches for the last timestamp `<= t` (upper_bound minus one). `set` O(1), `get` O(log v).
- Alternative: per key an ordered map (`std::map` / `TreeMap`) with `upper_bound`/`floorEntry`. Same complexity, handles out-of-order sets, more memory.

**Common wrong turns**
- Off-by-one in the binary search: returning the first timestamp `>= t`, or excluding an exact match (test `h-exact-boundaries`).
- Returning the last value when the query is before the first version (must be `""`).
- Python: `bisect` on a list of tuples with `(t,)` vs `(t, "")` — `bisect_right(lst, (t, chr(127)))` style hacks are fragile; keep separate timestamp and value lists.
- Rebuilding/sorting on every set.

**Hint ladder**
1. For a single key, what order do its versions arrive in?
2. Given a sorted list of version times, how do you find the latest one not after `t` quickly?
3. Binary search for the first time strictly greater than `t`; the answer is just before it.
4. Store per key two parallel arrays (times, values) and append on set.

**Follow-ups**
- `set` timestamps arrive out of order (ordered map per key, or insertion into a sorted vector with its O(n) cost).
- Delete a key at a timestamp (tombstone versions).
- Memory grows forever: compaction / retention window; persisting to disk (an LSM-tree is essentially this).
- Concurrency: many readers, one writer — copy-on-write per key, or a reader-writer lock.
- Range query: all versions between t1 and t2.
