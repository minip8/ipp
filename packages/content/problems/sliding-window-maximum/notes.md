**Approaches**
- Brute force: max of each window, O(n * k). Up to ~2.5 * 10^9 at n = 10^5, k = n/2.
- Heap of (value, index) with lazy deletion of expired indices: O(n log n). Or a balanced BST / `multiset` with erase: O(n log k). Good intermediate answers.
- Expected: monotonic deque of indices whose values are strictly decreasing from front to back. For each new index: pop from the back while the back's value is `<=` the new value (they can never be a maximum again); push the index; pop from the front if it has left the window; the front is the current maximum. Each index is pushed and popped at most once: O(n) time, O(k) space.
- Block decomposition: prefix maxima within blocks of size k plus suffix maxima; `max(suffix[i], prefix[i + k - 1])`. O(n), no deque — a nice alternative.

**Common wrong turns**
- Storing values instead of indices in the deque (can't tell when the front expires, especially with duplicates).
- Popping the front with the wrong expiry condition (`front <= i - k`).
- Emitting results before the first window is complete.
- Using `<` vs `<=` when popping from the back: both are correct if indices are stored; worth asking why.

**Hint ladder**
1. When a new, larger element enters the window, what can you say about the smaller elements to its left?
2. Which elements are still "candidates" to become a window maximum at some point? How are they ordered?
3. Keep candidates' indices in a double-ended queue in decreasing value order: discard dominated ones from the back, expired ones from the front.

**Follow-ups**
- Rolling minimum and maximum simultaneously (two deques) — e.g. longest subarray where max - min <= limit.
- Streaming data with a time-based window (expire by timestamp, not count).
- Sliding window median (two heaps or an order-statistic tree).
