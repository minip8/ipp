**Approaches**
- Baseline: a hash set of words, plus checking every stored word for the prefix. `search` O(L), `startsWith` O(N·L) — fine to mention, but the point is the trie.
- Alternative baseline: a hash set of every prefix of every inserted word. `startsWith` becomes O(L) but `insert` costs O(L^2) and memory explodes. Good discussion.
- Expected: a tree of nodes, each with up to 26 children and an `is_word` flag. All three operations walk the characters: O(L) time. Space O(total characters inserted × alphabet) for array children.
- Children representation trade-offs (a great C++ discussion):
  - `array<Node*, 26>` / `unique_ptr<Node> children[26]` — fastest, 208+ bytes per node on 64-bit.
  - `unordered_map<char, Node*>` or a sorted small vector — less memory for sparse nodes, slower.
  - Pool allocation: all nodes in one `vector<array<int, 26>>` with integer indices — cache friendly, no per-node `new`, trivially destructible; how a performance-minded candidate would do it.
- Ownership in C++: raw `new` without a destructor leaks; `unique_ptr` children recurse in the destructor (deep tries can overflow the stack on destruction — with 50-char words that is fine, but worth knowing). The index-based pool avoids both.

**Common wrong turns**
- `search` returning true at the end of the walk without checking the end-of-word flag (says "car" exists after inserting "card").
- `startsWith` checking the flag (wrongly false for strict prefixes).
- Creating nodes during `search`/`startsWith` (e.g. `children[c]` via `operator[]` on a map, or Python `defaultdict` access) — the trie grows on lookups and later answers may be wrong.
- Forgetting a word is a prefix of itself.

**Hint ladder**
1. Words sharing a prefix share work. How could you store "car", "card" and "care" so the common "car" is stored once?
2. Think of a tree where each edge is a letter and each root-to-node path spells a prefix.
3. What extra information distinguishes "this path is a stored word" from "this path is only a prefix"?
4. `search` and `startsWith` do the same walk and differ only in what they check at the end; neither should create nodes.

**Follow-ups**
- Add `delete(word)`; prune nodes that no longer lead to any word. Add `countWordsStartingWith(prefix)` in O(L) (keep a counter per node).
- Memory: how many nodes for N words of length L in the worst case? How would a compressed trie (radix tree) help?
- Support Unicode / a large alphabet.
- Autocomplete: return the top 3 words by frequency with a given prefix.
- Thread safety for concurrent readers and one writer.
