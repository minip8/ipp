**Approaches**
- Brute force: enumerate all subsequences of s of length |t| (C(n, k)) or recurse "use s[i] or skip it" without memo. Exponential.
- Expected: `W[i][j]` = number of ways to form `t[:j]` from `s[:i]`. `W[i][0] = 1`; `W[0][j>0] = 0`; `W[i][j] = W[i-1][j] + (s[i-1] == t[j-1] ? W[i-1][j-1] : 0)`. O(|s| * |t|) time. One row suffices if j is iterated **downward** for each new character of s (like 0/1 knapsack). Early exit: if |t| > |s| the answer is 0.

**Overflow (a good discussion point)**
- Only the final answer is guaranteed to fit in 32 bits. Counts for shorter prefixes of t can be astronomically large: `s = "aaaa...a" (1000 times)`, `t = "aaaaa...ab"` has answer 0 but `W` for `t = "aaaaa"` is C(1000, 5) ~ 8*10^12.
- Signed overflow is undefined behaviour in C++. Since everything is additions and the true answer is < 2^31, doing the arithmetic in `unsigned long long` (mod 2^64) gives the exact answer; so does Java's wrapping `long`. Strong candidates explain *why* modular arithmetic is safe here. Clamping/saturating at INT_MAX is wrong (a clamped intermediate can still feed the final answer). Python's big ints sidestep it (but get slow if values are huge; masking to 64 bits is fine).
- Doubles lose precision; do not use them.

**Common wrong turns**
- Iterating j upward in the 1-D version (reuses the same s character twice).
- Wrong base case (`W[i][0]` must be 1 for every i: the empty target is formed one way).
- Confusing with "number of distinct subsequences of s" (a different problem with deduplication).
- Memoised recursion on (i, j) is fine in C++ but recurses ~|s| deep; OK with 1000.

**Hint ladder**
1. Consider the last character of s. Either it is not used in the match, or it is matched to the last character of t (only possible if they are equal).
2. That gives a recurrence on prefixes of s and t. What are the base cases for an empty t and an empty s?
3. Fill a table over (i, j); then notice each row only depends on the previous one.
4. With one row, update j from high to low. Then think hard about how large intermediate values can get.

**Follow-ups**
- Return the answer modulo 10^9+7 with no size guarantee.
- Count occurrences of t as a subsequence for many queries t on one fixed s.
- Reconstruct one (or the lexicographically smallest) index sequence.
