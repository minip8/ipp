Start from a positive integer `n` and repeatedly replace it with the **sum of the squares of its decimal digits**. If this process eventually reaches `1`, the number is *happy*; if it instead loops forever without reaching `1`, it is not.

Return `true` if `n` is happy, `false` otherwise.

**Examples**

```
n = 7     ->   true     7 -> 49 -> 97 -> 130 -> 10 -> 1
n = 4     ->   false    4 -> 16 -> 37 -> 58 -> 89 -> 145 -> 42 -> 20 -> 4 -> ... (cycle)
n = 1     ->   true
```

**Constraints**

- `1 <= n <= 2^31 - 1`
