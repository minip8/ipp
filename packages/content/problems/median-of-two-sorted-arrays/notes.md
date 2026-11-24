**Approaches**
- Merge and pick the middle: O(m + n) time, O(m + n) space (or O(1) space by merging only up to the middle with two pointers). A natural first answer.
- k-th smallest by discarding k/2 elements from one array per step: O(log(m + n)).
- Expected: binary search on the **partition** of the shorter array. Choose `i` elements from `a` and `j = (m + n + 1) / 2 - i` from `b` for the left half; the partition is correct when `a[i-1] <= b[j]` and `b[j-1] <= a[i]` (with ±infinity at the edges). Then the median is `max(left side)` (odd total) or the average of `max(left)` and `min(right)`. O(log min(m, n)) time, O(1) space.

**Common wrong turns**
- Binary searching the longer array (j can go negative / out of range).
- Edge handling when `i == 0`, `i == m`, `j == 0` or `j == n` — needs sentinels.
- Integer division producing `2` instead of `2.5`; or overflow when adding two values near 10^9 in 32-bit ints before halving (2 * 10^9 > 2^31 - 1).
- Thinking the median is the average of the two arrays' medians.
- (Interviewer note: test timing cannot separate O(m + n) from O(log) because reading the input is linear — the logarithmic method has to be assessed in discussion.)

**Hint ladder**
1. The median splits the combined elements into a left half and a right half. How many elements does the left half have?
2. If you decide how many of those come from `a`, how many must come from `b`? What has to be true at the boundary for the split to be valid?
3. Binary search that count over the shorter array, comparing the four boundary elements, and use infinities at the edges.

**Follow-ups**
- k-th smallest of two sorted arrays; of k sorted arrays.
- Running median of a stream (two heaps).
- Median of many sorted arrays distributed across machines (binary search on the value with counting).
