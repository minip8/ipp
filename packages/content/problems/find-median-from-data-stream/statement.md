Build a structure that receives integers one at a time and can report the **median** of everything received so far at any moment.

The median of a multiset of `n` numbers, after sorting them as `a[0] <= a[1] <= ... <= a[n-1]`:

- if `n` is odd, it is `a[n / 2]`;
- if `n` is even, it is the average `(a[n/2 - 1] + a[n/2]) / 2`, as a floating-point number (it may end in `.5`).

Implement:

- `MedianFinder()` creates an empty structure.
- `addNum(num)` adds `num` to the multiset. Duplicates are kept.
- `findMedian()` returns the current median as a double. It is only called after at least one `addNum`.

Answers within `1e-6` of the true median are accepted.

**Example**

```
MedianFinder m
m.addNum(5)
m.findMedian()  -> 5.0
m.addNum(1)
m.findMedian()  -> 3.0      (1 + 5) / 2
m.addNum(9)
m.findMedian()  -> 5.0      sorted: 1 5 9
m.addNum(2)
m.findMedian()  -> 3.5      sorted: 1 2 5 9 -> (2 + 5) / 2
```

**Constraints**

- `-10^5 <= num <= 10^5`
- At most `5 * 10^4` calls in total per test.
- Aim for `O(log n)` per `addNum` and `O(1)` per `findMedian`.
