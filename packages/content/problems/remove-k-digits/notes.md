**Approaches**
- Brute force: try all `C(n, k)` subsets — exponential. Or remove one digit at a time, trying every position each round: O(k * n^2) with string compares.
- Greedy insight: removing one digit, the best choice is the first digit that is larger than its right neighbour (the first "peak"); if the digits never decrease, remove the last one. Repeating this k times is O(k * n).
- Expected: do all k removals in one pass with a monotonic (non-decreasing) stack — while the top is greater than the incoming digit and removals remain, pop. Afterwards drop any remaining removals from the end, strip leading zeros, return `"0"` if empty. O(n) time, O(n) space.

**Common wrong turns**
- Removing the *largest* digits (`"4352", 1` -> `"432"` instead of `"352"`).
- Forgetting leftover k when the digits are non-decreasing (`"112", 1`).
- Not stripping leading zeros, or returning `""` instead of `"0"`.
- Converting to an integer (inputs are up to 10^5 digits).
- Popping on `>=` — harmless for correctness here but worth asking why equal digits don't need popping.

**Hint ladder**
1. Which matters more: the first digit of the result or the last?
2. If you may remove just one digit, which one should go? Try a few examples.
3. Scan left to right keeping a stack of chosen digits; when a smaller digit arrives, it's worth removing larger digits before it while you still can.

**Follow-ups**
- Make the number as *large* as possible instead.
- Create Maximum Number / smallest subsequence of distinct characters (same monotonic-stack idea with extra constraints).
- Prove the greedy choice is optimal (exchange argument).
