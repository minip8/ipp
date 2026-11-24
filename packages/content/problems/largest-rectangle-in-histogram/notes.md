**Approaches**
- Brute force: every pair (i, j) with a running minimum: O(n^2).
- Divide and conquer around the minimum bar: O(n log n) expected, O(n^2) on sorted input (unless a segment tree finds minima).
- Expected: monotonic stack. For each bar, the best rectangle using that bar as the shortest one extends to the nearest smaller bar on each side. Maintain a stack of indices with increasing heights; when a shorter bar arrives, pop and compute the popped bar's area — its right boundary is the current index and its left boundary is the new stack top. A sentinel 0 at the end flushes the stack. O(n) time, O(n) space.
- Two passes computing "previous smaller" and "next smaller" arrays — same idea, easier to explain.

**Common wrong turns**
- Width computed as `i - popped` instead of `i - stack.top - 1` (the left boundary is the element *below* the popped one).
- Forgetting to flush the stack at the end (increasing input like `[1, 2, 3]`).
- Equal heights: popping on `>=` vs `>` — both work if the width logic is right, but candidates often get one of them wrong.
- 32-bit overflow: 10^5 * 10^5 = 10^10.

**Hint ladder**
1. Suppose the rectangle's height is exactly `heights[i]`. How far left and right can it extend?
2. Can you find the nearest shorter bar to the left and right of every bar in O(n) overall?
3. A stack of increasing heights tells you both: when a bar gets popped, the bar causing the pop is its right limit and the one beneath it is its left limit.

**Follow-ups**
- Maximal Rectangle in a binary matrix (build histograms row by row, O(rows * cols)).
- Count rectangles, or largest square.
- Prove each index is pushed and popped once.
