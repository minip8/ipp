You are given an array `candidates` of **distinct** positive integers and a positive integer `target`. Return every distinct combination of candidates whose sum is exactly `target`. Each candidate may be used **any number of times**.

Two combinations are the same if they use every value the same number of times — `[2, 3, 2]` and `[2, 2, 3]` are one combination and must be reported once. Return the combinations in any order, with the numbers inside each combination in any order. If no combination works, return an empty list.

**Examples**

```
candidates = [3, 4, 7], target = 7    ->   [[3, 4], [7]]
candidates = [2, 5], target = 9       ->   [[2, 2, 5]]
candidates = [4, 6], target = 5       ->   []
```

In the first example `[4, 3]` is the same combination as `[3, 4]`, so it is not listed separately.

**Constraints**

- `1 <= candidates.length <= 30`
- `2 <= candidates[i] <= 40`, all distinct
- `1 <= target <= 40`
- The answer contains at most 500 combinations.
