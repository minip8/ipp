**Approaches**
- Key formula: water above `i` = `min(maxLeft[i], maxRight[i]) - height[i]`, where the maxima include `i` itself.
- Brute force: compute both maxima by scanning for every `i`. O(n^2).
- Prefix/suffix maxima arrays: O(n) time, O(n) space. A very good answer.
- Expected optimal: two pointers. Keep `leftMax`/`rightMax`; move the side with the smaller current max inward, because that side's water level is already determined by its own max (the other side has something at least as tall). O(n) time, O(1) space.
- Monotonic stack: pop bars lower than the current one, adding water in horizontal layers. O(n) — a different decomposition worth knowing.

**Common wrong turns**
- Confusing this with Container With Most Water.
- Two pointers moving the wrong side, or comparing `height[l]` and `height[r]` while updating the maxima in the wrong order.
- 32-bit overflow: 2 * 10^5 positions * 10^5 height ~ 2 * 10^10.
- Subtracting before updating the running max (negative water).

**Hint ladder**
1. Focus on a single position. What decides how high water can stand above it?
2. Can you precompute the tallest bar to the left and to the right of every position?
3. You only need the smaller of the two maxima. If the left max is smaller than the right max, is the left position's water already known? Use that to walk two pointers inward with O(1) memory.

**Follow-ups**
- Trapping Rain Water II (2D height map): min-heap from the border inward — Dijkstra-like.
- Streaming input from left to right with limited memory.
- Return the water at each position, or the largest single pool.
