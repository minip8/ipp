**Approaches**
- Simulation with a max-heap: pop two, push the difference if non-zero. Each round removes at least one stone, so at most n rounds: O(n log n) time, O(n) space.
- Python has only a min-heap: push negated weights (or use `heapq._heapify_max` style tricks — prefer negation, it's explicit).
- C++: `priority_queue<int>` is a max-heap by default. Java: `PriorityQueue` with `Collections.reverseOrder()`.
- Re-sorting the whole array each round: O(n^2 log n). Works for small inputs; ask the candidate what it costs at n = 2 * 10^4.
- Bucket/counting idea (weights <= 1000): keep counts per weight and scan downward — O(n + W) per... discuss as a follow-up, not required.

**Common wrong turns**
- Using a min-heap in Python without negating, so the lightest stones are smashed.
- Pushing back a zero-weight stone when the two are equal (then the answer can wrongly become 0 or the loop never ends with the expected count).
- Returning the heap top when the heap is empty.
- Forgetting the single-stone input.

**Hint ladder**
1. Each step needs the two largest values of a changing collection. What data structure gives the maximum quickly while allowing inserts?
2. A heap gives max in O(1) and pop/push in O(log n).
3. Loop: pop the top two, push their difference if it is non-zero; stop when fewer than two remain.
4. In Python, store negatives in `heapq` to emulate a max-heap.

**Follow-ups**
- Last Stone Weight II: you may pick **any** two stones each round; minimise the final weight (it becomes a subset-sum / partition DP).
- Weights up to 10^9 but n large: still heap. Weights tiny but n = 10^7: counting buckets.
- Why is the loop guaranteed to terminate within n - 1 rounds?
