**Approaches**
- Library sort: O(n log n), disallowed.
- Counting sort: count 0s, 1s, 2s and overwrite — two passes, O(1) space. Perfectly good engineering answer; then ask for one pass.
- Expected: Dutch national flag partition with three pointers `low`, `mid`, `high`. Invariant: `[0, low)` are 0s, `[low, mid)` are 1s, `(high, n-1]` are 2s, `[mid, high]` unknown. If `nums[mid] == 0` swap with `low` and advance both; if 1 advance `mid`; if 2 swap with `high` and decrement `high` **without** advancing `mid`. O(n), one pass, O(1) space.

**Common wrong turns**
- Advancing `mid` after swapping with `high` (the swapped-in element is unexamined) — `[2, 0, 1]`-like inputs break.
- Loop condition `mid < high` instead of `mid <= high`.
- Writing it as "return a new sorted list" via counting — works here since only the return value is judged; push for the in-place one-pass version anyway, since that's the point of the question.

**Hint ladder**
1. If you only had 0s and 2s, how would you partition in one pass with two pointers?
2. With three values, what regions of the array can you maintain as you scan?
3. Keep a "0s" boundary at the front, a "2s" boundary at the back, and a scanning pointer; think carefully about which swaps let the scanner advance.

**Follow-ups**
- Stability: is the partition stable? Does it matter for plain integers? For objects with keys?
- k colours: counting sort in O(n + k), or recursive partitioning in O(n log k).
- Relation to quicksort's 3-way partition (handling many equal keys).
