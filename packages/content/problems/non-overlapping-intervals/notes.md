**Approaches**
- Equivalent problem: keep the maximum number of non-conflicting intervals (classic activity selection); answer = n - kept.
- Brute force over subsets: exponential. DP after sorting (longest chain, O(n^2)) — correct but slow at 10^5.
- Expected: sort by **end**; greedily keep an interval whenever its start is `>=` the end of the last kept one. O(n log n) time, O(1) extra (besides sorting).
- Also valid: sort by start; on conflict, drop the one with the larger end (keep `min(end)`). Same complexity.

**Common wrong turns**
- Sorting by start and always keeping the earlier one (fails when an early interval is very long: `[[1, 100], [2, 3], [4, 5]]`).
- Sorting by length (counter-example: `[[1, 5], [4, 7], [6, 10]]` — the shortest, [4, 7], conflicts with both others).
- Treating touching intervals as conflicting (`>=` vs `>`).
- Returning the number kept instead of removed.

**Hint ladder**
1. Rephrase: what's the largest set of bookings you can keep?
2. Which booking is the safest one to keep first — think about how much of the timeline it uses up for later bookings.
3. Sort by end time and keep greedily; argue why choosing the earliest finishing booking never hurts.

**Follow-ups**
- Prove the greedy choice (exchange argument).
- Weighted version (each interval has a value): DP + binary search, O(n log n).
- Minimum arrows to burst balloons (same greedy, closed intervals).
