Decide whether a string reads the same forwards and backwards once you **ignore everything that is not a letter or a digit** and **ignore letter case**.

Return `true` if it does, `false` otherwise. A string with no letters or digits at all counts as a palindrome.

**Examples**

```
s = "Step on no pets!"          ->   true     "steponnopets"
s = "Top spot? No: pots."       ->   false    "topspotnopots" is not symmetric
s = "8a,  A8"                   ->   true     "8aa8"
s = " .,!"                      ->   true     nothing left to compare
```

**Constraints**

- `1 <= s.length <= 2 * 10^5`
- `s` consists of printable ASCII characters (codes 32 to 126).
- Letters are `a`-`z` and `A`-`Z`; digits are `0`-`9`. Digits are not case-folded: `"0P"` is not a palindrome.
