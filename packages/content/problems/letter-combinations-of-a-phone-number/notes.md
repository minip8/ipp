**Approaches**
- Backtracking: a fixed-size buffer of length n; position i tries each letter of digits[i] and recurses to i + 1; at depth n emit the buffer. O(n · 4^n) time (output size dominates), O(n) extra space.
- Iterative product: start with [""] and, for each digit, replace the list by every existing prefix extended with each of the digit's letters. Same complexity. Python's `itertools.product` is acceptable if they can explain what it does.

**Common wrong turns**
- Empty input returning `[""]` instead of `[]`.
- Mapping table off by one (7 and 9 have four letters; forgetting `s` or `z`).
- Building strings with repeated concatenation in a loop that copies the whole prefix at every level is fine here, but ask about the cost; a mutable buffer avoids it.
- Hard-coding nested loops for a fixed length.

**Hint ladder**
1. If `digits` had one character, what is the answer? Two characters?
2. Every answer is a choice of one letter per position — what search structure enumerates all such choices?
3. Recurse over positions, carrying the prefix built so far; when the prefix is full length, record it.
4. Handle the empty input up front.

**Follow-ups**
- How many results for n digits in the worst case? (4^n when all digits are 7 or 9.)
- Return only combinations that are words in a given dictionary — prune with a trie of the dictionary.
- Return results in lexicographic order without sorting at the end (iterate letters in order).
- Generate them lazily (iterator / generator) to avoid holding all results in memory.
