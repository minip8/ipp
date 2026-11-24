**Approaches**
- Brute force: keep everything, sort (or nth_element) on each `add`. O(n log n) per add.
- Sorted array with binary-search insertion: O(log n) search but O(n) shift per add. Acceptable discussion, not the target.
- Expected: a **min-heap of size k** holding the k largest values seen. On add, push; if size exceeds k, pop the smallest. The answer is the heap top. O(log k) per add, O(k) space. Construction O(n log k) (or heapify then pop down to k).
- Alternative for the small value range (-10^4..10^4): counting array/Fenwick tree with order-statistic query — a nice aside, O(log V) per add.

**Common wrong turns**
- Using a max-heap of all elements and popping k times on each query (O(k log n) per add) or forgetting to push them back.
- Not trimming the initial `nums` down to k elements, or trimming before all of them are inserted.
- `nums` shorter than k (length k-1): the heap is not yet full after construction; the first `add` fills it. Code that assumes `heap.top()` exists in the constructor crashes (test `h-empty-start` uses k = 1, nums = []).
- C++: `priority_queue<int>` is a max-heap by default; need `greater<int>`.
- Optimisation pitfall: "if val <= top, skip" is only valid when the heap already has k elements.

**Hint ladder**
1. Do you need to remember every score, or only some of them?
2. Which scores can never again be the k-th largest?
3. Keep only the k largest seen so far. Which of those k do you need to look at, and which one gets thrown out when a new score arrives?
4. A min-heap capped at size k: its top is the answer.

**Follow-ups**
- Support removing a score (lazy deletion, or two heaps / order-statistic tree).
- k changes between queries — two heaps (like a median finder) or an order-statistic tree.
- Distributed stream across many machines: each keeps its local top k, merge.
- Bounded value range: counting array or Fenwick tree with binary lifting.
