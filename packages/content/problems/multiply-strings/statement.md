Two non-negative integers are given as decimal strings `num1` and `num2`. Return their product, also as a decimal string.

The numbers can be hundreds of digits long, so you must not convert the inputs to a built-in integer type (and you may not use a big-integer library) — multiply digit by digit.

Inputs have no leading zeros except the number `"0"` itself, and the output must follow the same rule.

**Examples**

```
num1 = "12",  num2 = "34"      ->   "408"
num1 = "999", num2 = "999"     ->   "998001"
num1 = "0",   num2 = "52"      ->   "0"
```

**Constraints**

- `1 <= num1.length, num2.length <= 1000`
- Both strings contain only digits and have no leading zeros (except `"0"`).
