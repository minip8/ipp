`intervals` is a list of closed intervals `[start, end]` that are **sorted by start** and **pairwise disjoint** (no two overlap or touch). Insert `newInterval` and return the resulting list, merging wherever necessary so that the output is again sorted, disjoint, and has no touching intervals.

As in Merge Intervals, intervals that share an endpoint (`[1, 3]` and `[3, 4]`) count as overlapping and must be merged.

**Examples**

```
intervals = [[1, 2], [5, 7], [9, 12]], newInterval = [3, 4]    ->   [[1, 2], [3, 4], [5, 7], [9, 12]]
intervals = [[1, 2], [5, 7], [9, 12]], newInterval = [6, 9]    ->   [[1, 2], [5, 12]]
intervals = [], newInterval = [4, 8]                           ->   [[4, 8]]
intervals = [[1, 3], [6, 9]], newInterval = [3, 6]             ->   [[1, 9]]      touches both
```

**Constraints**

- `0 <= intervals.length <= 10^4`
- `0 <= start <= end <= 10^6` for every interval, including `newInterval`
- `intervals` is sorted by start; consecutive intervals satisfy `intervals[i][1] < intervals[i+1][0]`.
