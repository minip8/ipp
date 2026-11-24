You have an unlimited supply of coins of each denomination in `coins`. Return the **smallest number of coins** whose values add up to exactly `amount`.

If no combination of coins makes `amount`, return `-1`. Making `amount = 0` needs zero coins.

**Examples**

```
coins = [1, 5, 6, 9], amount = 11   ->  2     (5 + 6; greedy 9 + 1 + 1 uses 3)
coins = [4, 6], amount = 7          ->  -1    (only even totals are reachable)
coins = [3], amount = 0             ->  0
```

**Constraints**

- `1 <= coins.length <= 12`
- `1 <= coins[i] <= 10^5`; denominations are distinct
- `0 <= amount <= 10^4`
