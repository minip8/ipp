Return every index `i` such that the substring of `s` starting at `i` with length `p.length` is an **anagram** of `p` (uses exactly the same letters with the same counts, in any order).

Return the indices in **increasing order**. If there are none, return an empty list.

**Examples**

```
s = "cbaebabacd", p = "abc"    ->   [0, 6]       "cba" at 0, "bac" at 6
s = "abab",       p = "ab"     ->   [0, 1, 2]    windows overlap
s = "aa",         p = "aaa"    ->   []           p is longer than s
```

**Constraints**

- `1 <= s.length, p.length <= 10^5`
- `s` and `p` contain only lowercase English letters.
