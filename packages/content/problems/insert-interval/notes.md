**Approaches**
- Append and re-run Merge Intervals: O(n log n). Works, but ignores the sorted input — ask for O(n).
- Expected: one linear pass in three phases — copy intervals ending before the new one starts (`end < new.start`); absorb every interval that overlaps (`start <= new.end`) by widening `new` to `min`/`max`; append `new`; copy the rest. O(n) time, O(n) output.
- Binary search can locate the overlapping range in O(log n), but the output still costs O(n) to build — good trade-off discussion (an in-place structure like `std::map` makes insertion O(log n + merged)).

**Common wrong turns**
- Off-by-one on touching endpoints (`<` vs `<=`).
- Forgetting to append `newInterval` when it goes at the very end, or when `intervals` is empty.
- Mutating the input while iterating over it.
- Only merging with one neighbour when the new interval swallows several.

**Hint ladder**
1. Which existing intervals are completely unaffected by the new one? Where are they in the list?
2. The affected intervals form one contiguous block. How do you combine them with the new one?
3. Three phases: everything strictly before, the merged block, everything strictly after.

**Follow-ups**
- Many insertions online: keep intervals in a balanced BST keyed by start (`std::map`), merging neighbours — O(log n) amortised.
- Remove an interval (may split one into two).
- Return only the number of intervals after insertion without building the list.
