Given a non-negative integer `n`, return an array `ans` of length `n + 1` where `ans[i]` is the number of `1` bits in the binary representation of `i`, for every `i` from `0` to `n`.

**Examples**

```
n = 2    ->   [0, 1, 1]               0 = 0b0, 1 = 0b1, 2 = 0b10
n = 6    ->   [0, 1, 1, 2, 1, 2, 2]   e.g. 5 = 0b101 has two ones
```

**Constraints**

- `0 <= n <= 10^5`

Counting bits of each number separately is O(n log n). Can you do it in O(n) total, without a built-in popcount?
