**Approaches**
- Brute force over all placements of n queens in n^2 squares, or all n^n "one queen per row" assignments, then filter. n^n = 3.9·10^8 for n = 9 — too slow; good to quantify.
- Expected: backtracking row by row. Exactly one queen per row, so recurse on the row; for each column check that the column, the `r - c` diagonal and the `r + c` anti-diagonal are free (three boolean arrays/sets of size n, 2n−1, 2n−1 → O(1) check). Mark, recurse, unmark. The search tree is roughly O(n!) and in practice far smaller; output is O(S · n^2) for S solutions (352 for n = 9).
- Bitmask variant: `cols`, `d1`, `d2` as bit masks shifted per row; `avail = ~(cols | d1 | d2) & full`, iterate lowest set bits. The fastest; a good C++ discussion.

**Common wrong turns**
- Checking conflicts by scanning the whole board each time (O(n^2) per check — correct but slow, and easy to get wrong).
- Diagonal indices: using `r - c` without an offset of n − 1 when indexing an array (negative index; in Python that silently wraps around!).
- Forgetting to unmark the column/diagonals after recursion.
- Building the output board strings once and mutating them (aliasing in Python).
- Deduplicating symmetric boards — the problem asks for all of them.

**Hint ladder**
1. Since queens attack along rows, how many queens can each row hold? Use that to structure the search.
2. Place one queen per row, top to bottom. What do you need to know to decide quickly whether column c in row r is safe?
3. Cells on the same diagonal share `r - c`; on the same anti-diagonal they share `r + c`. Keep a set (or boolean array) for columns and for each diagonal family.
4. Mark the three sets when placing, recurse to the next row, and unmark afterwards; when all rows are filled, render the board.

**Follow-ups**
- Return only the number of solutions (N-Queens II). Use the bitmask version for n up to ~14–15.
- Exploit symmetry: count only first-row columns < n/2 and double (careful with odd n).
- Find one solution for n = 1000 (backtracking dies; there are constructive formulas, or min-conflicts local search).
- What is the time complexity, honestly? (Discuss why O(n!) is an upper bound and how pruning helps.)
