**Approaches**
- Square everything and sort: O(n log n). Correct; ask for better.
- Expected: two pointers at both ends. The largest square is always at one of the two ends (most negative or most positive), so fill the output from the back, taking the larger of `nums[l]^2` and `nums[r]^2`. O(n) time, O(n) for the output.
- Alternative O(n): find the first non-negative index and merge outward from it like merging two sorted lists. Works, but has more boundary cases.

**Common wrong turns**
- Merging outward from the split point but mishandling all-negative or all-positive arrays.
- Filling the output from the front with the two-ends approach (ends give the *largest*, not smallest).
- Overflow: squares up to 10^8 fit in 32-bit ints here; ask what changes if values reach 10^5.

**Hint ladder**
1. After squaring, where in the array can the largest value be?
2. If you repeatedly take the largest remaining square, which positions do you need to compare?
3. Two pointers at the ends, and write the output from the last index backwards.

**Follow-ups**
- Do it in place (not really possible in O(n) without extra space — discuss why).
- Apply any convex quadratic `a*x^2 + b*x + c` to a sorted array and return it sorted (Sort Transformed Array).
- Values can be up to 10^9 — what types do you need?
