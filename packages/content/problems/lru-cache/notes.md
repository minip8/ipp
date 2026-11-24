**Approaches**
- Brute force: a list of (key, value) in recency order, linear search on every call. O(capacity) per operation; with capacity 3000 and 2*10^5 calls it is slow in Python but may pass in C++ — push for O(1).
- Expected: hash map from key to a node in a doubly linked list ordered by recency. `get` moves the node to the front; `put` updates/moves or inserts at the front and pops the tail when over capacity. O(1) per operation, O(capacity) space.
- C++: `std::list<pair<int,int>>` + `unordered_map<int, list::iterator>`, using `splice` to move a node without reallocating. Strong candidates know `splice` keeps iterators valid.
- Python: `collections.OrderedDict` with `move_to_end` / `popitem(last=False)` is acceptable, but ask them to sketch the underlying structure; a plain `dict` (insertion ordered) with pop-and-reinsert also works.
- Java: `LinkedHashMap` with access order and `removeEldestEntry` is the library answer; ask for the manual version too.

**Common wrong turns**
- Updating an existing key's value without refreshing its recency.
- Evicting before inserting when the key already exists (an update must never evict).
- Treating a missed `get` as a use, or forgetting that a hit is one.
- Storing only values in the list, so the evicted node's key cannot be erased from the map.
- Hand-rolled linked list: forgetting to fix `prev`/`next` of neighbours, or of head/tail when the list has one node. Sentinel head/tail nodes avoid most of these.
- capacity = 1: every new key evicts the previous one.

**Hint ladder**
1. Which two things do you need fast: finding a key, and finding the least recently used key. Can one structure do both?
2. What structure lets you move an element from the middle to one end in O(1) if you already hold a pointer to it?
3. Keep a doubly linked list in recency order and a hash map from key to its list node.
4. On every hit or put, unlink the node and relink it at the front; evict from the back, and erase the evicted key from the map too (store the key in the node).

**Follow-ups**
- Make it thread safe. Where would a single mutex be a bottleneck? (sharding by key, lock striping)
- Memory: the list allocates per node. How would you avoid allocation on the hot path? (pre-allocated node pool, intrusive list, index-based links in a vector)
- Add a TTL per entry. Add `delete(key)`.
- How would you evict by size in bytes rather than entry count?
- Compare with LFU; when does LRU behave badly (a one-off scan flushes the cache)?
