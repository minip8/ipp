You manage a memory region of `n` units, addressed `0` to `n - 1`, all free at the start. Implement a **first-fit** allocator.

- `Allocator(n)` creates the region.
- `allocate(size, mID) -> int` finds the **lowest** address `a` such that units `a, a+1, ..., a+size-1` are all free, marks them as owned by `mID`, and returns `a`. If no run of `size` consecutive free units exists, it changes nothing and returns `-1`.
- `freeMemory(mID) -> int` frees **every** unit currently owned by `mID` (one `mID` may own several separate blocks from several `allocate` calls) and returns how many units were freed. Returns `0` if `mID` owns nothing.

Freed units are available to later allocations immediately, and adjacent free units form a single run regardless of how they became free.

**Example**

```
Allocator a(10)
a.allocate(3, 1)   -> 0       units 0..2 owned by 1
a.allocate(2, 2)   -> 3       units 3..4 owned by 2
a.allocate(4, 1)   -> 5       units 5..8 owned by 1
a.freeMemory(2)    -> 2       free runs now: [3..4], [9..9]
a.allocate(3, 3)   -> -1      no free run of length 3
a.allocate(1, 3)   -> 3       lowest free unit
a.freeMemory(1)    -> 7       frees 0..2 and 5..8; free runs: [0..2], [4..9]
a.allocate(6, 4)   -> 4       [0..2] is too short; [4..9] has exactly 6 units
a.freeMemory(9)    -> 0
```

**Constraints**

- `1 <= n <= 10^5`
- `1 <= size, mID <= 10^5`
- At most `2 * 10^4` calls in total per test.
