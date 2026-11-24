Implement a key-value cache that holds at most `capacity` entries. When it is full and a new key arrives, it throws away the entry that was **used least recently**.

- `LRUCache(capacity)` creates an empty cache.
- `get(key)` returns the value stored for `key`, or `-1` if the key is not in the cache. A successful `get` counts as a use of that key.
- `put(key, value)` stores `value` under `key`, replacing any previous value. This counts as a use of `key`. If `key` was not already present and the cache now holds more than `capacity` entries, remove the entry whose last use is the oldest.

A "use" is any `put` of the key or any `get` that finds it. A `get` that returns `-1` changes nothing.

Both operations should run in **O(1)** average time.

**Example**

```
LRUCache c(2)
c.put(1, 10)
c.put(2, 20)
c.get(1)      -> 10     key 1 is now the most recently used
c.put(3, 30)            cache is over capacity: key 2 (least recent) is evicted
c.get(2)      -> -1
c.put(1, 11)            updates key 1, no eviction
c.put(4, 40)            evicts key 3
c.get(3)      -> -1
c.get(1)      -> 11
c.get(4)      -> 40
```

**Constraints**

- `1 <= capacity <= 3000`
- `0 <= key <= 10^4`, `0 <= value <= 10^5`
- At most `2 * 10^5` calls in total per test.
