You are given `k` arrays, each sorted in non-decreasing order. Merge them into a single array sorted in non-decreasing order and return it. Duplicates are kept.

Aim for better than re-merging the result with each array one at a time: if `N` is the total number of elements, target `O(N log k)`.

**Examples**

```
arrays = [[1, 4, 5], [1, 3, 4], [2, 6]]   ->   [1, 1, 2, 3, 4, 4, 5, 6]
arrays = []                               ->   []
arrays = [[], [-3], []]                   ->   [-3]
```

**Constraints**

- `0 <= k <= 10^4`
- `0 <= arrays[i].length <= 500`, and the total number of elements `N` is at most `10^5`
- `-10^9 <= arrays[i][j] <= 10^9`
- Each `arrays[i]` is sorted in non-decreasing order.
