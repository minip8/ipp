**Approaches**
- Brute force: all 2^n subsequences. Hopeless beyond n ~ 20.
- Classic DP: `len[i]` = longest increasing subsequence ending at i = 1 + max `len[j]` over `j < i` with `nums[j] < nums[i]`. O(n^2) time, O(n) space. At n = 2.5*10^4 that is ~3*10^8 simple steps: borderline in C++ (it may pass), clearly too slow in Python. Accept it as a first answer, then ask for better.
- Expected: patience sorting. Keep `tails[k]` = the smallest possible last value of an increasing subsequence of length k+1. For each x, binary-search the first tail `>= x` (lower_bound) and replace it, or append if none. Answer = `len(tails)`. O(n log n) time, O(n) space.
- Also valid: DP over values with a Fenwick tree / segment tree of max lengths (values are small here), O(n log V).

**Common wrong turns**
- Using upper_bound instead of lower_bound in the tails method: that computes the longest *non-decreasing* subsequence (`[6, 6, 6]` would give 3).
- Believing `tails` is itself an increasing subsequence of the input. It is not; only its length is meaningful. Ask the candidate to explain the invariant.
- Returning `len[n-1]` instead of `max(len)` in the O(n^2) DP.
- Greedy "extend whenever larger than the last kept element" fails on `[3, 10, 2, 11, 4, 5, 6]`.

**Hint ladder**
1. Define a quantity per index: the best subsequence that *ends exactly* at index i. How does it relate to earlier indices?
2. That gives O(n^2). To go faster: among all increasing subsequences of the same length, which one is the most useful to extend later?
3. Track, for every length, the smallest tail value seen so far. That array is sorted. Why?
4. For each new x, find (by binary search) the first tail that is >= x and overwrite it; append if x beats every tail.

**Follow-ups**
- Reconstruct one actual subsequence (store predecessor indices alongside tails positions).
- Longest non-decreasing subsequence (upper_bound).
- Count the number of longest increasing subsequences (O(n^2) DP, or O(n log n) with a BIT of (length, count)).
- Russian-doll envelopes: sort by width ascending, height descending, then LIS on heights.
- Minimum number of decreasing subsequences needed to cover the array (Dilworth: equals the LIS length).
