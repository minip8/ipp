The tests cannot detect a built-in map; enforce the rule in conversation. Keys go up to 10^9, so a direct-address array of size 10^9 is not acceptable (and the memory limit rejects it in practice).

**Approaches**
- Separate chaining: `B` buckets, each a small vector/list of (key, value). Hash with `key % B` (B prime) or a multiplicative hash. Average O(1 + n/B) per operation. Resize (double B, rehash everything) when n/B exceeds ~1 to stay O(1) amortised.
- Open addressing with linear probing: one flat array of slots, probe `h, h+1, h+2, ...`. Better cache locality — the usual choice for low-latency C++. Deletion needs **tombstones** (or backward-shift deletion), otherwise a later key in the same probe run becomes unreachable. Keep load factor below ~0.5–0.7; count tombstones toward the load when deciding to rehash.
- Either is fine for "easy"; the discussion is the point.

**Common wrong turns**
- Open addressing: clearing a slot to "empty" on remove, breaking lookups of keys that probed past it. The test `h-probe-chain` targets this when keys collide mod a small table size (it uses keys that are equal modulo 1000, 1024, 997, 10007 and powers of two).
- `get` stopping at a tombstone instead of skipping it; `put` not reusing a tombstone or, worse, inserting a duplicate key past a tombstone when the key exists later in the run.
- Fixed bucket count with no resizing: works on these tests but degrades to O(n) — ask about it.
- A poor hash (`key % 1024`) with structured keys (multiples of 1024) puts everything in one bucket.
- Value 0 confused with "absent" in a sentinel-based design.

**Hint ladder**
1. If keys were small you could use an array indexed by key. What do you do with keys up to 10^9?
2. Map each key to a smaller index with a hash function. What happens when two keys land on the same index?
3. Either keep a small list per index (chaining) or probe to the next free slot (open addressing).
4. Decide how removal works in your scheme without breaking later lookups, and when to grow the table.

**Follow-ups**
- Load factor and resize policy; amortised cost of doubling; incremental rehashing to avoid latency spikes.
- Robin Hood hashing, backward-shift deletion, why `std::unordered_map` uses chaining (iterator/reference stability requirements) and why flat maps are faster.
- Hash flooding attacks and randomised/seeded hashing.
- Generic keys: what does the map need from the key type (hash + equality)?
