**Approaches**
- Copy `nums2` into the tail and sort: O((m + n) log(m + n)). Works; ask for linear.
- Merge into a new array from the front, then copy back: O(m + n) time, O(m + n) extra space.
- Expected: merge **from the back**. Pointers at `m - 1`, `n - 1` and write position `m + n - 1`; place the larger of the two tails at the write position. Once `nums2` is exhausted the remaining `nums1` prefix is already in place. O(m + n) time, O(1) extra space.

**Common wrong turns**
- Merging from the front in place (overwrites unread `nums1` elements).
- Loop condition `while i >= 0 and j >= 0` and then forgetting to copy the rest of `nums2` (the rest of `nums1` is fine).
- Treating the placeholder zeros as real values (`m = 0` case).
- Ties: either choice is fine for integers; ask about stability for records.

**Hint ladder**
1. Where is there free space in `nums1`?
2. Which element belongs in the very last slot of the merged array?
3. Fill `nums1` from its end, taking the larger tail each time; think about what's left when one input runs out.

**Follow-ups**
- Merge k sorted arrays (heap, O(N log k)).
- Merge two sorted linked lists.
- Intersection / union of two sorted arrays with duplicates.
