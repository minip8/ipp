**Approaches**
- Simulation: repeatedly fix violations until stable — O(n^2) worst case.
- Expected: two passes. Left to right: `c[i] = c[i-1] + 1` if `r[i] > r[i-1]`, else 1. Right to left: `c[i] = max(c[i], c[i+1] + 1)` if `r[i] > r[i+1]`. Sum. O(n) time, O(n) space.
- O(1) space: count lengths of increasing and decreasing runs (slopes); peaks take the max of the two slopes. Tricky but a strong follow-up.

**Common wrong turns**
- A single left-to-right pass (misses decreasing runs: `[3, 2, 1]` needs 3, 2, 1).
- In the second pass, overwriting instead of taking the `max` (breaks peaks whose left side is longer).
- Treating equal neighbours as needing equal candies (`[1, 2, 2]` -> 4, not 5).
- Overflow: not an issue at this size (max ~2 * 10^8), but the answer type is 64-bit anyway.

**Hint ladder**
1. Consider only the "left neighbour" rule. How would you satisfy it with as few candies as possible?
2. Now do the same for the right-neighbour rule on its own.
3. Combine the two solutions so both rules hold at once — what operation at each position preserves both?

**Follow-ups**
- Prove the two-pass result is minimal.
- O(1) extra space with the slope-counting method.
- Children in a circle; or ratings in 2D (grid neighbours) — becomes a topological / DP-on-DAG problem.
