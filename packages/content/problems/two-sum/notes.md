**Approaches**
- Brute force: every pair, O(n^2) time, O(1) space. Fine as a first statement, not as the final answer.
- Expected: one pass with a hash map from value to index; for each x look up target - x. O(n) time, O(n) space.
- Also acceptable: sort (value, index) pairs and use two pointers, O(n log n).

**Common wrong turns**
- Using the same element twice (target = 6, nums = [3, ...]): must check the complement was seen *earlier*.
- Inserting before looking up.
- Sorting and returning positions in the sorted array instead of original indices.

**Hint ladder**
1. For a given element, what exactly are you looking for among the others?
2. How quickly can you answer "have I seen value v, and where"?
3. One pass: look up the complement first, then record the current element.

**Follow-ups**
- What if the input is sorted? (two pointers, O(1) space)
- What if there can be zero or many answers?
- Integer overflow when computing target - x in C++ with 32-bit ints near the limits?
