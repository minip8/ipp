Given an unsorted array of integers `nums`, return the length of the longest run of **consecutive integer values** `v, v+1, v+2, ..., v+k-1` that all appear somewhere in `nums`. The values may appear in any positions and in any order; duplicates count once.

Your algorithm should run in O(n) expected time.

**Examples**

```
nums = [10, 4, 20, 1, 3, 2]            ->   4      values 1, 2, 3, 4
nums = [5, 6, 6, 7, -1, 0]             ->   3      5, 6, 7 (the second 6 doesn't extend it); -1, 0 has length 2
nums = []                              ->   0
```

**Constraints**

- `0 <= nums.length <= 10^5`
- `-10^9 <= nums[i] <= 10^9`
