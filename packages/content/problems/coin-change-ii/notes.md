**Approaches**
- Brute force: recursion over (coin index, remaining amount) choosing how many of the current coin to take. Exponential without memo.
- Memoised 2-D DP: `ways(i, a)` = combinations of `a` using coins `i..k-1` = `ways(i+1, a) + ways(i, a - coins[i])`. O(k * amount) time and space.
- Expected: 1-D unbounded knapsack. `dp[0] = 1`; for each coin (outer loop), for `a` from coin up to amount (inner loop, increasing), `dp[a] += dp[a - coin]`. O(k * amount) time, O(amount) space.

**Common wrong turns**
- Swapping the loops (amount outer, coins inner) counts ordered sequences (permutations): for amount 3 with `[1, 2]` it gives 3 (1+1+1, 1+2, 2+1) instead of 2. This is the key insight of the problem; ask the candidate to explain why the coin-outer order avoids double counting.
- Iterating amounts downward in the 1-D form: that is the 0/1 knapsack (each coin at most once).
- `dp[0] = 0`: everything stays zero. The empty combination is one way to make 0.
- Overflow in 32-bit ints for large tests (counts here reach ~10^13): use 64-bit.

**Hint ladder**
1. How do you make sure 1+2 and 2+1 are only counted once? Can you impose an order on how coins are chosen?
2. Decide the coins one denomination at a time: for the current denomination, either never use it again or use one more of it.
3. That gives a 2-D table over (denominations considered, amount). Which direction does each entry depend on?
4. Process denominations in the outer loop and amounts upward in the inner loop over a single array.

**Follow-ups**
- What does swapping the loops compute, and when would you want that? (ordered compositions; e.g. climbing stairs with step sizes)
- Each coin can be used at most once (iterate amounts downward).
- Return the answer modulo 10^9+7 for huge inputs.
- Combine with coin-change: count the combinations that use the minimum number of coins.
