The array `nums` has `n + 1` elements, each an integer in the range `[1, n]`. By the pigeonhole principle at least one value repeats; in this problem **exactly one value repeats**, possibly more than twice (every other value appears at most once).

Return the repeated value.

You must not modify `nums`, and you should use only O(1) extra space. Aim for better than O(n^2) time.

**Examples**

```
nums = [1, 4, 3, 2, 4]       ->   4
nums = [3, 1, 3, 2, 3]       ->   3     appears three times; 4 and 5 are missing
nums = [1, 1]                ->   1
```

**Constraints**

- `1 <= n <= 10^5`, `nums.length == n + 1`
- `1 <= nums[i] <= n`
- Exactly one value appears two or more times.
