**Approaches**
- Filter + reverse: build the cleaned lowercase string, compare with its reverse. O(n) time, O(n) extra space. Acceptable first answer.
- Expected: two pointers from both ends, skipping non-alphanumerics, comparing lowercased characters. O(n) time, O(1) extra space.

**Common wrong turns**
- Pointers crossing while skipping: the inner skip loops must also check `left < right`, or an all-punctuation string reads out of bounds.
- Treating digits case-insensitively or using a "letter-only" check, so `"0P"` or `"a1a"` misbehave.
- In C++, calling `isalnum`/`tolower` on a negative `char` is UB; cast to `unsigned char` (input here is ASCII, but it's a good thing to mention).
- Using a locale- or Unicode-aware lowercasing in Python is fine here, but ask what would change with Unicode input.

**Hint ladder**
1. Which characters actually matter for the comparison?
2. Can you compare the first relevant character with the last relevant one without building a new string?
3. Two indices moving inward; each skips characters that don't count before comparing.

**Follow-ups**
- "Valid Palindrome II": may delete at most one character — on the first mismatch try skipping either side (O(n)).
- Unicode / grapheme clusters: what breaks?
- Streaming input where you can't index from the end — what would you need to store?
