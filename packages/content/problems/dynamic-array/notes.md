**Rule check (not enforced by tests)**
- The elements must live in storage the candidate manages: a raw block (`new int[cap]`, `unique_ptr<int[]>`, `malloc`) in C++, an `int[]` in Java, a preallocated `[0] * cap` list in Python that is only indexed and replaced wholesale. Read the code: `std::vector`, `ArrayList`, or Python `append`/`insert`/`pop`/`del` doing the real work means the exercise was skipped, even if the tests pass. Slice copies between two fixed blocks in Python are the honest equivalent of `memcpy`; accept them.
- Returning a `vector`/`int[]`/`list` from `toArray` is fine.

**Approaches**
- Expected: pointer (or array), `size`, `capacity`. Growth allocates a new block, copies `size` elements, frees the old one. Doubling gives amortised O(1) `pushBack`: the copies over n pushes total 1 + 2 + 4 + ... < 2n. `get`/`set`/`popBack` O(1); `insert`/`erase` shift the tail, O(size - index). O(capacity) space.
- The capacity rules are fully specified so they can be tested: 0 -> 1, then doubling; `reserve(n)` exact and never shrinking; `resize` past capacity takes `max(n, 2 * cap)` (libstdc++ behaves similarly); `shrinkToFit` exact; nothing shrinks on removal.
- Growing by a constant (or by one) makes every push copy the whole array: O(n^2) over n pushes. The capacity checks catch it on correctness, and `h-large-resize` (a million elements, then 2500 pushes) times out with it.

**Common wrong turns**
- Off-by-one in the growth check: growing when `size == capacity - 1`, or writing past the end and growing afterwards (C++ UB, Java `ArrayIndexOutOfBounds`, Python `IndexError`). `h-capacity-each-push` checks the capacity after every push.
- `cap * 2` when `cap == 0` stays 0 forever; needs the 0 -> 1 special case.
- Rounding to a power of two instead of doubling: after `shrinkToFit` to 3 the next growth must give 6.
- `insert` at a full array: shifting before growing, or growing but copying with the gap in the wrong place. `insert(size, v)` must be accepted; `insert(size + 1, v)` rejected.
- `erase` shifting with the wrong loop bound (losing or duplicating the last element); C++ `memcpy` on overlapping ranges instead of `memmove`/`std::copy`.
- `resize` that shrinks the size and then grows it again within capacity must write the fill value, not expose the stale elements (`h-resize-refill`).
- Shrinking the capacity on `popBack`/`erase` (a "shrink at a quarter" policy is a fine follow-up but violates this spec; `h-large-push` thrashes across a boundary).
- C++: forgetting the destructor (leak), or a shallow copy constructor that double-frees. Not tested; worth asking about (rule of three/five).

**Hint ladder**
1. What has to happen when you push and the block is full? How much bigger should the new block be?
2. If you grow by one slot each time, how many element copies do n pushes cost in total? What if you double?
3. Keep `data`, `size` and `capacity` separately; only `pushBack`, `insert`, `reserve`, `resize` and `shrinkToFit` reallocate, and they all go through one "move to a block of capacity c" helper.
4. For `insert`, grow first if full, then shift `[index, size)` one place right starting from the end; for `erase`, shift `(index, size)` one place left starting from `index`.

**Follow-ups (C++ angle)**
- Make it `Vector<T>`: why does `std::vector` allocate raw memory and use placement new instead of `new T[cap]`? (Capacity slots must not be constructed; destroy on pop.)
- Exception safety: if copying an element throws during growth, what state are you in? Why does `std::vector` move only when the move constructor is `noexcept` (`move_if_noexcept`)?
- Iterator/reference invalidation: which operations invalidate pointers into the array?
- Why a factor of 2 vs 1.5 (MSVC, folly): with 1.5 a freed block can eventually be reused by a later allocation.
- Amortised vs worst case: how would you get O(1) worst-case push (incremental copying into the new block)?
