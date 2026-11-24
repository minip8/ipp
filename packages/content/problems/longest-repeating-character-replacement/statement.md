`s` consists of uppercase English letters. You may change **at most `k`** characters of `s` into any other uppercase letters. Return the length of the longest substring that can be made to consist of a **single repeated letter**.

**Examples**

```
s = "ABAB", k = 2         ->   4      change both B's (or both A's)
s = "AABABBA", k = 1      ->   4      "AABA" -> "AAAA" (changing "BABB" -> "BBBB" also gives 4)
s = "XYZ", k = 0          ->   1
```

**Constraints**

- `1 <= s.length <= 10^5`
- `0 <= k <= s.length`
