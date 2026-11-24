You are given a list of meetings, where `intervals[i] = [start_i, end_i]` means meeting `i` runs from time `start_i` until time `end_i`. Return `true` if one person could attend **all** of them, i.e. no two meetings overlap.

A meeting that ends at time `t` does **not** overlap a meeting that starts at time `t` (you can walk straight from one to the next). The meetings are given in no particular order.

**Examples**

```
intervals = [[9, 10], [13, 15], [10, 12]]   ->   true     back-to-back at 10 is fine
intervals = [[1, 5], [8, 9], [4, 6]]        ->   false    [1, 5] and [4, 6] overlap
intervals = []                              ->   true
```

**Constraints**

- `0 <= intervals.length <= 10^4`
- `intervals[i].length == 2`
- `0 <= start_i < end_i <= 10^6`
