**Approaches**
- Baseline: run the single-word search (Word Search I) for each word. O(W · R·C · 3^L). With thousands of words that share prefixes, it repeats the same exploration over and over; on the larger tests it times out, especially in Python.
- Expected: build a trie of all words, then DFS once from every cell, walking the trie in lockstep with the grid. A path is abandoned as soon as its letters are not a prefix of any word. When a node marks a word, record it and clear the mark (so it is reported once). O(R·C · 4·3^(L−1)) worst case for the search plus O(total word length) to build the trie.
- Important optimisations (expected from strong candidates):
  - Store the full word in its terminal node instead of carrying a string builder along the path.
  - **Prune** the trie: after visiting a child, if it has no children left and no word, delete it from its parent. Once every word under a branch has been found, the DFS stops entering that branch. This is what keeps boards full of the same letter fast.
  - Mark visited cells in place (`'#'`) and restore them.
- Optional: drop words longer than R·C or with letters the board does not contain before building the trie.

**Common wrong turns**
- Reporting a word several times (found from multiple starting cells) — must clear the terminal mark or use a set.
- Stopping the DFS at a word's terminal node: a longer word may continue through it ("cat" and "cats").
- Building a trie but starting a separate DFS per word anyway.
- Forgetting to restore the cell after the DFS (some later words are never found).
- Python recursion is fine here (depth ≤ 10); C++ copying strings on each recursive call is a needless cost.

**Hint ladder**
1. What does running Word Search I once per word repeat unnecessarily when words share prefixes?
2. Which data structure lets you ask "is the path so far a prefix of any word?" in O(1) per step?
3. DFS from every cell while descending a trie of the words; stop when the next letter has no trie edge; record a word when you reach its end node.
4. Avoid duplicates by clearing the word from the node once found, and prune trie nodes that become empty so later searches skip them.

**Follow-ups**
- Complexity: how do the trie size and pruning bound the work? What input makes it slow without pruning? (A board of one letter and words like "aaaa…ab".)
- The dictionary is fixed and huge, boards arrive continuously (Boggle server): what do you precompute?
- Allow diagonal moves (Boggle rules) — what changes?
- Parallelise across starting cells — what about the shared trie mutations used for pruning?
