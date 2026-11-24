**Approaches**
- Hash set: add on first sight, remove on second; the survivor is the answer. O(n) time, O(n) space.
- Sort and scan in pairs: O(n log n).
- Math: `2 * sum(set(nums)) - sum(nums)`. O(n) space for the set; overflow concerns in C++ at larger ranges.
- Expected: XOR everything. `x ^ x = 0`, `x ^ 0 = x`, XOR is commutative and associative, so pairs cancel. O(n) time, O(1) space.

**Common wrong turns**
- Assuming values are non-negative (XOR works fine for negatives in two's complement; Python's ints also work).
- Starting the accumulator at something other than 0.
- Over-engineering with bit counting when XOR suffices (bit counting is the right tool for the "appears three times" follow-up).

**Hint ladder**
1. What happens if you combine a value with itself using some operation that "cancels"?
2. Which bitwise operator maps `x op x` to zero and `x op 0` to `x`?
3. Fold that operator across the whole array; does order matter?

**Follow-ups**
- Every other value appears **three** times (count each bit mod 3, or the two-variable `ones/twos` state machine).
- **Two** values appear once (XOR all, split by any set bit of the result, XOR each group).
- Can you prove that order doesn't matter?
