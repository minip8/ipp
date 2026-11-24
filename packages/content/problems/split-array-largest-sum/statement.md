Split `nums` into exactly `k` **non-empty contiguous** parts. The *cost* of a split is the largest sum among its parts. Return the minimum possible cost.

For example, think of `nums[i]` as the number of pages in book `i` on a shelf and `k` as the number of readers: each reader takes a consecutive run of books, and you want the busiest reader to have as few pages as possible.

**Examples**

```
nums = [7, 2, 5, 10, 8], k = 2      ->   18     [7, 2, 5] and [10, 8]
nums = [1, 2, 3, 4, 5], k = 2       ->   9      [1, 2, 3] and [4, 5]
nums = [1, 4, 4], k = 3             ->   4      each element alone
```

**Constraints**

- `1 <= nums.length <= 10^4`
- `1 <= k <= min(50, nums.length)`
- `0 <= nums[i] <= 10^6`
- Sums can reach `10^10`, so the answer is returned as a 64-bit integer.
