An alien language uses lowercase English letters, but in an unknown alphabetical order. You are given `words`, a list of words from its dictionary, **claimed** to be sorted in the alien order. Ordering between words works as usual: compare letter by letter; the first position where they differ decides; if one word is a prefix of the other, the shorter word comes first.

Deduce an alphabet: a string containing **each letter that appears in `words` exactly once** (and no other letters), in an order consistent with the dictionary.

Usually several alphabets are consistent, so return the one built by this rule: **repeatedly append the smallest (in normal English order) letter that has no remaining constraint saying another unplaced letter must come before it.** (Equivalently: the lexicographically smallest consistent alphabet.)

Return `""` if no alphabet is consistent with the claimed order — that is, if the constraints contain a cycle, or a word is immediately followed by a proper prefix of itself (like `"abc"` before `"ab"`).

**Examples**

```
words = ["wrt","wrf","er","ett","rftt"]   ->  "wertf"
```

From adjacent pairs: `t < f` (wrt / wrf), `w < e` (wrf / er), `r < t` (er / ett), `e < r` (ett / rftt). The only consistent order is w, e, r, t, f.

```
words = ["ba","bc","ac","cab"]           ->  "bac"
```

`a < c` (ba / bc), `b < a` (bc / ac), `a < c` (ac / cab). So b, a, c.

```
words = ["zx","zy","q"]                  ->  "xyzq"
```

Constraints: `x < y` (zx / zy) and `z < q` (zy / q). At first `x` and `z` are free; take `x`. Now `y` and `z` are free; take `y`. Then `z`, then `q`.

```
words = ["abc","ab"]                     ->  ""
```

A word cannot come before its own proper prefix.

Only adjacent words give information: the first differing letter of each adjacent pair yields one constraint; letters after it give none.

**Constraints**

- `1 <= words.length <= 10^4`
- `1 <= words[i].length <= 100`
- total characters across all words `<= 2 * 10^5`
