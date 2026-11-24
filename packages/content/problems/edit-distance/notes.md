**Approaches**
- Brute force: recursion trying all three edits at each mismatch. Exponential (~3^(n+m)).
- Expected: `D[i][j]` = distance between the first i characters of word1 and the first j of word2. `D[i][0] = i`, `D[0][j] = j`; if the last characters match, `D[i-1][j-1]`; otherwise `1 + min(D[i-1][j] (delete), D[i][j-1] (insert), D[i-1][j-1] (replace))`. O(n*m) time, O(min(n, m)) space with two rows.

**Common wrong turns**
- Wrong base row/column (must be i and j, not 0): the empty-string cases expose it.
- Adding 1 even when the characters match.
- Thinking the answer is `max(n, m) - LCS` or `n + m - 2*LCS`: those are different metrics (replace-only alignment / insert-delete only). `"ab"` vs `"ba"`: `max - LCS` = 1, true distance 2.
- Mixing up which neighbour corresponds to insert vs delete is harmless for the value, but candidates should be able to explain each.
- Rolling-row bugs: the diagonal value is overwritten before use.

**Hint ladder**
1. Focus on the last characters of both words. If they are equal, what can you do with them?
2. If they differ, the last edit touching the end is one of three operations. What smaller problem does each leave?
3. Define a table over prefix lengths and fill it; what are the values when one prefix is empty?
4. Each cell needs its left, top and top-left neighbours; two rows are enough.

**Follow-ups**
- Return the actual sequence of edits.
- Different costs per operation (weighted edit distance).
- Allow swapping two adjacent characters (Damerau-Levenshtein).
- "Is the distance at most k?" in O(n*k) by restricting to a diagonal band; useful for spell checkers.
- Fuzzy search over a large dictionary (BK-trees, tries with DP rows).
