Return the number of **contiguous, non-empty subarrays** of `nums` whose elements sum to exactly `k`.

Subarrays are counted by position: two subarrays with the same values but different start or end indices are different.

**Examples**

```
nums = [1, 2, 3, -2, 2], k = 3     ->   4      [1,2], [3], [3,-2,2], [2,3,-2]
nums = [1, 1, 1], k = 2            ->   2      positions 0-1 and 1-2
nums = [0, 0, 0], k = 0            ->   6      every subarray sums to 0
```

**Constraints**

- `1 <= nums.length <= 2 * 10^4`
- `-1000 <= nums[i] <= 1000`
- `-10^7 <= k <= 10^7`
