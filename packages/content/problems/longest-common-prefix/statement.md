Return the longest string that is a prefix of **every** string in `words`. If the strings share no common prefix, return the empty string `""`.

**Examples**

```
words = ["interview", "internet", "interval"]   ->   "inter"
words = ["cpp", "python", "java"]               ->   ""
words = ["same", "same"]                        ->   "same"
words = ["ab", "", "abc"]                       ->   ""      an empty word has only the empty prefix
```

**Constraints**

- `1 <= words.length <= 2000`
- `0 <= words[i].length <= 1000`
- Words contain only lowercase English letters.
