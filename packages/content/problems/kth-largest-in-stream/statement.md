Scores arrive one at a time and after each one you must report the `k`-th largest score seen so far.

- `KthLargest(k, nums)` starts with the scores in `nums` (in any order, possibly empty).
- `add(val)` records the score `val` and returns the `k`-th largest of all scores recorded so far (the initial `nums` plus every added value).

"`k`-th largest" counts duplicates separately: in `[5, 5, 3]` the 1st and 2nd largest are both `5` and the 3rd largest is `3`.

It is guaranteed that `nums.length >= k - 1`, so after every `add` at least `k` scores have been recorded.

**Example**

```
KthLargest t(3, [6, 1, 9, 4])
t.add(2)    -> 4      scores 9 6 4 2 1
t.add(7)    -> 6      scores 9 7 6 4 2 1
t.add(10)   -> 7
t.add(7)    -> 7      9 10 7 7 ... : 3rd largest is 7
t.add(0)    -> 7
```

**Constraints**

- `1 <= k <= 10^4`
- `k - 1 <= nums.length <= 10^4`
- `-10^4 <= nums[i], val <= 10^4`
- At most `10^4` calls to `add` per test.
