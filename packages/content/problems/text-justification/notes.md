**Approaches**
- Expected: straightforward simulation in two phases per line. (1) Greedy packing: extend the line while `currentLength + 1 + len(next) <= maxWidth`, where currentLength counts one space per gap. (2) Build the line: if it's the last line or has one word, join with single spaces and pad right; otherwise `spaces = maxWidth - letters`, `base, extra = divmod(spaces, gaps)` and the first `extra` gaps get `base + 1`. O(total characters) time.
- There is no clever algorithm here — the question tests careful decomposition, edge cases and clean code. Encourage the candidate to write helpers (`packLine`, `formatLine`) and test small cases by hand.

**Common wrong turns**
- Packing without counting the mandatory single spaces (lines overflow).
- Division by zero for single-word lines (zero gaps).
- Giving the extra spaces to the right-most gaps.
- Fully justifying the last line, or forgetting to pad it.
- Off-by-one when a word exactly fills the remaining width.
- Quadratic string building (repeated concatenation in a loop) — fine at this size but worth noticing.

**Hint ladder**
1. Split the work: deciding which words go on a line, and formatting one line.
2. When packing, how much width does a line with k words of total length L need at minimum?
3. For formatting, compute the total spaces and the number of gaps; use quotient and remainder, and treat "last line" and "one word" as their own case.

**Follow-ups**
- Minimise raggedness instead of greedy packing (Knuth-Plass style DP: minimise sum of squared trailing spaces).
- Hyphenation, or words longer than `maxWidth`.
- Centre-justify; right-justify the last line.
