**Approaches**
- Words are vertices, one-letter differences are edges, answer = BFS distance + 1.
- Naive edge discovery: compare every pair of words. O(N^2 * L) — with N = 5000, L = 10 that is 2.5 * 10^8 character comparisons; the large hidden tests make this too slow in Python and slow in C++.
- Expected (option A): generate neighbours on the fly: for each position, try all 26 letters and look the result up in a hash set of unvisited words, removing words as they are visited. O(N * L * 26) lookups, each O(L) to hash. ~1.3 * 10^6 lookups here.
- Expected (option B): wildcard buckets: map each pattern like `c*ld` to the words matching it; neighbours share a bucket. O(N * L^2) to build. Clear a bucket after it is expanded once, otherwise dense buckets make BFS quadratic (a hidden test has a dense star of words that share patterns).
- Bidirectional BFS (expand the smaller frontier) is the strong follow-up / optimisation; same worst case, much faster in practice.

**Common wrong turns**
- Returning the number of transformations (edges) instead of words, or 0 vs. 1 confusion.
- Forgetting `endWord` must be in the list (return 0 immediately if not).
- DFS / backtracking to find the shortest ladder: exponential.
- Marking visited on dequeue instead of enqueue, so the same word is enqueued many times (can blow up on dense graphs).
- Not removing a wildcard bucket after expanding it (quadratic on dense buckets).
- Requiring `beginWord` to be in the list.

**Hint ladder**
1. Model the problem as a graph. What are the vertices and when are two connected?
2. You want the fewest steps in an unweighted graph — which search?
3. Comparing every pair of words to build edges is expensive. For a word of length L, how many candidate neighbours exist if you change one letter at a time?
4. BFS from `beginWord`; to expand a word, try each position x each letter and check membership in a set of not-yet-visited list words.

**Follow-ups**
- Return all shortest ladders (Word Ladder II: BFS layers + backtracking over a parent DAG).
- Bidirectional BFS: why does it help, and when does it not?
- Words of different lengths with insert/delete edits allowed.
- Dictionary of millions of words: precomputed pattern index on disk.
