**Approaches**
- Brute force: DFS from every cell exploring every increasing path without memory. Exponential in the worst case (e.g. a grid whose values grow along both axes, `matrix[i][j] = i + j`, has exponentially many monotone paths).
- Expected: DFS with memoisation. `len(c) = 1 + max(len(nb))` over neighbours with a larger value. Each cell is solved once and looks at 4 neighbours: O(mn) time and space. No `visited` set is needed because strictly increasing edges form a DAG — ask the candidate why.
- Alternative without recursion: topological order. Process cells in decreasing value (sort, O(mn log mn)), or Kahn's algorithm peeling cells with no larger neighbour layer by layer (the number of layers is the answer). Both avoid deep recursion: a snake-shaped path can be 22500 cells long, which overflows Python's default recursion limit and is worth discussing for C++ and Java stacks too.

**Common wrong turns**
- Adding a visited set and backtracking (treating it as a general longest-path search): correct but exponential and unnecessary.
- Allowing equal neighbours (`>=`): this introduces cycles and wrong answers.
- Memoising "longest path starting here" but seeding it from a DFS that was cut short by a visited check — mixing the two gives wrong cached values.
- Only starting from local minima, then forgetting that the memo makes starting everywhere cheap anyway (not wrong, just a distraction).
- Recursion depth on long snakes (Python, Java with default stack).

**Hint ladder**
1. Can an increasing path ever revisit a cell? What does that tell you about the structure of the moves?
2. The longest path starting at a cell depends only on the longest paths starting at its larger neighbours.
3. Cache that value per cell and compute it with DFS from every cell; each cell is computed once.
4. If recursion depth is a concern, process cells from the largest value down (or peel layers like topological sort).

**Follow-ups**
- Return the path itself (store the best next cell).
- Allow diagonal moves, or require each step to increase by exactly 1.
- Count the number of increasing paths (mod 10^9+7) — same DAG DP with sums.
- Very large grids that do not fit in memory; parallelising the layer-peeling version.
