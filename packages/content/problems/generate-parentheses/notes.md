**Approaches**
- Generate-and-filter: all 2^(2n) strings, keep the balanced ones. O(2^(2n) · n). Acceptable as a first idea only; at n = 9 that is ~2.6·10^5 strings × 18 checks — survivable in C++, slow in Python, and clearly wasteful.
- Expected: backtracking that only builds valid prefixes. Track `open` and `close` counts; add `(` while open < n, add `)` while close < open. Every leaf is a valid answer, so the work is O(n · C_n) where C_n is the nth Catalan number (≈ 4^n / (n^1.5 √π)).
- Alternative: closure number / DP — every balanced string is `(` A `)` B with A of size k and B of size n − 1 − k. Builds from smaller results; nice to discuss.

**Common wrong turns**
- Allowing `)` whenever close < n (produces invalid strings such as `)(`).
- Generating duplicates by inserting `()` at every position of the n − 1 answers and forgetting to dedupe — and then deduping with a set, which works but hides the inefficiency.
- Building strings by concatenation at every level is fine; mutable buffer is better — ask about the copying cost.

**Hint ladder**
1. Write a function that decides whether a given string is balanced. What running quantity does it track?
2. Instead of filtering finished strings, can you refuse to extend a prefix that can no longer become balanced?
3. A prefix stays valid if you add `(` while you still have some left, or `)` while there are unmatched `(`.
4. Recurse with counts of opened and closed brackets; record the string when both reach n.

**Follow-ups**
- How many answers are there? (Catalan numbers; derive the recurrence C_n = Σ C_k C_{n−1−k}.)
- Multiple bracket types, e.g. `()` and `[]`, properly nested.
- Return the k-th string in lexicographic order without generating the rest (count completions with DP).
- Given a string with some brackets, remove the minimum number to make it valid (Remove Invalid Parentheses).
