You start at index `0` of the array `nums`. From index `i` you may jump forward to any index `i + 1`, `i + 2`, ..., `i + nums[i]` (a value of `0` means you are stuck there).

Return the **minimum number of jumps** needed to reach the last index. The input guarantees that the last index is reachable.

**Examples**

```
nums = [2, 3, 1, 1, 4]       ->   2      0 -> 1 -> 4
nums = [2, 3, 0, 1, 4]       ->   2      same path; the 0 is never used
nums = [0]                   ->   0      already at the last index
nums = [1, 1, 1, 1]          ->   3
```

**Constraints**

- `1 <= nums.length <= 10^5`
- `0 <= nums[i] <= 1000`
- The last index is reachable from index 0.
