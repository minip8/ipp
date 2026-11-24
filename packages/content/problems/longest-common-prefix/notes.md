**Approaches**
- Vertical scan: compare column `j` across all words, stop at the first mismatch or the end of the shortest word. O(S) where S is the total number of characters examined (at most the sum of lengths), O(1) extra.
- Horizontal: start with `words[0]` and shrink it against each word in turn. Same worst case, simpler code.
- Sort the words and compare only the first and last (lexicographically extreme) ones. O(S log n) because of the sort, but a nice insight.
- Divide and conquer / binary search on the prefix length — mention as alternatives; a trie is overkill here.

**Common wrong turns**
- Indexing past the end of a shorter word (C++ out-of-bounds, Python IndexError) — `["ab", "a"]`.
- Forgetting the empty-word case, or a single-word input (answer is the word itself).
- Building the prefix with repeated string concatenation in a language where that's quadratic.

**Hint ladder**
1. What is the longest the answer could possibly be?
2. Check the first character of all words, then the second... when do you stop?
3. Stop at the first column where a word ends or a character differs; return everything before it.

**Follow-ups**
- Many queries "longest common prefix of words i..j" over a fixed list (trie, or sort + LCP array).
- What if the words arrive as a stream and you must keep the answer current?
- Compare the cost of vertical vs horizontal scanning when one word is very short.
