A message of capital letters was encoded by replacing each letter with its position in the alphabet: `A -> "1"`, `B -> "2"`, ..., `Z -> "26"`, and concatenating the results with no separators.

Given the digit string `s`, return the number of different letter messages that encode to exactly `s`.

Each letter's code is a number from 1 to 26 written **without leading zeros**, so `"05"` or `"0"` is never a valid code on its own. If `s` cannot be decoded at all, return `0`.

**Examples**

```
s = "226"   ->  3     ("BZ" = 2|26, "VF" = 22|6, "BBF" = 2|2|6)
s = "105"   ->  1     ("JE" = 10|5; "1|05" is not allowed)
s = "30"    ->  0     ("30" is too big and "0" is not a code)
```

**Constraints**

- `1 <= s.length <= 100`
- `s` contains only digits and may start with `0`.
- The answer fits in a signed 32-bit integer.
