**Approaches**
- Reduce: a split exists iff the total S is even and some subset sums to exactly S/2.
- Brute force: try all 2^n subsets. Hopeless at n = 200.
- Expected: 0/1 knapsack over sums. `reach[s]` = some subset of the items seen so far sums to s. For each item x, for s from S/2 down to x: `reach[s] |= reach[s - x]`. O(n * S/2) = 200 * 10^4 = 2*10^6 steps.
- Bitset trick: keep the reachable sums as bits; each item does `bits |= bits << x`. O(n * S / 64) in C++ with `std::bitset<10001>`; in Python, a big int works the same way.
- Memoised DFS on (index, remaining) is also fine.

**Common wrong turns**
- Iterating sums upward in the 1-D array: each item gets reused (unbounded knapsack); `[1, 2, 5]` becomes "true" because 2 = 1 + 1.
- Forgetting the odd-total early exit (not wrong, just slower) or, worse, checking `S % 2` after integer-dividing.
- Greedy: sort descending and put each number into the lighter group. Fails on `[3, 3, 2, 2, 2]` (greedy gets 3+2+2 vs 3+2; answer {3, 3} vs {2, 2, 2}).
- Recursion over subsets without memo (2^200).

**Hint ladder**
1. If the two groups have equal sums, what must each group sum to?
2. So the question is: is there a subset with a specific target sum? How large can that target be?
3. Track the set of sums reachable using the first i items. How does adding one item change that set?
4. Use a boolean array indexed by sum, and iterate sums downward so each item is used at most once (or use a bitset shift).

**Follow-ups**
- Return the two groups.
- Minimise the difference between the two group sums (same DP; pick the reachable sum closest to S/2).
- Split into k equal groups (backtracking with pruning / bitmask DP; NP-hard in general).
- Values up to 10^9 with n = 40: meet-in-the-middle.
- Why is this pseudo-polynomial and not polynomial?
