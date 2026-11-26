**What this is testing**
A generic container with real C++ obligations, not just the hashing idea (that is `design-hashmap`): nodes that own `std::pair<const K, V>` elements, a rehash that relinks rather than copies, lookups that go through the `Hash` and `KeyEqual` parameters, the empty "no buckets" state that every operation must survive, and the rule of five over a structure of many heap blocks. Expect 40-50 minutes from a strong candidate: the code is long, and the interesting bugs (erase at the head of a chain, the moved-from state, growth threshold) are easy to make in a hurry.

**Approaches**
- Expected: `struct Node { Node* next; value_type kv; }`, members `Node** buckets_`, `size_t bucketCount_`, `size_t size_`, plus the `Hash` and `KeyEqual` objects (`[[no_unique_address]]` makes empty functors free). The bucket array is `new Node*[n]()` (value-initialised to null).
- Lookup: `if (bucketCount_ == 0) return end();` then walk `buckets_[hash_(k) % bucketCount_]` comparing with `eq_`. Insertion functions share one helper: look up first, return `{it, false}` if found, else grow if `size_ + 1 > bucketCount_`, `new Node` (piecewise construction of the pair), push at the head of its chain.
- `try_emplace`: `new Node(std::piecewise_construct, std::forward_as_tuple(std::move(key)), std::forward_as_tuple(std::forward<Args>(args)...))`. `operator[]` is `try_emplace(key).first->second`.
- Erase with a pointer to the link (`Node** link = &buckets_[b]; while (*link && !eq_(...)) link = &(*link)->next;`) handles the head of the chain without a special case; a `prev` pointer is fine if the head case is handled.
- Rehash: allocate the new array, pop each node off its old chain and push it onto `fresh[hash % n]`, free the old array. Nothing is copied.
- Iterator: node pointer plus the current bucket (and the end of the array); `++` follows `next`, then scans forward to the next non-empty bucket. libstdc++ instead keeps all nodes on one singly linked list with each bucket pointing at the node *before* its first element, which makes iteration O(n) instead of O(n + buckets); a candidate who knows this deserves credit.
- Copy constructor: same bucket count, copy each chain into the same bucket index (same hash, same count). Copy and move assignment by copy-and-swap / move-and-swap with a self check.

**Common wrong turns**
- Rehash implemented as "build a new map and `insert` every element": copies every key and value on each growth (`copies()` jumps), and costs an allocation per element.
- Growth threshold off by one (`size_ >= bucketCount_` before incrementing, or growing after the insert): `bucketCount` is 16 at size 8.
- `hash & (bucketCount_ - 1)`: only valid for powers of two, but `rehash(10)` must give 10 buckets.
- Dividing by `bucketCount_` when it is 0: `find`/`at`/`erase` on a fresh or moved-from map crash (SIGFPE).
- Erase with a `prev` pointer that forgets the head case: erasing the first element of a chain leaves the bucket pointing at a freed node.
- Comparing keys with `==` or comparing hashes: does not compile (`Key` has no `operator==`) or treats colliding keys as equal (hash mode 1 makes every key collide).
- `operator[]` as `insert({key, V()})`: a temporary pair, so extra copies/moves of the key and the value. `try_emplace` that builds the node before looking up: the key is moved from even when the key was present.
- `clear()` that frees the bucket array (the count must stay); erase that forgets `--size_` or `delete`.
- Move constructor that does not reset the source's pointers and counts (double free; the harness reports blocks freed twice). Copy assignment without a self check that clears first.
- Copy constructor that rebuilds through `insert` from an empty map: correct elements, but the wrong bucket count.

**Hint ladder**
1. Where does an element with key `k` live? What happens when two keys land in the same bucket?
2. What should `find` do on a map that has no buckets yet?
3. When the table grows, do the elements themselves need to go anywhere new, or only the pointers to them?
4. How do you remove a node from the middle of a singly linked chain? From the front? Can one loop do both?
5. `try_emplace(std::move(key))` with a key that is already present: what must not have happened to `key`?

**Follow-ups**
- Open addressing (linear probing, Robin Hood): better cache behaviour, but erase needs tombstones or backward shift, and elements move on rehash, so references are not stable. Why does `std::unordered_map` guarantee reference stability, and what does that cost? (Flat maps such as `absl::flat_hash_map` drop it.)
- Iterator invalidation: which operations invalidate iterators (rehash) and which invalidate references (only erase)?
- `max_load_factor`, prime vs power-of-two bucket counts (modulo cost vs. needing a good hash), and why libstdc++ caches hash codes in nodes for some key types.
- Heterogeneous lookup (`find` with a `std::string_view` on a `std::string` key; `is_transparent`).
- Exception safety: what happens if `Hash` throws during a rehash? If a `V` constructor throws in `try_emplace`?
- A `const_iterator`, and making `iterator` convertible to it. Erase by iterator returning the next iterator.
- A hash-flooding attack against an identity hash, and how randomised seeds defend against it.
