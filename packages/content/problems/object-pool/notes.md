**What this is testing**
Pre-allocation, free lists, and the stale-handle (ABA) problem. It is short to code; the value is in the discussion. A strong candidate explains *why* a plain slot index is not enough: after release and reuse, an old index silently points at someone else's object (use-after-free that no tool will catch). The generation counter turns that into a detectable error.

**Approaches**
- Expected: arrays (or a vector of structs) for value / generation / live, a stack of released slot indices, and a counter for never-used slots. Decode a handle with `% capacity` and `/ capacity`; valid iff live and generations match. All O(1), no allocation after construction.
- An intrusive free list (store the "next free" index inside the free slot itself) removes the separate stack; good C++ discussion point.
- A hash map from handle to value "works" but misses the point (allocation per object, hashing on the hot path) and makes LIFO reuse and generations awkward; push back gently.

**Common wrong turns**
- Not checking `handle < 0` before `%` — in C++/Java `-1 % cap` is negative and indexes out of bounds. Handles in tests include negatives and huge values.
- Using 32-bit ints for handles: `generation * capacity` can exceed 2^31 in general (the signature is `long`).
- Incrementing the generation on acquire instead of on release (handles come out different from the spec).
- Pushing released slots to a FIFO queue instead of a stack, or preferring fresh slots over released ones (wrong reuse order).
- Forgetting to reject double release, or letting `set` on a stale handle overwrite the new owner's value.
- Not checking `live`: a never-used slot has generation 0, so handle `slot` would decode as "valid" without the live flag.

**Hint ladder**
1. If a handle were just the slot index, what goes wrong after a slot is released and reused?
2. What extra per-slot information would let you tell "the object I was given" apart from "a later object in the same slot"?
3. Keep a generation per slot, bump it on release, and bake the generation into the handle.
4. For O(1) acquire, keep released slots on a stack and a counter for slots never used.

**Follow-ups**
- Generation counter overflow: what if a slot is reused 2^32 times? (wrap-around; how many bits to spend on generation vs index in a 64-bit handle)
- Make it thread-safe without a mutex: lock-free free list (Treiber stack) and the ABA problem there — the same idea (tagged pointers / generation counters) solves it.
- Store real objects of type T: placement new into aligned storage, explicit destructor calls, `std::optional`-like slots; or a "slot map" with dense storage for cache-friendly iteration over live objects.
- Growable pool without invalidating handles (chunked storage, never moving objects).
- Compare to `std::pmr` pool resources and to plain `new`/`delete` costs.
