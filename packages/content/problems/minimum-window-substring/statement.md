Return the shortest **substring** of `s` that contains every character of `t`, **including duplicates**: if `t` has two `a`s, the window needs at least two `a`s. Other characters may also appear in the window.

If no such substring exists, return the empty string `""`. If several shortest windows exist, return the one that starts **leftmost** (so the answer is unique).

Characters are case-sensitive (`'a'` and `'A'` are different).

**Examples**

```
s = "XADOBECODEBANC", t = "ABC"   ->   "BANC"
s = "aa", t = "aa"                ->   "aa"
s = "a", t = "aa"                 ->   ""         s doesn't have two a's
s = "abcab", t = "ab"             ->   "ab"       "ab" at index 0 and "ab" at index 3; take the leftmost
```

**Constraints**

- `1 <= s.length, t.length <= 10^5`
- `s` and `t` consist of uppercase and lowercase English letters.
