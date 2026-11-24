**Approaches**
- Expected: scan left to right; if a symbol's value is less than the next symbol's value, subtract it, otherwise add it. O(n) time, O(1) space.
- Equivalent: scan right to left keeping the previous value; subtract when the current value is smaller than the one to its right.
- Table of the 13 tokens (`CM`, `M`, `CD`, ...) with greedy matching of two-character tokens first — also fine.

**Common wrong turns**
- Only handling `IV`/`IX` and forgetting the tens/hundreds pairs.
- Comparing with the *previous* symbol but adding first, then forgetting to subtract twice (`prev < cur` requires `cur - 2*prev` if prev was already added).
- Reading past the end when peeking at `s[i+1]`.

**Hint ladder**
1. When does a symbol's value count negatively?
2. Can you decide the sign of each symbol by looking at just one neighbour?
3. Add or subtract each symbol depending on whether the next symbol is larger.

**Follow-ups**
- The reverse direction: integer to Roman (greedy over the 13 tokens, largest first).
- Validate the input: reject `IIII`, `IL`, `VX`, `MMMM`. What rules would you encode?
- What's the longest numeral in [1, 3999]? (`MMMDCCCLXXXVIII` = 3888, 15 chars.)
