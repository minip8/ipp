**Approaches**
- Brute force: enumerate subsequences of the shorter string and test each against the other. O(2^n * m).
- Plain recursion on (i, j) with the two-branch skip is exponential; memoise it.
- Expected: `L[i][j]` = LCS of the prefixes of length i and j. If `text1[i-1] == text2[j-1]` then `L[i-1][j-1] + 1`, else `max(L[i-1][j], L[i][j-1])`. O(n*m) time; O(min(n, m)) space with two rows (or one row and a saved diagonal).

**Common wrong turns**
- Confusing subsequence with substring (contiguous): the substring recurrence resets to 0 on mismatch.
- On a match, also taking max with the skip branches is harmless; but on a mismatch, adding 1 or using the diagonal is wrong.
- Greedy matching (scan text1 and take each character's first match in text2) fails: `"abcd"` / `"bcda"` -> greedy from 'a' gives 1, answer 3.
- One-row optimisation that overwrites the diagonal value before it is read.
- Recursion depth: top-down memo with n = m = 1000 can recurse 2000 deep (fine in C++, needs a raised limit in Python).

**Hint ladder**
1. Compare the last characters of the two strings. What can you conclude if they are equal? If they differ?
2. If they differ, at least one of the two last characters is not in the answer. That leaves two smaller subproblems.
3. Fill a table over prefix lengths (i, j); each cell depends on its left, upper and upper-left neighbours.
4. To save memory, keep only the previous row (and remember the diagonal before overwriting it).

**Follow-ups**
- Reconstruct one LCS string (walk back through the table).
- Relationship to edit distance with only insertions and deletions: `n + m - 2*LCS`.
- Diff tools (Myers' O((n+m)D) algorithm) and Hunt-Szymanski for sparse matches.
- LCS of permutations reduces to LIS: O(n log n).
- Hirschberg's algorithm: reconstruct the string in linear space.
