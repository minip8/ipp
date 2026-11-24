Return the minimum number of single-character edits needed to turn `word1` into `word2`. Each edit is one of:

- **insert** one character anywhere,
- **delete** one character,
- **replace** one character with a different character.

**Examples**

```
word1 = "sunday",  word2 = "saturday"   ->  3     (insert 'a', insert 't', replace 'n' with 'r')
word1 = "flaw",    word2 = "lawn"       ->  2     (delete 'f', insert 'n')
word1 = "",        word2 = "abc"        ->  3
```

**Constraints**

- `0 <= word1.length, word2.length <= 500`
- Both strings consist of lowercase English letters.
