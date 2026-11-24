Build a map from integer keys to integer values **without using any built-in hash table or ordered map** (`unordered_map`, `map`, `dict`, `HashMap`, `set`, ...). Arrays/vectors/lists are fine.

- `MyHashMap()` creates an empty map.
- `put(key, value)` associates `value` with `key`, replacing the old value if `key` is already present.
- `get(key)` returns the value associated with `key`, or `-1` if `key` is not present.
- `remove(key)` deletes `key` and its value. Removing a key that is not present does nothing.

Aim for O(1) average time per operation, and memory proportional to the number of keys stored rather than to the key range.

**Example**

```
MyHashMap m
m.put(3, 30)
m.put(1003, 7)
m.get(3)       -> 30
m.get(1003)    -> 7
m.get(5)       -> -1
m.put(3, 31)              overwrite
m.remove(1003)
m.get(1003)    -> -1
m.get(3)       -> 31
m.remove(42)              not present: no effect
```

**Constraints**

- `0 <= key, value <= 10^9`
- At most `10^4` calls per test.
