Given an unsorted integer array `nums`, return the **smallest positive integer** (`1, 2, 3, ...`) that does **not** appear in it.

Your algorithm must run in **O(n)** time and use **O(1) extra space**. You are allowed to rearrange or overwrite the elements of `nums` while computing the answer.

**Examples**

```
nums = [3, 4, -1, 1]        ->   2
nums = [1, 2, 0]            ->   3
nums = [7, 8, 9, 11]        ->   1
nums = [2, 2, 1, 1]         ->   3      duplicates are allowed
```

**Constraints**

- `1 <= nums.length <= 10^5`
- `-2^31 <= nums[i] <= 2^31 - 1`
