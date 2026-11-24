Given an integer `n`, return every string made of exactly `n` opening brackets `(` and `n` closing brackets `)` that is **balanced**: reading left to right, the number of `)` seen never exceeds the number of `(` seen, and the totals are equal at the end.

Each string must appear exactly once; the list may be in any order.

**Examples**

```
n = 1   ->   ["()"]
n = 2   ->   ["(())", "()()"]
n = 3   ->   ["((()))", "(()())", "(())()", "()(())", "()()()"]
```

**Constraints**

- `1 <= n <= 9`
