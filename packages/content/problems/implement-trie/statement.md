Implement a **trie** (prefix tree): a set of words that can also answer "does any stored word start with this prefix?" quickly.

- `Trie()` creates an empty set.
- `insert(word)` adds `word` to the set. Inserting a word that is already present has no effect.
- `search(word)` returns `true` if `word` itself was inserted earlier, `false` otherwise. Being a prefix of an inserted word is not enough.
- `startsWith(prefix)` returns `true` if at least one inserted word begins with `prefix` (a word counts as a prefix of itself), `false` otherwise.

Each operation should take time proportional to the length of its argument, independent of how many words are stored.

**Example**

```
Trie t
t.insert("card")
t.search("car")        -> false   "car" was never inserted
t.startsWith("car")    -> true    "card" starts with "car"
t.insert("car")
t.search("car")        -> true
t.startsWith("cart")   -> false
t.search("card")       -> true
t.startsWith("card")   -> true    a word is a prefix of itself
```

**Constraints**

- `1 <= word.length, prefix.length <= 50`
- Words and prefixes contain only lowercase English letters.
- At most `3 * 10^4` calls in total per test.
