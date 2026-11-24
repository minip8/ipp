Given a non-negative integer `x`, return the **integer square root** of `x`: the largest integer `r` such that `r * r <= x`.

Do not use a built-in square-root or power function (`sqrt`, `pow`, `**`, `math.isqrt`, ...). Floating-point shortcuts are also not reliable at this input size — work with integers.

**Examples**

```
x = 16             ->   4
x = 27             ->   5          5*5 = 25 <= 27 < 36
x = 0              ->   0
x = 1000000000000  ->   1000000
```

**Constraints**

- `0 <= x <= 2^53 - 1` (passed as a 64-bit integer)
