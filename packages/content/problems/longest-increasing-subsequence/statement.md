Given an integer array `nums`, return the length of its longest **strictly increasing subsequence**.

A subsequence keeps some of the elements (possibly all, at least one) in their original order, without requiring them to be next to each other. Strictly increasing means each kept element is larger than the one before it; equal values do not count.

**Examples**

```
nums = [4, 1, 8, 2, 3, 9, 5]   ->  4     (for example 1, 2, 3, 9 or 1, 2, 3, 5)
nums = [6, 6, 6]               ->  1     (equal values are not increasing)
nums = [3, 10, 2, 11, 4, 12]   ->  4     (3, 10, 11, 12)
```

**Constraints**

- `1 <= nums.length <= 2.5 * 10^4`
- `-10^4 <= nums[i] <= 10^4`

An O(n^2) solution is a good start; aim for O(n log n).
