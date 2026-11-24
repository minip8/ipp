`a` and `b` are each sorted in non-decreasing order. Return the **median** of all their elements combined.

If the combined length is odd, the median is the middle element of the merged order; if it is even, it is the average of the two middle elements (which may be a non-integer such as `2.5`). Answers within `1e-6` of the exact value are accepted.

The intended solution runs in **O(log(min(m, n)))** time.

**Examples**

```
a = [1, 3], b = [2]             ->   2.0
a = [1, 2], b = [3, 4]          ->   2.5
a = [], b = [7]                 ->   7.0     one array may be empty
a = [5, 5, 5], b = [5, 5]       ->   5.0
```

**Constraints**

- `0 <= a.length, b.length <= 10^5`, `1 <= a.length + b.length`
- `-10^9 <= a[i], b[i] <= 10^9`
