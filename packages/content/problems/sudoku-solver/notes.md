**Approaches**
- Naive backtracking: walk cells in reading order, try digits 1–9, check the row/column/box by scanning (27 reads), recurse, undo. Correct, and fine for typical newspaper puzzles, but some tests here are minimal puzzles relabelled so the first row of the solution is 9 8 7 … 1; naive search explores ~10^6+ digit trials on those. In C++ that can still pass; in Python it will likely time out.
- Better bookkeeping: three arrays of bitmasks (or 9x9 boolean tables) for digits used in each row, column and box, making the "is d allowed here" check O(1). Undo by clearing the bit.
- Expected for a strong answer: also choose the next cell by **minimum remaining values** — the empty cell with the fewest allowed digits (popcount of `~(row|col|box) & 0x1FF`). A cell with 0 candidates means backtrack immediately; with 1 it is forced. With MRV every test here solves in a few milliseconds even in Python.
- Beyond: constraint propagation (naked/hidden singles), or Knuth's Algorithm X / dancing links on the exact-cover formulation — great discussion, not needed.

**Common wrong turns**
- Box index: `(r / 3) * 3 + c / 3`. Writing `r / 3 + c / 3` or `r % 3 ...` is a classic bug.
- Not restoring the cell / masks on backtrack, or restoring only on failure in one branch.
- Continuing to search after the solution is found (the recursion must propagate success upward), which then overwrites the solved cells while unwinding.
- Python: strings are immutable; must convert the board to a list of lists first and join at the end.
- Treating the input as mutable and returning nothing — this signature returns the solved grid.

**Hint ladder**
1. Start with the simplest search: find an empty cell, try each digit that does not clash, recurse, undo. What is the cost of the "does it clash" check?
2. Can you make the clash check O(1) by remembering which digits each row, column and box already uses?
3. The order in which you fill cells matters enormously. Which empty cell is the best one to fill next?
4. Always branch on the empty cell with the fewest legal digits; if some cell has none, backtrack right away.

**Follow-ups**
- Generate a puzzle with a unique solution (fill a grid randomly, remove clues while a solution counter stops at 2).
- Count solutions / detect that a puzzle has none or several.
- Generalise to n^2 x n^2 boards (16x16): which parts of your solution change?
- Exact cover and dancing links: how would you model Sudoku as 324 constraints?
