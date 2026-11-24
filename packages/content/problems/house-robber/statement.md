Houses stand in a single row; `nums[i]` is the amount of money in house `i`. A burglar wants to collect as much as possible, but an alarm links every pair of **adjacent** houses: taking money from two neighbouring houses triggers it.

Return the largest total the burglar can collect without ever choosing two adjacent houses. Choosing no houses at all (total `0`) is allowed.

**Examples**

```
nums = [3, 10, 4, 2, 8]   ->  18     (houses 1 and 4: 10 + 8)
nums = [5, 1, 1, 5]       ->  10     (houses 0 and 3)
nums = [7]                ->  7
```

**Constraints**

- `1 <= nums.length <= 3 * 10^4`
- `0 <= nums[i] <= 10^4`
