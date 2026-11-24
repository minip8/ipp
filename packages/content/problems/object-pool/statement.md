Low-latency systems often avoid heap allocation on the hot path by pre-allocating a fixed number of objects and handing them out from a **pool**. Instead of raw pointers, callers receive integer **handles**. A handle must stop working once its object is released — even if the same slot is later reused for a different object. Implement such a pool, where each object is just an `int` value.

The pool has `capacity` slots numbered `0 .. capacity - 1`. Every slot has a **generation** counter, initially `0`.

- `ObjectPool(capacity)` creates the pool with all slots free and never used.
- `acquire(value) -> long` stores `value` in a free slot and returns its handle. The slot is chosen as follows:
  1. If some slots have been released, reuse the **most recently released** one (last in, first out).
  2. Otherwise use the **lowest-numbered slot that has never been used**.
  3. If every slot is in use, return `-1` and change nothing.

  The handle is `generation * capacity + slot`, using the slot's current generation.
- `get(handle) -> int` returns the value of the live object the handle refers to, or `-1` if the handle is not valid.
- `set(handle, value) -> bool` replaces the value of the live object the handle refers to and returns `true`; returns `false` (changing nothing) if the handle is not valid.
- `release(handle) -> bool` frees the object the handle refers to and returns `true`: the slot becomes free and its generation increases by `1`, so every existing handle to it becomes invalid. Returns `false` (changing nothing) if the handle is not valid — for example, a second release of the same handle.
- `size() -> int` returns the number of live objects.

A handle `h` is **valid** exactly when `h >= 0`, the slot `h % capacity` is currently in use, and `h / capacity` (integer division) equals that slot's current generation.

**Example**

```
ObjectPool p(3)
p.acquire(10)   -> 0       slot 0, generation 0
p.acquire(20)   -> 1       slot 1, generation 0
p.release(0)    -> true    slot 0 now has generation 1
p.get(0)        -> -1      stale handle
p.release(0)    -> false   double release is detected
p.acquire(30)   -> 3       reuses slot 0: 1 * 3 + 0
p.get(3)        -> 30
p.set(1, 21)    -> true
p.get(1)        -> 21
p.acquire(40)   -> 2       slot 2 has never been used
p.acquire(50)   -> -1      pool is full
p.size()        -> 3
```

**Constraints**

- `1 <= capacity <= 10^5`
- `0 <= value <= 10^9`
- Handles passed to `get`, `set` and `release` satisfy `-10^12 <= handle <= 10^12` and may be arbitrary.
- At most `10^5` calls in total per test. Every operation should be **O(1)**.
