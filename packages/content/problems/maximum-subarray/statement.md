Find the contiguous, **non-empty** subarray of `nums` with the largest sum, and return that sum.

Note the subarray must contain at least one element, so if every number is negative the answer is the largest (least negative) element.

**Examples**

```
nums = [3, -4, 5, -1, 2, -6, 1]    ->   6      [5, -1, 2]
nums = [-3, -1, -2]                ->   -1     the single element -1
nums = [2, 3, -1, 4]               ->   8      the whole array
```

**Constraints**

- `1 <= nums.length <= 10^5`
- `-10^9 <= nums[i] <= 10^9`
- The answer can exceed the 32-bit range, so it is returned as a 64-bit integer.
