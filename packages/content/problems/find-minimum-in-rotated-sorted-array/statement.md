An array of **distinct** integers was sorted in increasing order and then **rotated** some number of times (possibly zero): rotating moves the last element to the front, so `[2, 4, 6, 8, 9]` rotated twice is `[8, 9, 2, 4, 6]`.

Given the rotated array, return its **minimum element**. Your algorithm must run in **O(log n)** time.

**Examples**

```
nums = [8, 9, 2, 4, 6]       ->   2
nums = [5, 1, 3]             ->   1
nums = [10, 20, 30]          ->   10     not rotated (or rotated n times)
```

**Constraints**

- `1 <= nums.length <= 10^5`
- `-10^9 <= nums[i] <= 10^9`
- All values are distinct.
