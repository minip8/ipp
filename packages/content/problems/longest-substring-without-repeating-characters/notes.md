**Approaches**
- Brute force: check every substring for uniqueness, O(n^3), or extend from each start with a set until a repeat, O(n * alphabet) — which is acceptable-ish but not the intended answer.
- Expected: sliding window. Keep `left` and a map from character to its last index. For each `right`, if `s[right]` was last seen at index `>= left`, jump `left` to that index + 1. Answer is the max `right - left + 1`. O(n) time, O(alphabet) space.
- Variant: window with a set, advancing `left` one step at a time while the duplicate is inside — still O(n) amortised.

**Common wrong turns**
- Jumping `left` backwards: on `"abba"` the second `a` was last seen at index 0, which is already left of the window — must take `max(left, last + 1)`.
- Resetting the window entirely on a repeat (`"dvdf"` gives 2 instead of 3).
- Assuming only lowercase letters and using a 26-sized array (spaces and punctuation appear in tests).
- Confusing substring with subsequence.

**Hint ladder**
1. If `s[i..j]` has no repeats, what about `s[i+1..j]`? What does that suggest about how the window moves?
2. When you add a character that's already in the window, which characters must leave?
3. Track the last index of each character so the left edge can jump directly — but never backwards.

**Follow-ups**
- At most k distinct characters (window with counts; shrink while distinct > k).
- Return the substring itself; which one on ties?
- Unicode input: what's a "character"? (code points vs bytes vs grapheme clusters)
