**Approaches**
- Brute force: try `k = 1, 2, 3, ...` until the total hours fit. O(max(piles) * n) — up to 10^13 operations.
- Expected: binary search on `k` over `[1, max(piles)]`. Total hours is non-increasing in `k`, so find the smallest `k` with `hours(k) <= h`. O(n log max) time, O(1) space.
- Tighter bounds (nice but optional): lower bound `ceil(sum / h)`, upper bound `ceil(sum / (h - n + 1))`-ish.

**Common wrong turns**
- Integer ceil done with floating point (`ceil(p / k)` in doubles) — fine at these sizes in most languages but sloppy; `(p + k - 1) / k` is exact.
- Summing hours in 32-bit ints: with `k = 1` and 10^4 piles of 10^9, the sum is 10^13 — overflow in C++/Java. Use 64-bit or stop early once the sum exceeds `h`.
- Off-by-one in the binary search (returning `hi` vs `lo`, or `lo = mid` infinite loops).
- Lower bound 0 (division by zero).

**Hint ladder**
1. If speed `k` works, does `k + 1` also work? What does that monotonicity let you do?
2. What's the smallest speed worth considering, and the largest one you'd ever need?
3. Binary search over speeds with a helper that computes total hours for a speed — and watch the type of that total.

**Follow-ups**
- Capacity to Ship Packages Within D Days / Split Array Largest Sum (same pattern, different feasibility check).
- Minimise the maximum something / maximise the minimum something: recognising "binary search on the answer".
- Real-valued speed: binary search on doubles to a precision.
