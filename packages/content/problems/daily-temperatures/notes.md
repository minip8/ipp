**Approaches**
- Brute force: for each day scan forward to the first warmer one. O(n^2) worst case (e.g. a long non-increasing run).
- Expected: monotonic stack of indices whose answer is still unknown, with temperatures non-increasing from bottom to top. For each new day, pop every index with a strictly lower temperature and set its answer to the distance. O(n) amortised (each index pushed and popped once), O(n) space.
- Alternative O(n): scan from the right and jump using already-computed answers (`j += ans[j]`), O(1) extra space besides the output.

**Common wrong turns**
- Popping on `<=` instead of `<` (equal temperatures are not warmer).
- Storing temperatures on the stack instead of indices (can't compute distances).
- Brute force with an early-break looks fast on random data but is quadratic on a descending sequence (hidden test).

**Hint ladder**
1. When you reach a warm day, which earlier days does it answer?
2. Among the days still waiting, is there an order in which they get answered?
3. Keep the waiting days on a stack; a new day resolves waiting days from the top while it's warmer than them.

**Follow-ups**
- Next greater element in a circular array (loop twice over indices).
- Previous smaller element, nearest smaller on both sides — building blocks for Largest Rectangle in Histogram.
- Stock span problem (online version: how many consecutive previous days were <= today).
