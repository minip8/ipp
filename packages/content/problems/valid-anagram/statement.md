Return `true` if `t` is an **anagram** of `s` — that is, `t` uses exactly the same characters as `s`, each the same number of times, possibly in a different order. Otherwise return `false`.

**Examples**

```
s = "listen",  t = "silent"    ->   true
s = "rat",     t = "tar"       ->   true
s = "aab",     t = "abb"       ->   false     same letters, different counts
s = "ab",      t = "abc"       ->   false
```

**Constraints**

- `1 <= s.length, t.length <= 5 * 10^4`
- `s` and `t` consist of lowercase English letters.
