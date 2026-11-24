Compute `x` raised to the integer power `n` (`x^n`). Do not call a library power function (`pow`, `**`, `Math.pow`, ...).

`n` may be negative (`x^-n = 1 / x^n`) and may be as large as `2^31 - 1` or as small as `-2^31` in magnitude, so multiplying `x` by itself `n` times is too slow.

Answers are accepted within an absolute or relative error of `1e-6`.

**Examples**

```
x = 2.0,  n = 10       ->   1024.0
x = 2.1,  n = 3        ->   9.261
x = 2.0,  n = -2       ->   0.25
x = -1.0, n = -2147483648  ->   1.0
```

**Constraints**

- `-100.0 < x < 100.0`
- `-2^31 <= n <= 2^31 - 1`
- Either `x != 0` or `n > 0`.
- The true answer has absolute value at most `10^4`.
