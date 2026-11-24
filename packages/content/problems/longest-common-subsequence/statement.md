Given two strings `text1` and `text2`, return the length of their **longest common subsequence**: the longest string that is a subsequence of both. Return `0` if they share no characters.

A subsequence is obtained by deleting zero or more characters without reordering the rest. For example `"ace"` is a subsequence of `"abcde"`, but `"aec"` is not.

**Examples**

```
text1 = "kitten",  text2 = "sitting"   ->  4     ("ittn")
text1 = "abc",     text2 = "abc"       ->  3
text1 = "abc",     text2 = "xyz"       ->  0
```

**Constraints**

- `1 <= text1.length, text2.length <= 1000`
- Both strings consist of lowercase English letters.
