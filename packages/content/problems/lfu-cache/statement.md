Implement a key-value cache holding at most `capacity` entries that, when full, evicts the entry that has been **used the fewest times**. Among entries with the same (smallest) use count, it evicts the one whose last use is the oldest.

Every key in the cache has a *use count*:

- `LFUCache(capacity)` creates an empty cache.
- `get(key)` returns the value stored for `key`, or `-1` if absent. A successful `get` increments the key's use count and makes it the most recent use.
- `put(key, value)`:
  - If `key` is present, replace its value; this increments its use count and makes it the most recent use. Nothing is evicted.
  - Otherwise, if the cache already holds `capacity` entries, first evict one entry: the one with the smallest use count, breaking ties by the oldest last use. Then insert `key` with use count **1** (the insertion itself is its first use).

A `get` that returns `-1` changes nothing. Both operations should run in **O(1)** average time.

**Example**

```
LFUCache c(2)
c.put(1, 10)            count(1) = 1
c.put(2, 20)            count(2) = 1
c.get(1)      -> 10     count(1) = 2
c.put(3, 30)            full: key 2 has the lowest count (1) -> evicted
c.get(2)      -> -1
c.get(3)      -> 30     count(3) = 2
c.put(4, 40)            full: keys 1 and 3 both have count 2; key 1 was used longer ago -> evicted
c.get(1)      -> -1
c.get(3)      -> 30
c.get(4)      -> 40
```

**Constraints**

- `1 <= capacity <= 10^4`
- `0 <= key <= 10^5`, `0 <= value <= 10^9`
- At most `2 * 10^5` calls in total per test.
