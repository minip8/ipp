**Approaches**
- Brute force: every substring, check coverage with counts. O(n^2 * alphabet) or worse.
- Expected: variable-size sliding window. Count what `t` needs; expand `right`, decrementing needs and tracking how many characters are still missing (or how many distinct characters are fully satisfied). Once nothing is missing, shrink `left` as far as possible while the window stays valid, recording the best window; then continue expanding. O(|s| + |t|) time, O(alphabet) space.
- Optimisation: pre-filter `s` to positions whose characters appear in `t` (helps when `t` is small relative to the alphabet).

**Common wrong turns**
- Ignoring multiplicity (treating `t` as a set).
- Checking validity by comparing full count maps on every step: O(52) per step is fine; recomputing counts from scratch per window is not.
- Tie-breaking: updating the best on `<=` gives the rightmost window; use strict `<` while scanning left to right.
- Returning a window when `t` is longer than `s`, or on the missing-character case.
- Counting "missing" incorrectly when a character's count goes negative (surplus copies shouldn't decrement `missing`).

**Hint ladder**
1. If a window contains all of `t`, does any larger window starting at the same place? What about smaller ones?
2. Grow a window to the right until it's valid; then what can you do from the left?
3. Track how many required characters are still missing so validity is an O(1) check; shrink from the left while valid and record the best.

**Follow-ups**
- Minimum window *subsequence* (characters of `t` in order) — DP or two-pointer backtracking.
- Unicode alphabet: hash maps and the same "missing" counter.
- Streaming `s`: keep only what's needed.
