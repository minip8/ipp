Meeting `i` occupies a room from time `intervals[i][0]` (inclusive) until `intervals[i][1]` (exclusive). Return the **minimum number of rooms** needed to hold all meetings, so that no room ever hosts two meetings at the same time.

A room freed at time `t` can be reused by a meeting starting at time `t`.

**Examples**

```
intervals = [[0, 30], [5, 10], [15, 20]]     ->   2     [0, 30] needs its own room
intervals = [[7, 10], [2, 4]]                ->   1
intervals = [[1, 5], [5, 9], [2, 6], [6, 8]] ->   2     at time 5 one room frees up just as another meeting starts
```

**Constraints**

- `1 <= intervals.length <= 10^4`
- `0 <= start < end <= 10^6`
