In the array `nums`, every value appears **exactly twice** except for one value, which appears **exactly once**. Return that value.

Aim for O(n) time and O(1) extra space.

**Examples**

```
nums = [6, 3, 6]                 ->   3
nums = [5, -2, 9, 9, 5]          ->   -2
nums = [0]                       ->   0
```

**Constraints**

- `1 <= nums.length <= 3 * 10^4 + 1` (always odd)
- `-3 * 10^4 <= nums[i] <= 3 * 10^4`
- Exactly one value appears once; every other value appears exactly twice.
