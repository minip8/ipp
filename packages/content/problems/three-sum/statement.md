Find every **distinct** triple of values `[a, b, c]` such that `a + b + c == 0`, where `a`, `b` and `c` come from three **different positions** of `nums`.

Two triples are the same if they contain the same values (as a multiset), regardless of which positions they came from — report each such triple once. Return the triples in any order; the order of the three numbers inside a triple also doesn't matter.

**Examples**

```
nums = [-2, 0, 1, 1, 2, -1]     ->   [[-2, 0, 2], [-2, 1, 1], [-1, 0, 1]]
nums = [0, 0, 0, 0]             ->   [[0, 0, 0]]
nums = [1, 2, -4]               ->   []
```

In the first example `[-1, 0, 1]` can be formed using either of the two `1`s, but it is listed once. `[-2, 1, 1]` is allowed because the two `1`s are at different positions.

**Constraints**

- `3 <= nums.length <= 2000`
- `-10^5 <= nums[i] <= 10^5`
