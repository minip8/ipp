Count the number of ways to pick characters of `s` so that, read in their original order, they spell exactly `t`.

Formally, return the number of increasing index sequences `i1 < i2 < ... < ik` (where `k = t.length`) with `s[i1] s[i2] ... s[ik] == t`. Two ways are different if they use a different set of positions in `s`, even if the characters are the same.

**Examples**

```
s = "banana", t = "ban"   ->  3
    positions (0,1,2), (0,1,4), (0,3,4)   ->   b-a-n using b at 0, an 'a', then a later 'n'

s = "aaa", t = "aa"       ->  3     (positions (0,1), (0,2), (1,2))
s = "abc", t = "abcd"     ->  0
```

**Constraints**

- `1 <= s.length, t.length <= 1000`
- `s` and `t` consist of lowercase English letters.
- The **answer** fits in a signed 32-bit integer. Intermediate counts for prefixes of `t` can be much larger — plan for that.
