`nums` contains only the values `0`, `1` and `2` (think red, white and blue). Rearrange it so that all `0`s come first, then all `1`s, then all `2`s, and **return the rearranged array**.

Do not call a library sort. The intended solution makes a **single pass** over the array and uses only O(1) extra space — rearrange `nums` itself by swapping elements, then return it.

**Examples**

```
nums = [2, 0, 2, 1, 1, 0]   ->   [0, 0, 1, 1, 2, 2]
nums = [1, 2, 0]            ->   [0, 1, 2]
nums = [2]                  ->   [2]
```

**Constraints**

- `1 <= nums.length <= 10^5`
- `nums[i]` is `0`, `1` or `2`.
