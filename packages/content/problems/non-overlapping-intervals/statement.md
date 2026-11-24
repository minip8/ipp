Each element of `intervals` is `[start, end]` with `start < end`, describing a booking from `start` up to `end`. Two bookings conflict if they share any time; bookings that merely touch (`[1, 3]` and `[3, 5]`) do **not** conflict.

Return the **minimum number of intervals to remove** so that the remaining ones are pairwise non-conflicting.

**Examples**

```
intervals = [[1, 3], [2, 4], [3, 5], [1, 5]]   ->   2     keep [1, 3] and [3, 5]
intervals = [[1, 2], [1, 2], [1, 2]]           ->   2
intervals = [[1, 2], [2, 3]]                   ->   0     touching is fine
```

**Constraints**

- `1 <= intervals.length <= 10^5`
- `-5 * 10^4 <= start < end <= 5 * 10^4`
