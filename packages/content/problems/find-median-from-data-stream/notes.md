**Approaches**
- Sort on every query: O(n log n) per `findMedian`. Too slow when queries are frequent.
- Keep a sorted array with binary-search insertion (`bisect.insort`, `vector::insert`): O(log n) search but O(n) shifting per insert. In practice fast for moderate n because of memmove — worth discussing honestly; it is not the asymptotic answer.
- Expected: two heaps. A max-heap `low` holds the smaller half, a min-heap `high` the larger half, with `len(low) == len(high)` or `len(low) == len(high) + 1`. Insert into `low`, move `low`'s top to `high`, and if `high` is now bigger move its top back. Median is `low.top()` or the average of the two tops. O(log n) add, O(1) query.
- Also fine: an order-statistics tree or a balanced BST with a pointer to the middle (C++ `multiset` with an iterator that moves left/right on each insert) — elegant and a good C++ discussion point.

**Common wrong turns**
- Integer division when averaging: `(a + b) / 2` in C++/Java on ints truncates (and `-3 / 2` truncates toward zero). Convert to double first.
- Overflow when summing two ints near the limit (not at these constraints, but ask).
- Unbalanced heaps: pushing to one heap based only on comparison with one top, then forgetting to rebalance sizes.
- Python's `heapq` is a min-heap only; negate values for the max-heap and remember to negate back.
- Comparing with the top of an empty heap.

**Hint ladder**
1. To know the median you only need the elements in the middle. What about the rest?
2. Split the numbers into a "smaller half" and a "larger half". What do you need to know about each half?
3. You need the largest of the smaller half and the smallest of the larger half quickly: which structures give you those?
4. Keep the two halves' sizes within one of each other; after each insert, move one element across if needed.

**Follow-ups**
- All numbers are in [0, 100]: counting array, O(100) or O(1) median.
- 99% of numbers are in [0, 100]: counting array plus overflow counts below/above.
- Sliding-window median (removal needed): two heaps with lazy deletion, or two multisets.
- Any percentile, not just the median (e.g. p99 latency): sized heaps, or approximate structures (t-digest, HDR histogram) for streaming telemetry.
