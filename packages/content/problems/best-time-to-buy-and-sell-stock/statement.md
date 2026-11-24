You are given the closing price of a single stock for each of `n` consecutive days: `prices[i]` is the price on day `i`.

You may make **at most one trade**: buy one share on some day and sell it on a **strictly later** day. Return the largest profit you can make. If no trade makes money, return `0` (you simply don't trade).

**Examples**

```
prices = [8, 3, 6, 1, 5, 4]   ->   4      buy at 1 (day 3), sell at 5 (day 4)
prices = [9, 7, 4, 2]         ->   0      the price only falls
prices = [2, 9, 1, 3]         ->   7      buy at 2, sell at 9; the later low of 1 doesn't help
```

**Constraints**

- `1 <= prices.length <= 10^5`
- `0 <= prices[i] <= 10^4`
