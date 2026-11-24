**Approaches**
- Sort and scan: O(n log n).
- Hash set of values, then probe 1, 2, 3, ...: O(n) time, O(n) space. Correct; violates the space limit.
- Key insight: the answer is in `[1, n + 1]`, so only values in that range matter, and the array itself can serve as the hash table.
- Expected (cyclic sort): for each index, while `1 <= v <= n` and `nums[v - 1] != v`, swap `v` into position `v - 1`. Then the first index `i` with `nums[i] != i + 1` gives `i + 1`; otherwise `n + 1`. Each swap places one value permanently, so O(n) total, O(1) extra.
- Alternative (sign marking): replace out-of-range values with `n + 1`, then for each `|v| <= n` make `nums[|v| - 1]` negative; the first positive index is the answer.

**Common wrong turns**
- Infinite loop on duplicates in cyclic sort: the condition must be `nums[v - 1] != v`, not `i != v - 1`.
- Sign marking without first neutralising zeros/negatives, or marking twice (double negation).
- Returning `n` instead of `n + 1` when `1..n` are all present.
- Overflow in C++ with `abs(INT_MIN)` in the sign-marking variant if out-of-range values aren't replaced first.

**Hint ladder**
1. For an array of length n, what's the largest the answer could possibly be?
2. Values outside `[1, n]` are irrelevant. If you could store a "seen" flag for each of 1..n without extra memory, where would you put it?
3. Put each value v in [1, n] at index v - 1 by swapping (or mark index v - 1 by sign); then scan for the first index that's out of place.

**Follow-ups**
- Why does cyclic sort run in O(n) despite the nested loop?
- Find all missing numbers in `[1, n]`; find the duplicate and the missing number together.
- Read-only input with O(1) space: what's the best you can do? (binary search on value with counting: O(n log n))
