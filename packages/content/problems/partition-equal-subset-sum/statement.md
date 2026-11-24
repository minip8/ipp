Given an array of positive integers `nums`, decide whether its elements can be split into **two groups with equal sums**. Every element must go into exactly one of the two groups.

Return `true` if such a split exists and `false` otherwise.

**Examples**

```
nums = [2, 3, 4, 5]      ->  true     ({2, 5} and {3, 4}, both sum to 7)
nums = [1, 2, 5]         ->  false    (total 8, but no group sums to 4)
nums = [6, 1, 3]         ->  false    (total 10, but no group sums to 5)
```

**Constraints**

- `1 <= nums.length <= 200`
- `1 <= nums[i] <= 100`
