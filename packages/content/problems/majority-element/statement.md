Given an array `nums` of length `n`, return the value that appears **more than `n / 2` times** (strictly more than half of the positions).

Such a value is guaranteed to exist, so the answer is unique.

**Examples**

```
nums = [4, 1, 4]                    ->   4
nums = [7, 7, 2, 2, 7, 3, 7]        ->   7     7 appears 4 times out of 7
nums = [-5]                         ->   -5
```

**Constraints**

- `1 <= nums.length <= 10^5`
- `-10^9 <= nums[i] <= 10^9`
- A majority element always exists.

Can you do it in O(n) time and O(1) extra space?
