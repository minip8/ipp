**Approaches**
- DP: `dp[j][i]` = best cost for the first i elements in j parts, transition over the last cut: O(k * n^2) time. Correct, and worth stating; too slow at n = 10^4 with large k in Python.
- Expected: binary search on the answer. For a candidate cost `C`, greedily pack elements left to right, starting a new part only when the next element would push the current sum above `C`; `C` is feasible iff that uses at most `k` parts — using fewer is fine, because while there are fewer than k parts some part has two or more elements and can be split without increasing the maximum (n >= k). Search `C` in `[max(nums), sum(nums)]`. O(n log(sum)) time, O(1) space.

**Common wrong turns**
- Lower bound 0 or 1 instead of `max(nums)` (the greedy check then loops or miscounts when a single element exceeds `C`).
- Requiring *exactly* k parts in the feasibility check — "at most k" is the right monotone predicate; explain why it's equivalent.
- Greedy without binary search (e.g. cut whenever the sum exceeds total/k) — not optimal.
- Summing in 32-bit ints: 10^4 * 10^6 = 10^10.

**Hint ladder**
1. If I tell you a maximum part sum `C`, can you quickly check whether a split with cost at most `C` exists?
2. How does feasibility change as `C` grows? What are the smallest and largest values `C` could take?
3. Binary search `C` between `max(nums)` and `sum(nums)`, using a greedy left-to-right packing as the check.

**Follow-ups**
- Return the actual split.
- Prove the greedy check is optimal for a fixed `C`.
- Capacity to Ship Packages Within D Days, Koko Eating Bananas, Minimise Max Distance to Gas Station (same family).
- Non-negative real numbers: binary search on doubles, or parametric search on the candidate sums.
