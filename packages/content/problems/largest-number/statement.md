Arrange the non-negative integers in `nums` in some order and concatenate their decimal representations to form one big number. Return the **largest** number that can be formed, as a string (it can be far too large for any integer type).

The result must not have leading zeros: if the largest possible number is zero, return `"0"`.

**Examples**

```
nums = [10, 2]               ->   "210"
nums = [3, 30, 34, 5, 9]     ->   "9534330"
nums = [0, 0, 0]             ->   "0"
nums = [121, 12]             ->   "12121"      "12" + "121" beats "121" + "12"
```

**Constraints**

- `1 <= nums.length <= 10^4`
- `0 <= nums[i] <= 10^9`
