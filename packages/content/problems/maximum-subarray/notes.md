**Approaches**
- Brute force: all O(n^2) subarrays with running sums. Too slow at 10^5.
- Prefix sums: answer = max over j of `P[j] - min_{i<j} P[i]`. O(n).
- Expected: Kadane — the best subarray ending at `i` is either `nums[i]` alone or `nums[i]` appended to the best ending at `i - 1`: `cur = max(x, cur + x)`, `best = max(best, cur)`. O(n) time, O(1) space.
- Divide and conquer: best of left, right, and crossing the middle. O(n log n) — the classic follow-up ("can you do it with divide and conquer?").

**Common wrong turns**
- Initialising `best = 0` (returns 0 for all-negative arrays — the subarray must be non-empty).
- 32-bit overflow: 10^5 values of 10^9 sum to 10^14. C++/Java must accumulate in 64 bits.
- Resetting `cur` to 0 *before* adding the current element in a way that allows an empty subarray.

**Hint ladder**
1. Suppose you know the best subarray sum ending exactly at index i - 1. What are the options for one ending at i?
2. When is it better to start fresh at i than to extend?
3. Track "best ending here" and "best overall" in one pass — and think about what to initialise them to.

**Follow-ups**
- Return the start and end indices (tie-breaking rules).
- Circular array (max of normal Kadane and total minus minimum subarray; all-negative edge case).
- Maximum product subarray (track min and max because of sign flips).
- At most k elements / at least k elements; 2D maximum-sum submatrix (Kadane over column pairs, O(rows^2 * cols)).
