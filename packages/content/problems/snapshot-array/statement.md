Implement an integer array that can take cheap snapshots of itself and answer questions about any past snapshot.

- `SnapshotArray(length)` creates an array of `length` elements, all equal to `0`.
- `set(index, val)` sets the element at `index` to `val` in the *current* (live) array.
- `snap()` takes a snapshot of the live array and returns its id. Ids are `0, 1, 2, ...` in the order snapshots are taken (the first call returns `0`).
- `get(index, snapId)` returns the value the element at `index` had when snapshot `snapId` was taken.

Calls are always valid: `0 <= index < length`, and `snapId` is the id of a snapshot already taken. Changes made after a snapshot never affect it.

The array can be long and snapshots frequent, so copying the whole array on every `snap` is too slow and uses too much memory.

**Example**

```
SnapshotArray a(3)
a.set(0, 5)
a.snap()        -> 0
a.set(0, 6)
a.set(2, 1)
a.snap()        -> 1
a.snap()        -> 2      nothing changed since snapshot 1
a.get(0, 0)     -> 5
a.get(0, 1)     -> 6
a.get(2, 0)     -> 0
a.get(2, 2)     -> 1
a.get(1, 2)     -> 0      never set
```

**Constraints**

- `1 <= length <= 5 * 10^4`
- `0 <= val <= 10^9`
- At most `5 * 10^4` calls per test.
