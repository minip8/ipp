**Approaches**
- Brute force: for each start, count (or sort) the window and compare with `p`. O((n - m + 1) * m), worst around m = n/2. A hidden test with |s| = 50000 and |p| = 20000 makes that ~6 * 10^8 character operations.
- Expected: fixed-size sliding window with 26 counts. Add the entering character, remove the leaving one, compare the two count arrays (O(26) per step) — O(26 n) total. Or maintain a single `matches` counter of how many of the 26 letters currently agree, making each step O(1).

**Common wrong turns**
- Not handling `len(p) > len(s)` (negative ranges, out-of-bounds).
- Off-by-one when removing the leaving character (window of size m is `[i - m + 1, i]`).
- Using a set of characters (ignores multiplicity).
- Recomputing the window counts from scratch at every position.
- Using a hash map and comparing maps whose zero-count keys weren't deleted (Python `Counter` equality handles zeros in 3.10+, but a plain dict won't).

**Hint ladder**
1. What do all anagram windows have in common with `p`?
2. Every window has the same length. When the window slides by one, how much of its letter count changes?
3. Maintain counts for the current window incrementally and compare with `p`'s counts — can you make the comparison O(1) too?

**Follow-ups**
- Just return whether any permutation of `p` occurs in `s` (early exit).
- Large alphabet (Unicode): hash maps plus a "number of mismatched keys" counter.
- Minimum window containing all letters of `p` (variable-size window, Minimum Window Substring).
