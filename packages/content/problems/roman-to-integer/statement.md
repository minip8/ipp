Convert a Roman numeral to an integer.

The symbols and their values are:

| Symbol | `I` | `V` | `X` | `L` | `C` | `D` | `M` |
|---|---|---|---|---|---|---|---|
| Value | 1 | 5 | 10 | 50 | 100 | 500 | 1000 |

Symbols are normally written from largest to smallest and their values are added (`LXII` = 50 + 10 + 1 + 1 = 62). Six combinations use **subtraction** instead, where a smaller symbol placed directly before a larger one is subtracted:

`IV` = 4, `IX` = 9, `XL` = 40, `XC` = 90, `CD` = 400, `CM` = 900.

**Examples**

```
s = "VIII"        ->   8
s = "XCIV"        ->   94       XC (90) + IV (4)
s = "MMXXVI"      ->   2026
s = "CDXLIX"      ->   449      CD (400) + XL (40) + IX (9)
```

**Constraints**

- `1 <= s.length <= 15`
- `s` is a valid Roman numeral in standard form representing a value in `[1, 3999]`.
