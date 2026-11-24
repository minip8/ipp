Two non-negative integers are given as binary strings `a` and `b`. Return their sum, also as a binary string.

The inputs have no leading zeros except for the number zero itself (`"0"`), and your answer must follow the same rule.

The strings can be thousands of digits long, so converting them to a built-in integer type is not a general solution — add them digit by digit.

**Examples**

```
a = "1011",  b = "110"     ->   "10001"     11 + 6 = 17
a = "0",     b = "0"       ->   "0"
a = "1111",  b = "1"       ->   "10000"     the carry ripples all the way out
```

**Constraints**

- `1 <= a.length, b.length <= 10^4`
- `a` and `b` contain only `'0'` and `'1'`, with no leading zeros except `"0"` itself.
