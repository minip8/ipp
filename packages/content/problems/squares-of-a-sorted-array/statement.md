`nums` is sorted in non-decreasing order and may contain negative numbers. Return a new array containing the **square of each element**, also sorted in non-decreasing order.

**Examples**

```
nums = [-5, -2, 0, 3, 4]    ->   [0, 4, 9, 16, 25]
nums = [-3, -3, 1]          ->   [1, 9, 9]
nums = [2, 6]               ->   [4, 36]
```

**Constraints**

- `1 <= nums.length <= 10^5`
- `-10^4 <= nums[i] <= 10^4`
- `nums` is sorted in non-decreasing order.

Squaring and then sorting is O(n log n). Can you do it in O(n)?
