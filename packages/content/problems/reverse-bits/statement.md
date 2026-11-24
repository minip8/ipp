Treat `n` as an **unsigned 32-bit** integer. Reverse the order of its 32 bits (bit 0 swaps with bit 31, bit 1 with bit 30, and so on) and return the resulting unsigned 32-bit value.

`n` is passed and returned as a 64-bit integer (`long`) so that every unsigned 32-bit value can be represented; the answer is always in `[0, 2^32 - 1]`.

**Examples**

```
n = 1            ->   2147483648    0...0001  becomes  1000...0
n = 6            ->   1610612736    ...0110   becomes  0110...0  (bits 29 and 30 set)
n = 4294967295   ->   4294967295    all 32 bits set
```

**Constraints**

- `0 <= n <= 2^32 - 1`
