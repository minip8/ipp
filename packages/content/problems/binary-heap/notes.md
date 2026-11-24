**Rule check (not enforced by tests)**
- No `std::priority_queue`, `std::make_heap`/`push_heap`/`pop_heap`, `heapq`, `PriorityQueue`, ordered containers or sorting. A `vector`/`ArrayList`/Python list as plain storage is allowed. Read the code: `toArray` makes most library shortcuts fail anyway (`heapq` is a min-heap with a different sift-down; `std::pop_heap` does not promise this layout), but a candidate could still wrap a library heap and reimplement only the layout bits.

**Approaches**
- Expected: array `a`, size `n`. `push` = append + sift up; `pop` = save root, move last to root, shrink, sift down; `replaceTop` = overwrite root + one sift down (cheaper than pop + push: one O(log n) pass instead of two). `top`/`size` O(1); `push`/`pop`/`replaceTop` O(log n).
- `build`: Floyd's bottom-up heapify, sift down from `n/2 - 1` to `0`. O(n) because most nodes are near the bottom: the sum over levels of (nodes at height h) * h = O(n). Pushing one at a time is O(n log n) and gives a different array, which the tests check (`h-build-vs-push` vs `h-push-ascending`).
- The exact sift rules (strict comparisons, left child on ties) are specified only so `toArray` is deterministic; the interesting part is the index arithmetic and the boundaries.
- Sorted array / scan for the max: O(n) per operation and fails the layout tests.

**Common wrong turns**
- Sift down that only looks at the right child when it exists but forgets the case of a lone left child (or reads `a[2i+2]` past the end). `h-left-child-only`.
- Choosing the right child on ties (`>=`): the tie tests (`s3`, `h-replace-equal`) catch it. (Swapping with a merely equal child is harmless: it leaves the same array, so the "strictly greater" in the statement only rules out wasted work.)
- `pop` on a one-element heap: moving the last element to the root and then sifting a heap that is now empty, or leaving a stale root. `h-pop-to-empty`.
- Heapify loop starting at `n/2` (harmless) or at `n/2 - 1` with unsigned arithmetic in C++ (`size_t i = n/2 - 1` underflows for `n == 0` or 1). `h-build-empty`.
- Heapify going top-down (`i` from 0 upward with sift down): does not produce a heap.
- `build` appending to the old contents instead of replacing them.
- `replaceTop` on an empty heap: must push and return the sentinel.
- Parent index `(i - 1) / 2` vs `i / 2` with 1-based thinking.
- Java: `Integer` comparisons with `==` if they used `ArrayList<Integer>` (fails outside -128..127; the tests use values up to 10^9).

**Hint ladder**
1. How do you find the parent and the children of position `i` in a complete binary tree stored level by level?
2. After adding at the end, which single path can be out of order? After replacing the root?
3. Push: sift the new element up while it beats its parent. Pop: move the last element to the root and sift it down, always swapping with the larger child.
4. For build, every leaf is already a heap. Sift down each internal node starting from the last one (`n/2 - 1`) back to the root; why is that O(n)?

**Follow-ups**
- Prove the O(n) bound for heapify. Why is sift-down cheaper than sift-up for building?
- Heapsort in place from this. Why is it not stable, and why is it cache-unfriendly compared to quicksort?
- Decrease-key / update an arbitrary element: needs an index map from element to position (Dijkstra).
- d-ary heaps (fewer levels, more comparisons per level; better cache behaviour); when is a 4-ary heap faster?
- Make it generic with a comparator (`priority_queue<T, Container, Compare>`); a min-heap from the same code.
- Merge two heaps: why a binary heap is O(n), and what leftist/binomial/pairing heaps offer.
