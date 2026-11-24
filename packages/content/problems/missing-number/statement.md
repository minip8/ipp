The array `nums` has length `n` and holds `n` **distinct** integers, all taken from the range `0..n` (inclusive). Since that range contains `n + 1` values, exactly one of them is absent. Return it.

**Examples**

```
nums = [3, 0, 1]          ->   2
nums = [1]                ->   0
nums = [0, 1, 2, 3]       ->   4      the missing value can be n itself
```

**Constraints**

- `1 <= n == nums.length <= 5 * 10^4`
- `0 <= nums[i] <= n`, all values distinct.

Can you solve it with O(1) extra space and without modifying `nums`?
