A row of `n` balloons carries numbers `nums[0..n-1]`. You burst all of them, one at a time, in an order you choose.

When you burst a balloon, you earn `left * value * right` coins, where `value` is that balloon's number and `left` / `right` are the numbers of its **current** neighbours — the nearest balloons on each side that have not been burst yet. If there is no such balloon on a side, use `1` for that side. After a balloon is burst, its former neighbours become adjacent.

Return the maximum total number of coins you can earn.

**Examples**

```
nums = [4, 1, 6, 2]   ->  84
    burst 1:  4 * 1 * 6 = 24     row is now [4, 6, 2]
    burst 6:  4 * 6 * 2 = 48     row is now [4, 2]
    burst 2:  4 * 2 * 1 = 8      row is now [4]
    burst 4:  1 * 4 * 1 = 4      total 84; no order earns more

nums = [1, 5]   ->  10     (burst 1 for 1*1*5 = 5, then 5 for 1*5*1 = 5)
nums = [7]      ->  7
```

**Constraints**

- `1 <= n <= 200`
- `0 <= nums[i] <= 100`
