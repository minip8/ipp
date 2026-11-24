**Approaches**
- DP: `dp[j] = min(dp[i] + 1)` over all `i` that can reach `j`. O(n * maxJump) or O(n^2). Fine to state; too slow for the large tests in Python.
- BFS over indices: each "level" is the set of indices reachable with k jumps. Naive BFS with an adjacency scan is O(n * maxJump); the key observation is that every level is a contiguous range of indices.
- Expected: greedy level-by-level BFS in O(n). Keep `currentEnd` (furthest index reachable with the current number of jumps) and `farthest` (furthest reachable with one more). Scan `i` from 0 to n-2: update `farthest = max(farthest, i + nums[i])`; when `i == currentEnd`, take a jump: `jumps += 1`, `currentEnd = farthest`. O(n) time, O(1) space.

**Common wrong turns**
- Greedy "always jump as far as possible from where you are" (jump to `i + nums[i]`) — wrong: `[2, 3, 1, 1, 4]` jumping to index 2 first costs 3 jumps.
- Looping to `n - 1` inclusive and counting an extra jump when already at the end.
- Single-element array must return 0.

**Hint ladder**
1. Think of it as BFS: which indices can you reach with 0 jumps? With 1? With 2?
2. Are those sets of indices contiguous? What two numbers describe each one?
3. Sweep left to right, tracking the end of the current level and the farthest reach of the next; increment the jump count when you pass the end of a level.

**Follow-ups**
- Jump Game I: just decide reachability (track the farthest reachable index).
- Return the actual path.
- Jumps can go backwards too, or with variable costs (becomes a shortest-path problem).
