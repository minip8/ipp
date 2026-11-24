**Approaches**
- Brute force: every substring, check `length - maxFrequency <= k`. O(n^2 * 26) or O(n^2) with incremental counts.
- Per-letter sliding window: for each of the 26 letters, the longest window with at most k *other* letters (classic "at most k zeros" window). O(26 n).
- Expected: one sliding window with 26 counts and the running maximum frequency `maxf` seen in any window. Expand right; while `windowLength - maxf > k`, shrink left. Answer = max window length. O(n) time, O(26) space.
- The subtle point (great discussion): `maxf` is never decreased when shrinking. That's safe because the answer only improves when a window with a *larger* `maxf` appears; a stale `maxf` can only keep the window from shrinking too much, never produce a length larger than an achievable one. Alternatively recompute `max(counts)` (O(26)) each step.

**Common wrong turns**
- Thinking the window must consist of the first character's letter, or always the most frequent letter overall.
- Using `if` vs `while` for shrinking — with the non-decreasing `maxf` trick a single `if` suffices (the window slides rather than shrinks); candidates should explain whichever they use.
- k = 0 or k >= n.

**Hint ladder**
1. For a fixed substring, how many changes does it need to become one letter?
2. If a window is valid, which windows inside it are valid? What does that suggest?
3. Keep letter counts in a sliding window; the window is valid while `length - (count of its most frequent letter) <= k`.

**Follow-ups**
- Binary version: longest run of 1s after flipping at most k zeros (Max Consecutive Ones III).
- Return the substring and which letter to use.
- Lowercase + uppercase + digits (larger alphabet): what changes?
