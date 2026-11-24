Given a string `s`, return every way to cut `s` into consecutive, non-empty pieces such that **every piece is a palindrome** (reads the same forwards and backwards).

Each partition is a list of the pieces in left-to-right order; concatenating them gives back `s`. Every valid partition must appear exactly once. The partitions may be listed in any order, but the pieces inside a partition must be in their original order.

**Examples**

```
s = "abb"    ->   [["a", "b", "b"], ["a", "bb"]]
s = "z"      ->   [["z"]]
s = "abab"   ->   [["a", "b", "a", "b"], ["a", "bab"], ["aba", "b"]]
```

**Constraints**

- `1 <= s.length <= 12`
- `s` contains only lowercase English letters.
