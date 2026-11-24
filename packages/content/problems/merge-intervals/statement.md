Each element of `intervals` is a closed interval `[start, end]` with `start <= end`. Merge every group of intervals that **overlap or touch** into a single interval, and return the resulting non-overlapping intervals **sorted by start**.

Two intervals touch when one ends exactly where the other starts: `[1, 3]` and `[3, 5]` merge into `[1, 5]`. (`[1, 3]` and `[4, 5]` do not touch — they stay separate.)

The input is in no particular order.

**Examples**

```
intervals = [[8, 10], [1, 3], [2, 6], [15, 18]]   ->   [[1, 6], [8, 10], [15, 18]]
intervals = [[1, 4], [4, 5]]                      ->   [[1, 5]]
intervals = [[1, 10], [2, 3], [4, 5]]             ->   [[1, 10]]     contained intervals vanish
intervals = [[5, 5], [1, 2]]                      ->   [[1, 2], [5, 5]]
```

**Constraints**

- `1 <= intervals.length <= 10^4`
- `0 <= start <= end <= 10^6`
