**Approaches**
- Simulation on an array `owner[0..n-1]` (0 = free): allocate scans left to right counting the current free run; free scans the whole array for `mID`. O(n) per call. This is the natural first answer and is fine for small n; ask what dominates when n = 10^5 and calls = 2*10^4 (about 2*10^9 steps worst case — OK-ish in C++, hopeless in Python).
- Expected: a **free list** of disjoint intervals kept in address order (`std::map<start, end>`, `TreeMap`, or a sorted list), plus a map `mID -> list of blocks`. Allocate walks the free list for the first interval long enough and splits it; free re-inserts each block and **coalesces** it with the neighbouring free intervals. Cost O(F) per allocate (F = number of free fragments) and O(B log F) per free (B = blocks owned by the mID). Usually F is far smaller than n.
- Optimal first fit: a segment tree over the units storing for each node the longest free run, the free prefix length and the free suffix length. "Leftmost run of length >= size" is a single descent in O(log n); allocate and free become range assignments with lazy propagation. Good for a strong candidate as a follow-up; overkill to code first.

**Common wrong turns**
- Assuming one block per `mID`: several allocations may share an id, and `freeMemory` must free all of them and return the total.
- Forgetting to merge adjacent free intervals, so a later large allocation fails even though enough contiguous space exists.
- Merging only with one neighbour (left or right) instead of both.
- Off-by-one with inclusive vs half-open intervals; half-open `[start, end)` makes adjacency checks `left.end == start` clean.
- Modifying a `std::map` while iterating it without using the iterator returned by `erase`.

**Hint ladder**
1. Write the array simulation first. Where does the time go?
2. Instead of individual units, what if you tracked maximal free runs?
3. Keep the free runs ordered by address so first fit is "the first run that is long enough"; remember each mID's blocks so freeing does not scan memory.
4. When a block is freed, look at the free run immediately before it and immediately after it, and merge.

**Follow-ups**
- Best fit vs first fit vs next fit: fragmentation trade-offs. What does `malloc` (e.g. dlmalloc's size-segregated bins) actually do?
- Make allocate O(log n) (segment tree, or a size-ordered set of free runs for best fit).
- Alignment requirements (allocate at addresses that are multiples of 8).
- How would you detect double free or use-after-free in a real allocator? (canaries, generation counters — see the object-pool problem)
- Fixed-size slab / pool allocators for the common small sizes in low-latency systems: no fragmentation, O(1) alloc/free.
