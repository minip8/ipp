**Approaches**
- Brute force recursion: try every coin as the next one, recurse on `amount - c`. Exponential; memoising on the remaining amount turns it into the DP below.
- Expected: `dp[a] = 1 + min(dp[a - c])` over coins `c <= a`, with `dp[0] = 0` and "infinity" for unreachable. O(amount * k) time, O(amount) space.
- Equivalent: BFS over amounts 0..amount where each edge adds one coin; the first time `amount` is reached is the answer. Same complexity, sometimes faster in practice.

**Common wrong turns**
- Greedy (largest coin first). Works for real currencies but not in general: `[1, 5, 6, 9]`, 11 -> greedy gives 3, optimum 2. Make the candidate find or accept a counterexample.
- Using a sentinel like `INT_MAX` and then adding 1 (overflow). Use `amount + 1` as infinity.
- Forgetting `amount = 0` -> 0, or returning the sentinel instead of -1.
- Confusing with "number of ways" (coin-change-ii): this asks for a minimum.
- Coins larger than the amount must simply be skipped (no negative index).

**Hint ladder**
1. Does picking the biggest coin first always work? Try coins `[1, 5, 6, 9]` and amount 11.
2. Suppose you knew the best answer for every smaller amount. If the last coin you use is `c`, what is the best total?
3. Build an array of best answers for 0, 1, ..., amount; each entry looks back at `amount - c` for every coin.
4. Mark unreachable amounts with a value larger than any real answer and translate it to -1 at the end.

**Follow-ups**
- Return the actual coins used (store the last coin chosen per amount).
- Each coin may be used at most once (0/1 knapsack: iterate amounts downward).
- Count the number of ways instead (see coin-change-ii; loop order matters there).
- For which coin systems is greedy optimal? ("canonical" coin systems)
- amount up to 10^9 with tiny coins: BFS/DP over residues, or bound the number of large coins.
