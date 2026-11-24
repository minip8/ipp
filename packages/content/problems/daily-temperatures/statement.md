`temperatures[i]` is the temperature on day `i`. For each day, find how many days you have to wait until a **strictly warmer** day. If no later day is warmer, use `0`.

Return the array of waits.

**Examples**

```
temperatures = [70, 68, 72, 71, 69, 75]   ->   [2, 1, 3, 2, 1, 0]
temperatures = [50, 50, 50]               ->   [0, 0, 0]     equal is not warmer
temperatures = [30, 40, 50]               ->   [1, 1, 0]
```

**Constraints**

- `1 <= temperatures.length <= 10^5`
- `-50 <= temperatures[i] <= 60`
