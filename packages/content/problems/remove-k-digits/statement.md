`num` is a non-negative integer written as a string of decimal digits. Delete exactly `k` of its digits (the remaining digits keep their order) so that the resulting number is as **small as possible**. Return that number as a string.

The result must not have leading zeros; if nothing (or only zeros) remains, return `"0"`.

**Examples**

```
num = "4352", k = 1        ->   "352"       other choices: "452", "432", "435"
num = "10200", k = 1       ->   "200"       "0200" without the leading zero
num = "10", k = 2          ->   "0"         everything removed
num = "112", k = 1         ->   "11"
```

**Constraints**

- `1 <= k <= num.length <= 10^5`
- `num` contains only digits and has no leading zeros, except that `num` may be `"0"` itself.
