`nums1` has length `m + n`: its first `m` elements are sorted in non-decreasing order and its last `n` slots are **placeholders** (always `0`) that should be ignored. `nums2` has `n` elements, also sorted in non-decreasing order.

Merge `nums2` into `nums1` so that `nums1` holds all `m + n` values in sorted order, and **return `nums1`**.

The intended solution writes into `nums1` itself using O(1) extra memory (no second buffer of size m + n).

**Examples**

```
nums1 = [1, 4, 7, 0, 0, 0], m = 3, nums2 = [2, 5, 6], n = 3   ->   [1, 2, 4, 5, 6, 7]
nums1 = [5], m = 1, nums2 = [], n = 0                         ->   [5]
nums1 = [0, 0], m = 0, nums2 = [-3, 8], n = 2                 ->   [-3, 8]
```

**Constraints**

- `0 <= m, n <= 10^4`, `1 <= m + n`
- `nums1.length == m + n`, `nums2.length == n`
- `-10^9 <= values <= 10^9`
