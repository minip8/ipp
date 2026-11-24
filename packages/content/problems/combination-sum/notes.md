**Approaches**
- Backtracking with a start index: `go(i, remaining)` tries candidates[j] for j ≥ i, recursing with `go(j, remaining - candidates[j])` (j, not j + 1, because reuse is allowed). Using a non-decreasing index is what prevents permutations of the same multiset. Sort first so the loop can `break` as soon as a candidate exceeds `remaining`. Time is bounded by the number of nodes in the search tree, roughly O(N^(T/m + 1)) for target T and smallest candidate m; output-sensitive in practice.
- Alternative branching: at index i either use candidates[i] once more (stay at i) or move on to i + 1.
- DP over sums storing lists of combinations (unbounded-knapsack style) also works but uses more memory; good discussion point.

**Common wrong turns**
- Restarting the loop from 0 at every level: produces [2,3,2], [3,2,2], ... duplicates; then trying to dedupe with a set of sorted tuples — works but wasteful and misses the point.
- Recursing with j + 1, which forbids reuse.
- Not pruning when remaining < 0 (or without sorting, failing to stop early) — still correct, but slower.
- Python: appending the shared path list instead of a copy.

**Hint ladder**
1. Why does a naive "try every candidate at every step" search produce duplicates?
2. If every combination were written in non-decreasing order of candidate index, would duplicates still be possible?
3. Recurse with a start index: at each step only choose candidates at or after the last one chosen, and allow choosing the same index again.
4. Sort the candidates so you can stop the loop once a candidate is larger than what remains.

**Follow-ups**
- Each candidate may be used at most once and the input can contain duplicates (Combination Sum II): advance to j + 1 and skip equal siblings.
- Only count the combinations (unbounded knapsack count DP, O(N · T)).
- Combinations of exactly k numbers from 1..9 (Combination Sum III).
- What if target were 10^9? The count can explode; discuss output-sensitive bounds.
