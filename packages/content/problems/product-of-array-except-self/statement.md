Return an array `answer` where `answer[i]` is the product of every element of `nums` **except** `nums[i]`.

You **may not use division**, and your solution should run in O(n) time.

**Examples**

```
nums = [2, 3, 4, 5]        ->   [60, 40, 30, 24]
nums = [3, 0, 2, -1]       ->   [0, -6, 0, 0]
nums = [0, 4, 0]           ->   [0, 0, 0]
```

**Constraints**

- `2 <= nums.length <= 10^5`
- `-30 <= nums[i] <= 30`
- Every prefix product and suffix product of `nums` fits in a signed 32-bit integer (so every answer does too).

Follow-up: can you use only O(1) extra space besides the output array?
