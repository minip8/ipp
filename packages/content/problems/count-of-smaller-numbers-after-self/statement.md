For every index `i` of `nums`, count how many elements **to its right** are **strictly smaller** than `nums[i]`. Return these counts as an array of the same length.

**Examples**

```
nums = [5, 2, 6, 1]        ->   [2, 1, 1, 0]     right of 5: {2, 1}; right of 2: {1}; right of 6: {1}
nums = [3, 3, 1]           ->   [1, 1, 0]        equal values don't count
nums = [-1]                ->   [0]
```

**Constraints**

- `1 <= nums.length <= 10^5`
- `-10^4 <= nums[i] <= 10^4`

The quadratic solution is too slow; aim for O(n log n).
