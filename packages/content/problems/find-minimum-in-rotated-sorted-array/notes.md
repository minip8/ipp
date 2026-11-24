**Approaches**
- Linear scan for the minimum (or for the drop `nums[i] < nums[i-1]`): O(n). Ask for O(log n).
- Expected: binary search comparing `nums[mid]` with `nums[hi]`. If `nums[mid] > nums[hi]`, the minimum is strictly right of mid (`lo = mid + 1`); otherwise it is at mid or to its left (`hi = mid`). Stop when `lo == hi`. O(log n) time, O(1) space.

**Common wrong turns**
- Comparing with `nums[lo]` instead of `nums[hi]`: with no rotation `nums[lo] <= nums[mid]` gives no information about which side holds the minimum — needs an extra check.
- `hi = mid - 1` in the "else" branch (can skip the minimum when it is at mid).
- `while lo <= hi` with `hi = mid` loops forever.
- (Interviewer note: O(n) and O(log n) cannot be separated by test timing because reading the input is linear; check the approach in discussion.)

**Hint ladder**
1. The rotated array is two sorted runs. Where is the minimum relative to them?
2. Look at the middle element and the last element. What does their order tell you?
3. Shrink towards the half whose order is "broken", keeping mid as a candidate when it could be the minimum.

**Follow-ups**
- With duplicates (LeetCode 154): `nums[mid] == nums[hi]` lets you only drop `hi` — worst case O(n). Why is that unavoidable?
- Return the rotation count (index of the minimum).
- Search for a target in the rotated array (Search in Rotated Sorted Array).
