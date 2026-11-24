Given an array `nums` of **distinct** integers, return every possible ordering (permutation) of its elements.

Each permutation must appear exactly once. The list of permutations may be in any order, but within each permutation the order of elements is, of course, what makes it that permutation.

**Examples**

```
nums = [5, 8]       ->   [[5, 8], [8, 5]]
nums = [0]          ->   [[0]]
nums = [1, 2, 3]    ->   [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]
```

**Constraints**

- `1 <= nums.length <= 7`
- `-10 <= nums[i] <= 10`
- All values in `nums` are distinct.
