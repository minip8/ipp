A window of size `k` slides over `nums` from left to right, one position at a time: first it covers `nums[0..k-1]`, then `nums[1..k]`, and so on until it covers the last `k` elements. Return an array containing the **maximum** of each window, in order (so the result has `n - k + 1` elements).

Aim for O(n) total time — independent of `k`.

**Examples**

```
nums = [4, 2, 12, 3, 8, 1, 7], k = 3   ->   [12, 12, 12, 8, 8]
nums = [9, 8, 7, 6], k = 2             ->   [9, 8, 7]
nums = [5], k = 1                      ->   [5]
```

**Constraints**

- `1 <= k <= nums.length <= 10^5`
- `-10^4 <= nums[i] <= 10^4`
