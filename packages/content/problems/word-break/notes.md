**Approaches**
- Brute force: recursively try every dictionary word as a prefix and recurse on the rest. Exponential in the worst case: `s = "aaaa...ab"` with words `a, aa, aaa, ...` explores every composition of the a's before failing.
- Expected: `ok[i]` = the prefix of length i can be segmented. `ok[0] = true`; `ok[i]` is true if some word `w` ends at i with `ok[i - len(w)]` true. Put the words in a hash set and only try lengths up to the longest word: O(n * L) substring checks, each O(L) to hash -> O(n * L^2) with L <= 20. Alternatively loop over words: O(n * W * L).
- Same idea top-down: memoise "can the suffix starting at i be segmented".
- Trie variant: from each reachable start i, walk the trie along `s` and mark every end position. O(n * L) character steps and no substring allocation.
- BFS over start indices is equivalent.

**Common wrong turns**
- Greedy longest (or shortest) match first: `"icecreamcone"` with `ice, icecream, cream, cone` is fine either way, but `"aaab"`-style and `"catsandog"`-style inputs break greedy; e.g. greedy-longest on `s = "abcd"`, words `abc, ab, cd` takes `abc` and gets stuck on `d`.
- Recursion without memoisation (times out on the `aaa...ab` cases).
- Substring checks for every pair (i, j) with j up to n: O(n^2) substrings of up to length n -> O(n^3) when each substring is hashed. Bound by the longest word.
- Off-by-one with `ok` indexed by prefix length vs last index.

**Hint ladder**
1. If you already know the first part of the string splits correctly, what is left to decide?
2. Why does plain recursion blow up on "aaaaaaaaab" with words a, aa, aaa? What is being recomputed?
3. Record, for each prefix length, whether that prefix can be segmented. How does `ok[i]` depend on earlier entries?
4. Only words up to the maximum word length can end at i; use a hash set (or a trie) to test them.

**Follow-ups**
- Return all segmentations (word-break-ii): backtracking with memo; output can be exponential.
- Return the minimum number of words, or the segmentation with the fewest pieces.
- Dictionary is huge and fixed, many queries: trie or Aho-Corasick.
- Streaming input where s arrives character by character.
