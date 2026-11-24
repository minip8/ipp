**Approaches**
- Baseline: a list (or set grouped by length) of words; `search` compares the pattern against every word of the same length. O(N · L) per search. Grouping by length is a cheap, sensible first improvement.
- Expected: a trie. `addWord` is the usual O(L) insert. `search` walks the trie; on a letter it follows one child, on `'.'` it tries every existing child (DFS). With at most d dots the worst case is O(26^d · L), and in practice far less because only existing children are explored. Must check the end-of-word flag at the end.
- Alternative: on insert, also store every "masked" version of the word (each subset of up to 3 positions replaced by '.') in a hash set; search is then O(L). Insert cost blows up (C(L,≤3) ≈ 2600 variants at L = 25) — a nice trade-off discussion, especially if searches vastly outnumber inserts.

**Common wrong turns**
- Treating `'.'` as "zero or more characters" (it is exactly one).
- Matching prefixes: forgetting the end-of-word check, so "ba" matches after adding "bad".
- In the DFS, returning the result of the first child instead of continuing to the next child when it fails (`return dfs(child)` inside the loop).
- Python: using `re` per word — works on the baseline but is slow and dodges the design question.
- Creating nodes during search.

**Hint ladder**
1. Without wildcards, which structure from earlier problems answers "is this word stored" in O(L)?
2. In a trie, what does a `'.'` at position i mean in terms of which edges you may follow?
3. Search recursively: (node, index) → if the character is a letter follow that child; if it is `'.'` try every child, succeeding if any branch succeeds.
4. At the end of the pattern, succeed only if the node marks the end of a word.

**Follow-ups**
- Support `'*'` (any sequence, possibly empty). How does the search change? (Memoise on (node, index).)
- Huge numbers of searches with few inserts: precompute masked keys; analyse memory.
- Return the number of matching words, or all of them in sorted order.
- Concurrency: many readers, occasional writer.
