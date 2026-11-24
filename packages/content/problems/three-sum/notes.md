**Approaches**
- Brute force: three nested loops plus a set of sorted triples to dedupe. O(n^3). Too slow at n = 2000.
- Hash-based: fix `i`, then run Two Sum with a set over the rest; dedupe with a set of sorted tuples. O(n^2) time but heavy constant and extra memory for dedupe.
- Expected: sort, fix the first element `i` (skip if equal to the previous one), then two pointers `lo = i+1`, `hi = n-1` moving inward; on a hit, record it and skip duplicates on both sides. O(n^2) time, O(1) extra besides the output (O(log n)–O(n) for the sort).
- Early exit: once `nums[i] > 0` after sorting, no more triples are possible.

**Common wrong turns**
- Duplicate triples: not skipping equal `nums[i]`, or not skipping equal `lo`/`hi` values after a hit (`[-2, 0, 0, 2, 2]` produces `[-2, 0, 2]` twice).
- Over-eager dedupe that drops valid triples with repeated values (`[0, 0, 0]`, `[-2, 1, 1]`).
- Reusing the same position twice (e.g. `[1, -2]` -> claiming `[1, 1, -2]`).
- Moving only one pointer after a hit (infinite loop or missed answers).

**Hint ladder**
1. If you fix one number `a`, what problem remains for the other two?
2. You've seen Two Sum — what if the array were sorted? How does sorting also help with duplicates?
3. Sort; for each distinct first value, sweep two pointers from both ends of the remainder, skipping repeated values after each match.

**Follow-ups**
- 3Sum Closest (track the best distance), 3Sum Smaller (count with two pointers).
- 4Sum / kSum: recursion down to two-pointer base case, O(n^(k-1)).
- Count triples by *position* instead of distinct values — how does the counting change?
