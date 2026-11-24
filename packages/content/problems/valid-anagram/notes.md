**Approaches**
- Sort both strings and compare: O(n log n) time, O(n) space (or O(1) if sorting in place is allowed).
- Expected: count characters. One array of 26 counters: increment for `s`, decrement for `t`, check all zero (or a hash map for a general alphabet). Early exit if lengths differ. O(n) time, O(1) space for a fixed alphabet.

**Common wrong turns**
- Comparing character *sets* (ignores counts: `"aab"` vs `"abb"`).
- Forgetting the length check when only checking that every character of `t` appears in `s`.
- Repeatedly calling `t.count(c)` for each character — O(26 n) is fine, but `s.count(c)` for each character *of s* is O(n^2).

**Hint ladder**
1. What has to be identical about two strings for one to be a rearrangement of the other?
2. Can you summarise a string by something that ignores order but keeps multiplicity?
3. Count occurrences of each letter in both (or add for one and subtract for the other) and compare.

**Follow-ups**
- Unicode input: hash map instead of a 26-array; what about combining characters / normalisation?
- Many queries against one fixed string; streaming characters.
- Group a list of words into anagram classes (Group Anagrams).
