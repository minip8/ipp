Return the exact decimal representation of the fraction `numerator / denominator` as a string.

- If the fractional part terminates, write it out in full with no trailing zeros, and omit the decimal point entirely if the value is an integer.
- If the fractional part repeats forever, write the non-repeating digits followed by the **shortest repeating block** in parentheses, starting the parentheses as **early** as possible. So 1/6 is `"0.1(6)"` (not `"0.1(66)"` or `"0.16(6)"`).
- Negative results start with `"-"`. Zero is written `"0"` (never `"-0"`).

**Examples**

```
numerator = 1,  denominator = 4     ->   "0.25"
numerator = 4,  denominator = 2     ->   "2"
numerator = 1,  denominator = 6     ->   "0.1(6)"
numerator = -22, denominator = 7    ->   "-3.(142857)"
numerator = 1,  denominator = 333   ->   "0.(003)"
```

**Constraints**

- `-2^31 <= numerator, denominator <= 2^31 - 1`
- `denominator != 0`
- The input is chosen so that the answer has at most `10^5` characters.
