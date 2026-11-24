**Approaches**
- Brute force: all O(n^2) subarrays with a running sum (O(n^2)); with recomputed sums it's O(n^3). The O(n^2) version is a fine start.
- Expected: prefix sums + hash map. With `P[j]` the sum of the first j elements, subarray (i, j] sums to k iff `P[i] = P[j] - k`. Scan once, keeping counts of prefix sums seen so far (seeded with `{0: 1}`), adding `count[P - k]` at each step. O(n) time, O(n) space.

**Common wrong turns**
- Sliding window: only valid when all numbers are non-negative. Negative values break it — ask the candidate for a counter-example if they propose it.
- Forgetting to seed the map with prefix sum 0 (misses subarrays starting at index 0).
- Updating the map *before* querying for the current prefix (with k = 0 this counts empty subarrays).
- Storing a boolean "seen" instead of a count (undercounts when prefix sums repeat, e.g. with zeros).

**Hint ladder**
1. How can you get the sum of any subarray in O(1) after O(n) preprocessing?
2. Rewrite "sum of (i, j] equals k" in terms of two prefix sums.
3. While scanning j, how many earlier prefix sums equal `P[j] - k`? Keep a count of each prefix sum seen.

**Follow-ups**
- All numbers positive: two pointers / sliding window in O(1) space.
- Return the longest such subarray (store first index of each prefix sum instead of a count).
- Count subarrays whose sum is divisible by k (prefix sums mod k; careful with negative mod).
- 2D version: number of submatrices summing to k (O(rows^2 * cols)).
