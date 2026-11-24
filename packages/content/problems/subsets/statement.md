You are given an array `nums` of **distinct** integers. Return every subset of `nums` (its power set), including the empty subset and `nums` itself.

Each subset must appear exactly once. You may return the subsets in any order, and the elements inside each subset in any order.

**Examples**

```
nums = [4, 9]      ->   [[], [4], [9], [4, 9]]
nums = [-1]        ->   [[], [-1]]
nums = [1, 2, 3]   ->   [[], [1], [2], [3], [1, 2], [1, 3], [2, 3], [1, 2, 3]]
```

**Constraints**

- `1 <= nums.length <= 12`
- `-100 <= nums[i] <= 100`
- All values in `nums` are distinct.
