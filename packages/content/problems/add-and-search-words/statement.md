Design a dictionary of words that supports lookups where some letters are unknown.

- `WordDictionary()` creates an empty dictionary.
- `addWord(word)` adds `word` (lowercase letters only). Adding a word twice has no extra effect.
- `search(pattern)` returns `true` if some word in the dictionary **matches** `pattern`, otherwise `false`. A pattern consists of lowercase letters and `'.'` characters. A word matches when it has exactly the same length as the pattern and, at every position, the pattern's character is either `'.'` (matches any single letter) or equal to the word's letter.

**Example**

```
WordDictionary d
d.addWord("bad")
d.addWord("dad")
d.addWord("mad")
d.search("pad")    -> false
d.search("bad")    -> true
d.search(".ad")    -> true     matches bad, dad, mad
d.search("b..")    -> true     matches bad
d.search("b.")     -> false    no two-letter words
d.search("...")    -> true
d.search("bad.")   -> false    lengths must be equal
```

**Constraints**

- `1 <= word.length, pattern.length <= 25`
- `word` contains only lowercase English letters; `pattern` contains lowercase letters and at most 3 `'.'` characters.
- At most `2 * 10^4` calls in total per test.
