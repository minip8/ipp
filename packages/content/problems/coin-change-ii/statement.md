You have an unlimited supply of coins of each denomination in `coins`. Return the number of **different combinations** of coins that add up to exactly `amount`.

A combination is a multiset: only how many coins of each denomination you use matters, not the order. So `1 + 2` and `2 + 1` are the same combination. For `amount = 0` there is exactly one combination (use no coins).

Return the count as a 64-bit integer.

**Examples**

```
amount = 5, coins = [1, 2, 5]   ->  4     (5 | 2+2+1 | 2+1+1+1 | 1+1+1+1+1)
amount = 3, coins = [2]         ->  0
amount = 0, coins = [7]         ->  1
```

**Constraints**

- `1 <= coins.length <= 300`
- `1 <= coins[i] <= 5000`; denominations are distinct
- `0 <= amount <= 5000`
- The answer, and every intermediate count of the standard bottom-up solution, is at most `10^15`.
