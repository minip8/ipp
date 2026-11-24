An array of **distinct** integers was sorted in increasing order and then **rotated** at an unknown point: some prefix was moved to the end. For example, `[1, 3, 5, 8, 9, 12]` rotated by 2 becomes `[5, 8, 9, 12, 1, 3]`. A rotation by 0 (no change) is also possible.

Given the rotated array `nums` and a value `target`, return the index of `target` in `nums`, or `-1` if it is not present.

Your algorithm must run in **O(log n)** time.

**Examples**

```
nums = [5, 8, 9, 12, 1, 3], target = 1     ->   4
nums = [5, 8, 9, 12, 1, 3], target = 6     ->   -1
nums = [2, 4, 7], target = 7               ->   2       not rotated
nums = [10], target = 10                   ->   0
```

**Constraints**

- `1 <= nums.length <= 10^5`
- `-10^9 <= nums[i], target <= 10^9`
- All values in `nums` are distinct.
