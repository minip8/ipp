**Approaches**
- Expected: DFS/backtracking from every cell that matches word[0]. `dfs(r, c, i)` checks bounds and `board[r][c] == word[i]`, marks the cell as visited, recurses into the four neighbours with i + 1, then unmarks. O(R·C·3^L) time in the worst case (after the first step each cell has at most 3 unvisited neighbours), O(L) recursion depth.
- Marking: a separate `visited` grid, or overwrite the board cell with a sentinel (`'#'`) and restore it — in-place marking is what most strong candidates do. In this problem's signature `board` is an array of strings; in C++ copying into a `vector<string>` and mutating is natural; in Python convert to a list of lists.
- Pruning that makes the worst case fast:
  - If `word` is longer than R·C, or the board does not contain enough of some letter of `word` (letter counts), return false immediately.
  - If the last letter of `word` is rarer on the board than the first, search for the reversed word instead — fewer starting points.

**Common wrong turns**
- Forgetting to unmark on the way back, so a failed branch blocks a later successful one.
- Marking visited globally rather than per path (e.g., a visited set never cleared).
- Checking `i == len(word)` after the bounds check rather than before (off-by-one on the last letter at the edge of the board).
- Allowing diagonal moves, or allowing the same cell twice ("TODO" on the example board).
- BFS instead of DFS: BFS cannot track a per-path visited set cheaply.

**Hint ladder**
1. From a given starting cell, what decision do you make at each letter?
2. Explore paths depth-first; what must you remember so the path does not reuse a cell?
3. Mark the current cell before recursing into neighbours and unmark it when you return — that keeps "visited" per path.
4. Short-circuit: stop as soon as any branch succeeds; and consider cheap global checks (letter counts) before searching.

**Follow-ups**
- Search for many words at once (Word Search II — build a trie of the words).
- Worst-case inputs: a board full of 'A' and a word "AAAA…AB". How do the frequency check and the reverse trick help?
- Allow diagonal moves; allow reusing cells (then it becomes a DP over (cell, index)).
- Iterative version with an explicit stack.
