**Approaches**
- Sort, then find the first index `i` with `nums[i] != i` (or `n`). O(n log n).
- Hash set of values, then probe `0..n`. O(n) time and space.
- Expected (either): Gauss sum `n(n+1)/2 - sum(nums)`, or XOR of all indices `0..n` with all values. O(n) time, O(1) space.
- Cyclic placement (swap each value to its index) is O(n)/O(1) but modifies the input — fine to mention, but the statement asks not to.

**Common wrong turns**
- Forgetting that `n` itself can be missing (looping indices only to `n - 1` and never considering `n`).
- Overflow in C++/Java: `n * (n + 1)` exceeds 32-bit `int` once n >= 46341 (a hidden test uses n = 47000). Writing `n * (n + 1) / 2` in `int` gives a wrong answer; use `long long`, divide first, or use XOR. Good discussion point (accumulating the sum incrementally in `int` "happens to work" via wraparound — technically UB for signed ints).
- Off-by-one when XOR-ing: must include `n` once.

**Hint ladder**
1. You know exactly which values *should* be present. What could you compute about them in advance?
2. Compare that "expected" quantity with the same quantity of what you actually have.
3. Sum (watch the integer width) or XOR (no overflow at all) both work in one pass.

**Follow-ups**
- Why does XOR avoid the overflow issue entirely?
- Two numbers missing (sum and sum of squares, or XOR + split by a set bit).
- The input is a huge file of numbers that does not fit in memory (bitmap / counting by blocks).
- Sorted input: binary search for the first index where `nums[i] != i`, O(log n).
