**Approaches** (the constraints rule out the easy ones on purpose — talk through why)
- Hash set: O(n) time, O(n) space — violates the space limit.
- Sort: O(n log n) but modifies the input (or needs a copy).
- Mark visited by negating `nums[abs(x)]`: O(n)/O(1) but modifies the input.
- Expected (A): binary search on the value. For a candidate `m`, count elements `<= m`; if the count exceeds `m`, the duplicate is `<= m`. O(n log n) time, O(1) space.
- Expected (B): Floyd's cycle detection. Treat `i -> nums[i]` as a linked list starting at index 0; index 0 is never a target (values are >= 1), and the duplicate value is the entry point of the cycle. Phase 1: slow/fast meet; phase 2: restart one pointer at 0, advance both by one, they meet at the duplicate. O(n) time, O(1) space.
- Bit counting: for each bit, compare how many elements have it set vs how many of `1..n` do. O(n log n).

**Common wrong turns**
- Sum-based formula `sum(nums) - n(n+1)/2`: only works if the duplicate appears exactly twice and nothing is missing — breaks on `[3, 1, 3, 2, 3]`.
- XOR tricks for the same reason.
- Floyd phase 2 starting the second pointer at `nums[0]` instead of 0 (off by one step).
- Binary search on indices of an unsorted array (meaningless).

**Hint ladder**
1. Why can't you just use the sum of the array? Try `[3, 1, 3, 2, 3]`.
2. For a value m, how many elements would be `<= m` if there were no duplicate? What if the duplicate is `<= m`?
3. Alternatively: view each value as a pointer to an index. What structure does following those pointers produce, and where does the repeated value sit in it?

**Follow-ups**
- Prove why index 0 is outside the cycle and why phase 2 finds the entrance.
- Could several values repeat? Which approaches still work?
- Read-only input on disk/streamed: which approach needs only sequential passes? (binary search on value: O(log n) passes)
