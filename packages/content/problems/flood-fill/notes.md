**Approaches**
- BFS or iterative DFS from `(sr, sc)`, recolouring as you visit; the new colour doubles as the visited mark. O(rows * cols) time and space.
- Recursive DFS is the textbook answer and is fine for small grids, but a 300x300 single-colour region (or a snake-shaped one) recurses ~90 000 deep: Python's recursion limit fails and C++ may overflow the stack. A hidden test has a large snake region.

**Common wrong turns**
- `color == original colour`: without an early return, using the colour as the visited mark loops forever (the classic bug). A hidden test covers it.
- Including diagonal neighbours.
- Off-by-one bounds checks, mixing up rows and columns on non-square images.
- Comparing neighbours to the *current* pixel's colour after it was already repainted, rather than to the original colour.

**Hint ladder**
1. Which pixels change? Describe them in terms of the start pixel's colour and adjacency.
2. This is "find the connected component containing (sr, sc)" in a grid graph.
3. Visit from the start with a stack or queue; only step to in-bounds neighbours with the original colour.
4. What happens if the new colour equals the original colour? How do you avoid revisiting?

**Follow-ups**
- Avoid recursion depth problems (explicit stack / BFS).
- 8-directional fill; fill with a tolerance (|c - original| <= t).
- Very large images that do not fit in memory: scanline fill processes runs of a row at a time.
- Count the number of distinct regions (number of islands generalisation).
