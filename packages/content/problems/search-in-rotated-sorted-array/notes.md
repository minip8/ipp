**Approaches**
- Linear scan: O(n). Correct but ignores the requirement — ask for O(log n).
- Two binary searches: first find the rotation point (index of the minimum) by comparing `nums[mid]` with `nums[hi]`, then binary search the half that can contain the target. O(log n).
- Expected (one pass): at each step at least one of `[lo, mid]` and `[mid, hi]` is sorted (compare `nums[lo] <= nums[mid]`). If the target lies within the sorted half's range, search there; otherwise search the other half. O(log n) time, O(1) space.

**Common wrong turns**
- Using `<` instead of `<=` in `nums[lo] <= nums[mid]` — breaks when `lo == mid` (two-element ranges).
- Range checks with the wrong inclusivity (`nums[lo] <= target < nums[mid]`).
- Infinite loops from `lo = mid` instead of `mid + 1`.
- Assuming a non-zero rotation.
- (Note for the interviewer: tests cannot time-separate O(n) from O(log n) here because the input itself is O(n) to read — enforce the requirement in discussion.)

**Hint ladder**
1. Split the array at any midpoint. What can you say about the two halves?
2. How can you tell which half is sorted in O(1)?
3. If the target fits the sorted half's value range, go there, otherwise go to the other half.

**Follow-ups**
- Duplicates allowed (LeetCode 81): when `nums[lo] == nums[mid] == nums[hi]` you can't tell — worst case O(n). Why?
- Find the minimum / the rotation amount.
- Search in a rotated array where you can only call `get(i)` (unknown length).
