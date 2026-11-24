**Approaches**
- Brute force: repeatedly find any two overlapping intervals and merge them until none remain. O(n^2) or worse.
- Expected: sort by start, then sweep: if the next interval's start `<=` the current merged end, extend the end with `max(end, next.end)`; otherwise emit and start a new one. O(n log n) time, O(n) output (O(log n)–O(n) for sorting).
- Sweep-line with +1/-1 events also works (careful with touching endpoints: process starts before ends at the same coordinate).

**Common wrong turns**
- Setting the merged end to `next.end` instead of `max(end, next.end)` — contained intervals shrink the result (`[[1, 10], [2, 3]]`).
- Using `<` instead of `<=` (touching intervals not merged).
- Forgetting to emit the last interval.
- Assuming the input is sorted.

**Hint ladder**
1. If the intervals were ordered by start time, which intervals could the first one merge with?
2. After sorting, do you ever need to look back further than the interval you're currently building?
3. Sort by start; keep one "current" interval and either extend it or close it off — and think about intervals fully inside it.

**Follow-ups**
- Insert a new interval into an already merged, sorted list (O(n) without re-sorting).
- Stream of intervals with "add" and "query covered length" operations (balanced tree / `std::map`).
- Total length covered by the union; maximum overlap depth (meeting rooms).
- Half-open intervals `[start, end)` — what changes?
